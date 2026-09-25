/**
 * @file Validates an industry pack before it is loaded.
 *
 * A pack is a profile written by a PERSON, the one opening a new customer, who is not
 * necessarily a programmer. So the checks must be thorough and the messages must be in plain
 * language (kept in Vietnamese, the pack authors' language), instead of letting the bot misbehave
 * and finding out through customers.
 */

import { isToolName } from "@sp/contract";
import { canonicalValue, extractAxis } from "../engine/axis";
import { detectIntent } from "../engine/intent";
import { normalize, stripDiacritics, tokens } from "../engine/text-analysis";
import { DISPATCHABLE_TOOLS } from "../engine/tool-handlers";
import { REPLY_GATE_SCHEMA } from "./parse";
import type { DialogueConfig, EntityConfig, IndustryPack, IntentRules, MatchingConfig, ReplyGateConfig, ScriptTexts } from "./types";

/** Placeholders the engine always supplies. Packs add their own through `extraValues`. */
export const ENGINE_VARS = [
  "khach", "shop", "mon", "hang", "truc", "bienthe",
  "tinhtrang", "ton", "gia", "giacao", "kho", "sokho", "dsbienthe",
  "chinhsach", "madon", "trangthai", "conphaitra", "songay", "link"
];

/** Always required; every industry needs them. */
const ALWAYS_REQUIRED = ["greeting", "ask_item", "ask_slot", "handoff", "offline"];
/** Optional templates the engine knows how to use. Packs may declare more. */
export const OPTIONAL_TEMPLATES = [
  "in_stock", "out_of_stock", "in_stock_range", "brand_not_carried",
  "tool_failed", "ask_item_has_image"
];

/**
 * Fallback sentences must not contain digits: when a gate blocks the main sentence the engine
 * falls back to these, and a digit in them would be blocked by the "no invented numbers" gate too.
 */
const NO_DIGIT_TEMPLATES = ["handoff", "offline"];

/** Whether the string carries diacritics. The gates rely on diacritics to tell meanings apart. */
function hasDiacritics(value: string): boolean {
  // `stripDiacritics`, NOT `normalize`: `normalize` also collapses whitespace and removes
  // punctuation, so any template with a {placeholder} or a full stop would count as "has
  // diacritics" and escape the check, making it useless.
  return stripDiacritics(value) !== value.toLowerCase();
}

/**
 * A SHOP'S OWN NUMBER inside industry text (24/09/2026). The deposit rate, the lead time and any
 * price belong to one shop's profile (tier 3); written into a block they would reach every shop of
 * the industry — the exact bug the three tiers exist to end ("shop giày thứ hai nói chính sách của
 * TopRun"). Sizes and centimetres pass: "size 42", "+1,5cm", "42 2/3" are the industry's.
 */
const SHOP_NUMBER_RE = /\d+\s*%|\b\d+\s*[-–]\s*\d+\s*(ngay|ngày|tuan|tuần|thang|tháng)\b|\b\d{1,3}(?:[.,]\d{3}){2,}(?!\d)|\b\d+\s*(tr|trieu|triệu)\b(?![a-z])/i;

/** Problems in a list of instruction blocks (industry or tier 1): a shop's number, an empty text. */
export function checkBlocksFree(blocks: readonly { id: string; loiDan: string }[], where: string): string[] {
  const problems: string[] = [];
  for (const block of blocks) {
    if (block.loiDan.trim() === "") { problems.push(`${where}: khoi "${block.id}" khong co loi dan.`); continue; }
    const hit = stripDiacritics(block.loiDan).match(SHOP_NUMBER_RE);
    if (hit) problems.push(`${where}: khoi "${block.id}" chua con so cua rieng mot shop ("${hit[0].trim()}") — dua vao ho so shop, trong khoi chi de cho trong {banHang.…}.`);
  }
  return problems;
}

/**
 * Every regex of a dialogue frame / episode config must compile. A broken one would surface as a
 * `SyntaxError` on the first terse customer message, three layers away from the JSON that caused it.
 */
