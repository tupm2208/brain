// SOI BO LUAT NGANH TRUOC KHI NAP.
//
// Bo luat nganh la ho so do NGUOI viet — nguoi mo khach moi, khong nhat thiet biet lap trinh.
// Nen phai co cong soi that ky va bao loi bang tieng nguoi, thay vi de bot chay sai
// roi moi phat hien qua khach hang.

import { isToolName } from "@sp/contract";
import { DISPATCHABLE_TOOLS, canonicalValue, detectIntent, extractAxis } from "../engine/turn";
import type { IndustryPack } from "./types";
import { normalize, stripDiacritics, tokens } from "../engine/text";

/** O thay the bo may luon cap. Ho so them o rieng qua `extraVars`. */
export const ENGINE_VARS = [
  "khach", "shop", "mon", "hang", "truc", "bienthe",
  "tinhtrang", "ton", "gia", "giacao", "kho", "sokho", "dsbienthe",
  "chinhsach", "madon", "trangthai", "conphaitra", "songay", "link"
];

/** Luon phai co, moi nganh deu dung toi. */
const ALWAYS_REQUIRED = ["greeting", "ask_item", "ask_slot", "handoff", "offline"];
/** Mau cau tuy chon bo may biet dung. Khai them ngoai danh sach nay cung duoc. */
export const OPTIONAL_TEMPLATES = [
  "in_stock", "out_of_stock", "in_stock_range", "brand_not_carried",
  "tool_failed", "ask_item_has_image"
];

/**
 * Cau du phong khong duoc chua con so: khi mot cong chan cau chinh, bo may rot ve
 * cau du phong — cau do ma co so thi chinh no bi cong "khong bia so" chan tiep.
 */
const NO_DIGIT_TEMPLATES = ["handoff", "offline"];

/** Chuoi nay co viet co dau khong. Cac cong soi cau bot dua vao dau de phan biet nghia. */
function hasDiacritics(v: string): boolean {
  // Phai dung `stripDiacritics` chu KHONG dung `normalize`: `normalize` con gop
  // khoang trang va xoa dau cau, nen bat ky mau cau nao co {o thay the} hay dau cham
  // cung bi coi la "da co dau" va thoat cong. Cong soi coi nhu khong ton tai.
  return stripDiacritics(v) !== v.toLowerCase();
}