export function checkDialogueConfig(config: DialogueConfig, where: string): string[] {
  const problems: string[] = [];
  const check = (pattern: string, at: string, flags = ""): void => {
    if (pattern === "") return;
    try { new RegExp(pattern, flags); } catch { problems.push(`${where}: \`${at}\` khong phai bieu thuc chinh quy hop le: ${pattern}`); }
  };
  for (const [kind, patterns] of Object.entries(config.pageTurn)) patterns.forEach((p, i) => check(p, `pageTurn.${kind}[${i}]`));
  config.askedOther.forEach((p, i) => check(p, `askedOther[${i}]`));
  check(config.ack, "ack", "i");
  check(config.deny, "deny", "i");
  check(config.refer, "refer");
  config.sizeOnly.forEach((p, i) => check(p, `sizeOnly[${i}]`));
  config.productCodePatterns.forEach((p, i) => check(p, `productCodePatterns[${i}]`, "g"));
  config.productLinkPatterns.forEach((p, i) => check(p, `productLinkPatterns[${i}]`));
  config.imagePlaceholders.forEach((p, i) => check(p, `imagePlaceholders[${i}]`, "i"));
  const e = config.episode;
  check(e.dismiss, "episode.dismiss"); check(e.dismissLeading, "episode.dismissLeading"); check(e.compare, "episode.compare");
  check(e.rebuy, "episode.rebuy"); check(e.orderConfirmed, "episode.orderConfirmed", "i");
  return problems;
}

/** Tries to compile one pack regex; records a plain-language problem naming the field when it cannot. */
function checkRegex(problems: string[], where: string, pattern: string, at: string, flags = ""): void {
  if (pattern === "") return;
  try { new RegExp(pattern, flags); } catch { problems.push(`${where}: \`${at}\` khong phai bieu thuc chinh quy hop le: ${pattern}`); }
}

/** Every regex of the intent rules must compile; every rule must name an intent and carry a keyword. */
export function checkIntentRules(rules: IntentRules, where: string): string[] {
  const problems: string[] = [];
  rules.rules.forEach((rule, i) => {
    if (rule.intent === "") problems.push(`${where}: rules[${i}] thieu ten y dinh.`);
    if (rule.keywords.length === 0) problems.push(`${where}: rules[${i}] ("${rule.intent}") khong co tu khoa nao.`);
  });
  checkRegex(problems, where, rules.paidMoney, "paidMoney");
  checkRegex(problems, where, rules.paidAboutGoods, "paidAboutGoods");
  for (const [k, v] of Object.entries(rules.deposit)) checkRegex(problems, where, v, `deposit.${k}`);
  const pf = rules.paymentFrame;
  checkRegex(problems, where, pf.moneyTalk, "paymentFrame.moneyTalk");
  checkRegex(problems, where, pf.explicitlyAsksBank, "paymentFrame.explicitlyAsksBank");
  pf.pastPayment.forEach((p, i) => checkRegex(problems, where, p, `paymentFrame.pastPayment[${i}]`));
  checkRegex(problems, where, pf.dispute, "paymentFrame.dispute");
  checkRegex(problems, where, pf.receiptSeen, "paymentFrame.receiptSeen");
  checkRegex(problems, where, pf.collected, "paymentFrame.collected");
  const rc = rules.reconcile;
  rc.carriesRequest.forEach((p, i) => checkRegex(problems, where, p, `reconcile.carriesRequest[${i}]`));
  const plain = ["nudge", "pageAsked", "thanks", "pageSaidPaid", "customerReceiptImage", "buysMore", "asksForPhotos", "adviceRequest",
    "paymentContextCustomer", "paymentContextPage", "sadPhrase", "policyQuestion", "shippingFee"] as const;
  for (const key of plain) checkRegex(problems, where, rc[key], `reconcile.${key}`);
  checkRegex(problems, where, rc.shortAnswerToPage, "reconcile.shortAnswerToPage", "i");
  checkRegex(problems, where, rc.bareAck, "reconcile.bareAck", "i");
  return problems;
}

/** Every regex of the entity patterns must compile (with `{core}` expanded); every chart row needs a tag and a size. */
export function checkEntityConfig(config: EntityConfig, where: string): string[] {
  const problems: string[] = [];
  checkRegex(problems, where, config.phone, "phone");
  checkRegex(problems, where, config.productCodeFallback, "productCodeFallback", "g");
  config.productCodeNotCode.forEach((p, i) => checkRegex(problems, where, p, `productCodeNotCode[${i}]`));
  checkRegex(problems, where, config.address.markers, "address.markers", "i");
  checkRegex(problems, where, config.address.placeWords, "address.placeWords");
  checkRegex(problems, where, config.address.houseNumber, "address.houseNumber");
  config.address.notPlaceBigrams.forEach((p, i) => checkRegex(problems, where, p, `address.notPlaceBigrams[${i}]`, "g"));
  for (const key of ["trigger", "amount", "range", "from", "upTo"] as const) checkRegex(problems, where, config.budget[key], `budget.${key}`, key === "amount" ? "g" : "");
  for (const [label, p] of Object.entries(config.genders)) checkRegex(problems, where, p, `genders.${label}`);
  checkRegex(problems, where, config.sizeLetterPattern, "sizeLetterPattern");
  checkRegex(problems, where, config.sizeRecoverPattern, "sizeRecoverPattern", "g");
  checkRegex(problems, where, config.sizeRecoverNegation, "sizeRecoverNegation");
  checkRegex(problems, where, config.sizeCore, "sizeCore");
  const expand = (p: string): string => p.split("{core}").join(config.sizeCore);
  config.sizePatterns.forEach((p, i) => checkRegex(problems, where, expand(p), `sizePatterns[${i}]`));
  config.sizeTagPatterns.forEach((p, i) => checkRegex(problems, where, p, `sizeTagPatterns[${i}]`));
  config.sizeBarePatterns.forEach((p, i) => checkRegex(problems, where, p, `sizeBarePatterns[${i}]`));
  config.apparelSizePatterns.forEach((p, i) => checkRegex(problems, where, p, `apparelSizePatterns[${i}]`));
  for (const key of ["range", "unitAfter", "notBefore", "footMeasure", "tagWord", "kidsText", "apparelWords", "kidsLine"] as const) {
    checkRegex(problems, where, config.bareTag[key], `bareTag.${key}`);
  }
  config.sizeChart.forEach((row, i) => {
    if (!(row.tem > 0)) problems.push(`${where}: bang-size.rows[${i}] thieu so tem.`);
    if (row.size.trim() === "") problems.push(`${where}: bang-size.rows[${i}] thieu size.`);
  });
  return problems;
}

/**
 * A script may not carry one shop's number (deposit rate, lead time, a price): those live in the shop
 * profile and reach the sentence through `{banHang.…}` placeholders. Same rule as the agent blocks.
 */
export function checkScriptTexts(texts: ScriptTexts, where: string): string[] {
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(texts.scripts)) {
    if (entry.reply.trim() === "") { problems.push(`${where}: kich ban "${id}" khong co cau tra loi.`); continue; }
    const hit = stripDiacritics(entry.reply).match(SHOP_NUMBER_RE);
    if (hit) problems.push(`${where}: kich ban "${id}" chua con so cua rieng mot shop ("${hit[0].trim()}") — dua vao ho so shop, trong kich ban chi de cho trong {banHang.…}.`);
  }
  for (const [reason, text] of Object.entries(texts.hoiLai)) {
    const hit = stripDiacritics(text).match(SHOP_NUMBER_RE);
    if (hit) problems.push(`${where}: cau hoi lai "${reason}" chua con so cua rieng mot shop ("${hit[0].trim()}").`);
  }
  return problems;
}

/** Every regex of the matching data must compile; every type rule must name a kind. */
export function checkMatchingConfig(config: MatchingConfig, where: string): string[] {
  const problems: string[] = [];
  checkRegex(problems, where, config.skuLikePattern, "skuLikePattern");
  for (const [key, p] of Object.entries(config.genderTokens)) checkRegex(problems, where, p, `genderTokens.${key}`);
  config.types.rules.forEach((rule, i) => {
    if (rule.kind === "") problems.push(`${where}: typeRules.rules[${i}] thieu loai hang (kind).`);
    rule.patterns.forEach((p, k) => checkRegex(problems, where, p, `typeRules.rules[${i}].patterns[${k}]`));
  });
  checkRegex(problems, where, config.sizes.apparelPrefix, "sizes.apparelPrefix");
  checkRegex(problems, where, config.sizes.letterSize, "sizes.letterSize");
  const u = config.uncertain;
  checkRegex(problems, where, u.specificItem, "uncertain.specificItem");
  checkRegex(problems, where, u.specificItemDiacritic, "uncertain.specificItemDiacritic", "iu");
  checkRegex(problems, where, u.specificItemNoun, "uncertain.specificItemNoun");
  checkRegex(problems, where, u.categoryQuestion, "uncertain.categoryQuestion");
  checkRegex(problems, where, u.sizeHint, "uncertain.sizeHint");
  return problems;
}