export function validatePack(pack: IndustryPack): string[] {
  const problems: string[] = [];
  const p = (m: string): void => { problems.push(m); };

  if (normalize(pack.id) === "") p("Bo luat thieu ma dinh danh (`id`).");
  if (pack.identity.customerPronoun.trim() === "") p("Thieu cach xung ho voi khach.");
  if (pack.identity.selfPronoun.trim() === "") p("Thieu cach shop tu xung.");

  for (const t of pack.allowedTools) {
    if (!isToolName(t)) p(`Cong cu khong ton tai trong ban giao keo: "${String(t)}".`);
  }

  // --- truc bien the ---
  const axes = pack.itemShape.axes;
  if (axes.length === 0) p("Hinh dang mon hang phai co it nhat mot truc bien the.");
  const axisIds = new Set<string>();
  for (const axis of axes) {
    if (axisIds.has(axis.id)) p(`Truc bien the trung ma: "${axis.id}".`);
    axisIds.add(axis.id);
    if (!/^[a-z][a-z0-9_]*$/.test(axis.id)) {
      p(`Ma truc "${axis.id}" phai viet thuong khong dau, khong khoang trang.`);
    }
    try { new RegExp(axis.pattern); } catch { p(`Truc "${axis.id}" co mau bat hong: ${axis.pattern}`); }
    for (const c of axis.canonical) {
      try { new RegExp(c.pattern); } catch { p(`Truc "${axis.id}" co mau quy chuan hong: ${c.pattern}`); }
    }
    if (axis.label.trim() === "") p(`Truc "${axis.id}" thieu nhan hien cho nguoi doc.`);
    if (axis.examples.length === 0) p(`Truc "${axis.id}" phai co it nhat mot vi du de tu kiem.`);
    for (const ex of axis.examples) {
      const got = extractAxis(axis, ex.text);
      if (got !== ex.expect) {
        p(`Truc "${axis.id}" sai vi du: "${ex.text}" ra "${String(got)}", mong doi "${String(ex.expect)}".`);
      }
    }
    for (const ex of axis.examples) {
      if (ex.expect === null) continue;
      const once = canonicalValue(axis, ex.expect);
      if (canonicalValue(axis, once) !== once) {
        p(`Truc "${axis.id}": quy chuan khong on dinh voi "${ex.expect}" (chay hai lan ra khac nhau).`);
      }
    }
  }

  // --- mau cau ---
  const known = new Set([...ENGINE_VARS, ...Object.keys(pack.extraValues ?? {})]);
  for (const id of axisIds) { known.add(id); known.add(`nhan_${id}`); }

  const usesStock = pack.intents.some((i) => i.tools.includes("stock.lookup"));
  const required = [...ALWAYS_REQUIRED];
  if (usesStock) required.push("in_stock", "out_of_stock");
  if (pack.lexicon.knownBrandsNotCarried.length > 0) required.push("brand_not_carried");

  for (const key of required) {
    const v = pack.templates[key];
    if (typeof v !== "string" || v.trim() === "") p(`Thieu mau cau "${key}".`);
  }
  // MOI cau gui cho khach deu phai qua bo soi nay, ke ca mau cau nam trong Y DINH.
  // Truoc day chi soi `pack.templates`, ma `intent.template` moi la cau gui o duong
  // tra loi thanh cong — cho do khong dau thi tat sach cong an toan cua nganh,
  // ma bo soi van bao ho so sach.
  const moiMauCau: { key: string; text: string }[] = Object.entries(pack.templates)
    .map(([key, text]) => ({ key, text }));
  for (const intent of pack.intents) {
    moiMauCau.push({ key: `y dinh "${intent.id}" - cau tra loi`, text: intent.template });
    moiMauCau.push({ key: `y dinh "${intent.id}" - cau hoi lai`, text: intent.askBackTemplate });
  }

  for (const { key, text } of moiMauCau) {
    for (const m of text.matchAll(/\{(\w+)\}/g)) {
      const name = m[1] ?? "";
      if (!known.has(name)) {
        p(`Mau cau "${key}" dung o thay the la: {${name}}. Neu co y thi khai kem gia tri vao \`extraValues\`.`);
      }
    }
    // Cum bi cam nam ngay trong mau cau cua chinh ho so: cong chan cau bot khong
    // soi cac cau du phong, nen phai bat tu luc dung ban.
    for (const phrase of pack.identity.neverSay) {
      if (stripDiacritics(text).includes(stripDiacritics(phrase))) {
        p(`Mau cau "${key}" chua cum bi cam "${phrase}".`);
      }
    }
    // So chot cung trong mau cau: no se lot cong "khong bia so" moi khi tinh co
    // trung mot con so nao do trong ket qua cong cu — xanh tren may, do ngoai doi.
    const conSo = text.replace(/\{\w+\}/g, " ").match(/\d+/g);
    if (conSo !== null) {
      p(`Mau cau "${key}" co so viet cung: ${conSo.join(", ")}. Moi con so phai den tu du lieu.`);
    }
  }
  // Mau cau gui cho khach BAT BUOC viet co dau. Ly do khong phai tham my:
  // cac cong an toan soi cau bot tren dang co dau, vi bo dau thi "đôi" (dem giay)
  // va "đổi" (doi tra) thanh mot chuoi. Ho so viet khong dau = tat cong an toan.
  for (const { key, text } of moiMauCau) {
    const chu = text.replace(/\{\w+\}/g, " ").trim();
    if (chu.split(/\s+/).filter((w) => w.length > 1).length >= 3 && !hasDiacritics(chu)) {
      p(`Mau cau "${key}" viet khong dau. Mau cau gui cho khach phai co dau day du — ` +
        `cac cong an toan soi cau bot dua vao dau de phan biet nghia.`);
    }
  }
  for (const key of NO_DIGIT_TEMPLATES) {
    if (/\d/.test(pack.templates[key] ?? "")) {
      p(`Mau cau "${key}" khong duoc chua con so — no la cau du phong khi cong chan cau chinh.`);
    }
  }

  // --- y dinh ---
  if (pack.intents.length === 0) p("Bo luat khong khai y dinh nao.");
  if (pack.intentWhenItemNamed !== undefined &&
      !pack.intents.some((i) => i.id === pack.intentWhenItemNamed)) {
    p(`"intentWhenItemNamed" tro toi y dinh khong ton tai: "${pack.intentWhenItemNamed}".`);
  }
  const seen = new Set<string>();
  const validSlots = new Set<string>(["item", "phone", "topic", ...axisIds]);
  for (const intent of pack.intents) {
    if (seen.has(intent.id)) p(`Y dinh trung ma: "${intent.id}".`);
    seen.add(intent.id);
    if (intent.keywords.length === 0 && (intent.patterns ?? []).length === 0) {
      p(`Y dinh "${intent.id}" khong co tu khoa lan mau nhan dang — khong bao gio khop.`);
    }
    for (const s of intent.requiredSlots) {
      if (!validSlots.has(s)) {
        p(`Y dinh "${intent.id}" doi o "${s}" khong ton tai. O hop le: ${[...validSlots].join(", ")}.`);
      }
    }
    for (const t of intent.tools) {
      if (!pack.allowedTools.includes(t)) {
        p(`Y dinh "${intent.id}" goi cong cu "${t}" khong nam trong danh sach cho phep.`);
      } else if (!DISPATCHABLE_TOOLS.includes(t)) {
        // Khai mot cong cu ma bo may chua biet chay thi bot se lang le hoi lai mai —
        // rat kho doan ra khi nhin tu ben ngoai.
        p(`Y dinh "${intent.id}" goi cong cu "${t}" nhung bo may chua co cach chay no. ` +
          `Cong cu chay duoc: ${DISPATCHABLE_TOOLS.join(", ")}.`);
      }
    }
    for (const rx of intent.patterns ?? []) {
      try { new RegExp(rx); } catch { p(`Y dinh "${intent.id}" co mau nhan dang hong: ${rx}`); }
    }
    if (intent.template.trim() === "") p(`Y dinh "${intent.id}" thieu mau cau tra loi.`);
    if (intent.askBackTemplate.trim() === "") p(`Y dinh "${intent.id}" thieu mau cau hoi lai.`);
    if (intent.handoff !== true && intent.tools.length === 0) {
      p(`Y dinh "${intent.id}" khong goi cong cu nao va cung khong khai \`handoff\` — ` +
        `bot se hoi lai mai ma khong bao gio tra loi duoc.`);
    }
  }
  for (const intent of pack.intents) {
    for (const ex of intent.examples ?? []) {
      const got = detectIntent(pack, ex);
      if (got?.id !== intent.id) {
        p(`Vi du "${ex}" phai ra y dinh "${intent.id}" nhung ra "${got?.id ?? "khong co"}".`);
      }
    }
  }

  // --- cong an toan ---
  const kinds = new Set(pack.gates.map((g) => g.kind));
  for (const must of ["no_unsourced_numbers", "forbidden_phrases", "no_facts_when_offline"] as const) {
    if (!kinds.has(must)) p(`Bo luat thieu cong bat buoc "${must}".`);
  }
  // Cum cam va chu de chinh sach phai viet CO DAU: cong soi cau bot dua vao dau de
  // phan biet nghia (vi du "đôi" dem giay voi "đổi" doi tra).
  for (const phrase of pack.identity.neverSay) {
    if (!hasDiacritics(phrase)) p(`Cum cam "${phrase}" phai viet co dau day du.`);
  }
  for (const g of pack.gates) {
    if (g.kind === "ask_back_once" && g.windowMinutes <= 0) {
      p("Cong `ask_back_once` phai co cua so lon hon 0 phut.");
    }
    if (g.kind === "brand_not_carried_needs_catalog" && g.minItems <= 0) {
      p("Cong `brand_not_carried_needs_catalog` phai co nguong muc luc lon hon 0.");
    }
    if (g.kind === "forbidden_patterns") {
      if (g.patterns.length === 0) p("Cong `forbidden_patterns` khong co mau nao.");
      for (const rx of g.patterns) {
        try { new RegExp(rx, "u"); } catch { p(`Cong \`forbidden_patterns\` co mau hong: ${rx}`); }
        if (!hasDiacritics(rx)) p(`Mau cam "${rx}" phai viet co dau — cong soi cau bot tren dang co dau.`);
      }
      if (g.reason.trim() === "") p("Cong `forbidden_patterns` phai noi ro ly do de nguoi van hanh doc nhat ky hieu duoc.");
    }
    if (g.kind === "require_source_for_claims") {
      for (const t of g.topics) {
        if (!hasDiacritics(t)) p(`Chu de chinh sach "${t}" phai viet co dau day du.`);
      }
      for (const rx of g.patterns ?? []) {
        try { new RegExp(rx, "u"); } catch { p(`Cong \`require_source_for_claims\` co mau hong: ${rx}`); }
        if (!hasDiacritics(rx)) p(`Mau chinh sach "${rx}" phai viet co dau.`);
      }
    }
  }

  return problems;
}