/**
 * Every regex of the reply gate must compile (with `{money}` / `{size}` expanded), and no sentence it
 * sends may carry one shop's number or name: the gate speaks for every shop of the industry, so a
 * sentence must say `{tenShop}` / `{site}` / `{tenNguoiPhuTrach}`, never the name of one (stage 6, 25/09/2026).
 */
export function checkReplyGateConfig(config: ReplyGateConfig, where: string): string[] {
  const problems: string[] = [];
  const loose = config as unknown as Record<string, Record<string, unknown>>;
  const expand = (p: string): string => p.split("{money}").join(config.payment.money || "x").split("{size}").join("42");
  for (const [section, fields] of Object.entries(REPLY_GATE_SCHEMA)) {
    for (const [key, kind] of Object.entries(fields)) {
      const value = loose[section]?.[key];
      const at = `${section}.${key}`;
      switch (kind) {
        case "re": checkRegex(problems, where, expand(String(value ?? "")), at); break;
        case "reList": (value as string[]).forEach((p, i) => checkRegex(problems, where, expand(p), `${at}[${i}]`)); break;
        case "reDiacritic": checkRegex(problems, where, String(value ?? ""), at, "giu"); break;
        case "reDiacriticList": (value as string[]).forEach((p, i) => checkRegex(problems, where, p, `${at}[${i}]`, "giu")); break;
        case "text": {
          const text = String(value ?? "");
          if (text === "") break;
          for (const p of checkBlocksFree([{ id: at, loiDan: text }], where)) problems.push(p);
          break;
        }
        default: break;
      }
    }
  }
  return problems;
}

/** Collects every problem of a pack. An empty list means the pack is valid. */
export class PackValidator {
  validate(pack: IndustryPack): string[] {
    const problems: string[] = [];
    const report = (message: string): void => { problems.push(message); };

    this.checkIdentity(pack, report);
    const axisIds = this.checkAxes(pack, report);
    this.checkTemplates(pack, axisIds, report);
    this.checkIntents(pack, axisIds, report);
    this.checkGates(pack, report);
    this.checkAgent(pack, report);
    if (pack.dialogue !== undefined) for (const p of checkDialogueConfig(pack.dialogue, "khung-hoi-thoai")) report(p);
    if (pack.intentRules !== undefined) for (const p of checkIntentRules(pack.intentRules, "y-dinh")) report(p);
    if (pack.entities !== undefined) for (const p of checkEntityConfig(pack.entities, "thuc-the")) report(p);
    if (pack.scripts !== undefined) for (const p of checkScriptTexts(pack.scripts, "kich-ban")) report(p);
    if (pack.matching !== undefined) for (const p of checkMatchingConfig(pack.matching, "cham-diem")) report(p);
    if (pack.replyGate !== undefined) for (const p of checkReplyGateConfig(pack.replyGate, "cong-soat")) report(p);
    return problems;
  }

  private checkAgent(pack: IndustryPack, report: (m: string) => void): void {
    const agent = pack.agent;
    if (agent === undefined) return;
    if (agent.khoi.length === 0) report("Agent AI thieu luat (`agent.khoi`).");
    for (const problem of checkBlocksFree(agent.khoi, "agent.khoi")) report(problem);
    for (const field of ["mustHumanPattern", "handoffReplyPattern"] as const) {
      try { new RegExp(agent[field]); } catch { report(`Agent AI: \`${field}\` khong phai bieu thuc chinh quy hop le.`); }
    }
    for (const tool of agent.tools) {
      if (tool.moTa.trim() === "") report(`Agent AI: cong cu "${tool.name}" thieu mo ta (\`moTa\`) — mo hinh khong biet goi no the nao.`);
    }
  }

  private checkIdentity(pack: IndustryPack, report: (m: string) => void): void {
    if (normalize(pack.id) === "") report("Bo luat thieu ma dinh danh (`id`).");
    if (pack.identity.customerPronoun.trim() === "") report("Thieu cach xung ho voi khach.");
    if (pack.identity.selfPronoun.trim() === "") report("Thieu cach shop tu xung.");
    for (const t of pack.allowedTools) {
      if (!isToolName(t)) report(`Cong cu khong ton tai trong ban giao keo: "${String(t)}".`);
    }
  }

  private checkAxes(pack: IndustryPack, report: (m: string) => void): Set<string> {
    const axes = pack.itemShape.axes;
    if (axes.length === 0) report("Hinh dang mon hang phai co it nhat mot truc bien the.");
    const axisIds = new Set<string>();
    for (const axis of axes) {
      if (axisIds.has(axis.id)) report(`Truc bien the trung ma: "${axis.id}".`);
      axisIds.add(axis.id);
      if (!/^[a-z][a-z0-9_]*$/.test(axis.id)) {
        report(`Ma truc "${axis.id}" phai viet thuong khong dau, khong khoang trang.`);
      }
      try { new RegExp(axis.pattern); } catch { report(`Truc "${axis.id}" co mau bat hong: ${axis.pattern}`); }
      for (const c of axis.canonical) {
        try { new RegExp(c.pattern); } catch { report(`Truc "${axis.id}" co mau quy chuan hong: ${c.pattern}`); }
      }
      if (axis.label.trim() === "") report(`Truc "${axis.id}" thieu nhan hien cho nguoi doc.`);
      if (axis.examples.length === 0) report(`Truc "${axis.id}" phai co it nhat mot vi du de tu kiem.`);
      for (const ex of axis.examples) {
        const got = extractAxis(axis, ex.text);
        if (got !== ex.expect) {
          report(`Truc "${axis.id}" sai vi du: "${ex.text}" ra "${String(got)}", mong doi "${String(ex.expect)}".`);
        }
      }
      for (const ex of axis.examples) {
        if (ex.expect === null) continue;
        const once = canonicalValue(axis, ex.expect);
        if (canonicalValue(axis, once) !== once) {
          report(`Truc "${axis.id}": quy chuan khong on dinh voi "${ex.expect}" (chay hai lan ra khac nhau).`);
        }
      }
    }
    return axisIds;
  }

  private checkTemplates(pack: IndustryPack, axisIds: Set<string>, report: (m: string) => void): void {
    const known = new Set([...ENGINE_VARS, ...Object.keys(pack.extraValues ?? {})]);
    for (const id of axisIds) { known.add(id); known.add(`nhan_${id}`); }

    const usesStock = pack.intents.some((i) => i.tools.includes("stock.lookup"));
    const required = [...ALWAYS_REQUIRED];
    if (usesStock) required.push("in_stock", "out_of_stock");
    if (pack.lexicon.knownBrandsNotCarried.length > 0) required.push("brand_not_carried");

    for (const key of required) {
      const v = pack.templates[key];
      if (typeof v !== "string" || v.trim() === "") report(`Thieu mau cau "${key}".`);
    }
    // EVERY sentence sent to a customer goes through this check, including templates inside
    // INTENTS. Earlier only `pack.templates` was checked while `intent.template` is the sentence
    // sent on the success path; one without diacritics silently switched off the industry's
    // safety gates while the validator reported the pack as clean.
    const everyTemplate: { key: string; text: string }[] = Object.entries(pack.templates)
      .map(([key, text]) => ({ key, text }));
    for (const intent of pack.intents) {
      everyTemplate.push({ key: `y dinh "${intent.id}" - cau tra loi`, text: intent.template });
      everyTemplate.push({ key: `y dinh "${intent.id}" - cau hoi lai`, text: intent.askBackTemplate });
    }

    for (const { key, text } of everyTemplate) {
      for (const m of text.matchAll(/\{(\w+)\}/g)) {
        const name = m[1] ?? "";
        if (!known.has(name)) {
          report(`Mau cau "${key}" dung o thay the la: {${name}}. Neu co y thi khai kem gia tri vao \`extraValues\`.`);
        }
      }
      // A forbidden phrase inside the pack's OWN template: the gate does not inspect fallback
      // sentences, so this must be caught at build time.
      for (const phrase of pack.identity.neverSay) {
        if (stripDiacritics(text).includes(stripDiacritics(phrase))) {
          report(`Mau cau "${key}" chua cum bi cam "${phrase}".`);
        }
      }
      // A hard-coded digit in a template passes the "no invented numbers" gate only when it
      // happens to equal some number in the tool result: green on the desk, red in the field.
      const digits = text.replace(/\{\w+\}/g, " ").match(/\d+/g);
      if (digits !== null) {
        report(`Mau cau "${key}" co so viet cung: ${digits.join(", ")}. Moi con so phai den tu du lieu.`);
      }
    }
    // Templates sent to customers MUST carry diacritics. Not for looks: the safety gates inspect
    // the bot's sentence in diacritic form, because without diacritics "đôi" (pair) and "đổi"
    // (exchange) are one string. A pack without diacritics = safety gates switched off.
    for (const { key, text } of everyTemplate) {
      const words = text.replace(/\{\w+\}/g, " ").trim();
      if (words.split(/\s+/).filter((w) => w.length > 1).length >= 3 && !hasDiacritics(words)) {
        report(`Mau cau "${key}" viet khong dau. Mau cau gui cho khach phai co dau day du — ` +
          `cac cong an toan soi cau bot dua vao dau de phan biet nghia.`);
      }
    }
    for (const key of NO_DIGIT_TEMPLATES) {
      if (/\d/.test(pack.templates[key] ?? "")) {
        report(`Mau cau "${key}" khong duoc chua con so — no la cau du phong khi cong chan cau chinh.`);
      }
    }
  }