export function assertPackValid(pack: IndustryPack): void {
  const problems = validatePack(pack);
  if (problems.length > 0) {
    throw new Error(`Bo luat nganh "${pack.id}" chua dung:\n- ` + problems.join("\n- "));
  }
}

/**
 * Tu dem cua ho so KHONG duoc trung voi bat ky tu nao trong ten/ma mon cua shop.
 *
 * `specificTokens` la cua duy nhat dan toi muc luc; mot tu bi nuot o day la mon do khong
 * bao gio ban duoc — va "giay moi" (giay luoi) suyt bien mat vi "moi" nam trong tu dem
 * cua chinh nganh giay. `validatePack` khong biet muc luc cua shop nao, nen viec nay
 * phai lam LUC NAP MUC LUC. Tra ve danh sach tu dem pham loi; rong la sach.
 */
export function kiemTuDemVoiMucLuc(
  pack: IndustryPack, items: readonly { code: string; name: string }[]
): string[] {
  const dem = new Set((pack.lexicon.fillerWords ?? []).map(normalize));
  const pham = new Set<string>();
  for (const it of items) {
    // Token duoi 3 chu KHONG bao gio qua `specificTokens`, nen tu dem 2 chu ("oi") khong nuot
    // gi ca — bao no la bao gia, nhat ky nhieu thi bao that bi chim.
    for (const t of tokens(`${it.code} ${it.name}`)) if (t.length >= 3 && dem.has(t)) pham.add(t);
  }
  return [...pham].sort();
}