  private checkIntents(pack: IndustryPack, axisIds: Set<string>, report: (m: string) => void): void {
    if (pack.intents.length === 0) report("Bo luat khong khai y dinh nao.");
    if (pack.intentWhenItemNamed !== undefined &&
        !pack.intents.some((i) => i.id === pack.intentWhenItemNamed)) {
      report(`"intentWhenItemNamed" tro toi y dinh khong ton tai: "${pack.intentWhenItemNamed}".`);
    }
    const seen = new Set<string>();
    const validSlots = new Set<string>(["item", "phone", "topic", ...axisIds]);
    for (const intent of pack.intents) {
      if (seen.has(intent.id)) report(`Y dinh trung ma: "${intent.id}".`);
      seen.add(intent.id);
      if (intent.keywords.length === 0 && (intent.patterns ?? []).length === 0) {
        report(`Y dinh "${intent.id}" khong co tu khoa lan mau nhan dang — khong bao gio khop.`);
      }
      for (const s of intent.requiredSlots) {
        if (!validSlots.has(s)) {
          report(`Y dinh "${intent.id}" doi o "${s}" khong ton tai. O hop le: ${[...validSlots].join(", ")}.`);
        }
      }
      for (const t of intent.tools) {
        if (!pack.allowedTools.includes(t)) {
          report(`Y dinh "${intent.id}" goi cong cu "${t}" khong nam trong danh sach cho phep.`);
        } else if (!DISPATCHABLE_TOOLS.includes(t)) {
          // Declaring a tool the engine cannot run makes the bot ask back forever, which is very
          // hard to diagnose from the outside.
          report(`Y dinh "${intent.id}" goi cong cu "${t}" nhung bo may chua co cach chay no. ` +
            `Cong cu chay duoc: ${DISPATCHABLE_TOOLS.join(", ")}.`);
        }
      }
      for (const rx of intent.patterns ?? []) {
        try { new RegExp(rx); } catch { report(`Y dinh "${intent.id}" co mau nhan dang hong: ${rx}`); }
      }
      if (intent.template.trim() === "") report(`Y dinh "${intent.id}" thieu mau cau tra loi.`);
      if (intent.askBackTemplate.trim() === "") report(`Y dinh "${intent.id}" thieu mau cau hoi lai.`);
      if (intent.handoff !== true && intent.tools.length === 0) {
        report(`Y dinh "${intent.id}" khong goi cong cu nao va cung khong khai \`handoff\` — ` +
          `bot se hoi lai mai ma khong bao gio tra loi duoc.`);
      }
    }
    for (const intent of pack.intents) {
      for (const ex of intent.examples ?? []) {
        const got = detectIntent(pack, ex);
        if (got?.id !== intent.id) {
          report(`Vi du "${ex}" phai ra y dinh "${intent.id}" nhung ra "${got?.id ?? "khong co"}".`);
        }
      }
    }
  }

  private checkGates(pack: IndustryPack, report: (m: string) => void): void {
    const kinds = new Set(pack.gates.map((g) => g.kind));
    for (const must of ["no_unsourced_numbers", "forbidden_phrases", "no_facts_when_offline"] as const) {
      if (!kinds.has(must)) report(`Bo luat thieu cong bat buoc "${must}".`);
    }
    // Forbidden phrases and policy topics must carry diacritics: the gates rely on them to tell
    // meanings apart (e.g. "đôi" pair versus "đổi" exchange).
    for (const phrase of pack.identity.neverSay) {
      if (!hasDiacritics(phrase)) report(`Cum cam "${phrase}" phai viet co dau day du.`);
    }
    for (const g of pack.gates) {
      if (g.kind === "ask_back_once" && g.windowMinutes <= 0) {
        report("Cong `ask_back_once` phai co cua so lon hon 0 phut.");
      }
      if (g.kind === "brand_not_carried_needs_catalog" && g.minItems <= 0) {
        report("Cong `brand_not_carried_needs_catalog` phai co nguong muc luc lon hon 0.");
      }
      if (g.kind === "forbidden_patterns") {
        if (g.patterns.length === 0) report("Cong `forbidden_patterns` khong co mau nao.");
        for (const rx of g.patterns) {
          try { new RegExp(rx, "u"); } catch { report(`Cong \`forbidden_patterns\` co mau hong: ${rx}`); }
          if (!hasDiacritics(rx)) report(`Mau cam "${rx}" phai viet co dau — cong soi cau bot tren dang co dau.`);
        }
        if (g.reason.trim() === "") report("Cong `forbidden_patterns` phai noi ro ly do de nguoi van hanh doc nhat ky hieu duoc.");
      }
      if (g.kind === "require_source_for_claims") {
        for (const t of g.topics) {
          if (!hasDiacritics(t)) report(`Chu de chinh sach "${t}" phai viet co dau day du.`);
        }
        for (const rx of g.patterns ?? []) {
          try { new RegExp(rx, "u"); } catch { report(`Cong \`require_source_for_claims\` co mau hong: ${rx}`); }
          if (!hasDiacritics(rx)) report(`Mau chinh sach "${rx}" phai viet co dau.`);
        }
      }
    }
  }
}

const DEFAULT_VALIDATOR = new PackValidator();

/** Function facade: every problem of the pack, empty when valid. */
export function validatePack(pack: IndustryPack): string[] {
  return DEFAULT_VALIDATOR.validate(pack);
}

/** Throws with every problem listed when the pack is invalid. */
export function assertPackValid(pack: IndustryPack): void {
  const problems = validatePack(pack);
  if (problems.length > 0) {
    throw new Error(`Bo luat nganh "${pack.id}" chua dung:\n- ` + problems.join("\n- "));
  }
}

/**
 * The pack's filler words must not collide with any word of the merchant's item names or codes.
 *
 * `specificTokens` is the only door to the catalog; a word swallowed there is an item that can
 * never be sold. "giay moi" (loafers) nearly vanished because "moi" was a filler of the shoe pack.
 * `validatePack` does not know any merchant's catalog, so this runs AT CATALOG LOAD.
 * Returns the colliding filler words; empty means clean.
 */
export function checkFillerWordsAgainstCatalog(
  pack: IndustryPack, items: readonly { code: string; name: string }[]
): string[] {
  const fillers = new Set((pack.lexicon.fillerWords ?? []).map(normalize));
  const collisions = new Set<string>();
  for (const item of items) {
    // Tokens shorter than 3 characters NEVER pass `specificTokens`, so a 2-letter filler ("oi")
    // swallows nothing; reporting it would be a false alarm that drowns real ones.
    for (const t of tokens(`${item.code} ${item.name}`)) if (t.length >= 3 && fillers.has(t)) collisions.add(t);
  }
  return [...collisions].sort();
}
