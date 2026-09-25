/**
 * @file DRAFT WRITER — Sales Desk's LLM#3 (`ai_fallback.js` draftAIFallback / buildFallbackPrompt),
 * moved to Xeon 24/09/2026.
 *
 * The safety net under the tier-2 agent: when the agent is broken, out of quota or switched off by
 * its breaker, ONE model call writes a short reply from the facts the system already looked up —
 * no tools, no loop. Its prompt is the lean one Desk settled on 30/08 after measuring that a
 * 37k-character prompt was 45% rules the model read as equals: the core rules always (`LEAN_CORE`),
 * the situation rules only when the turn is in that situation (`leanRuleSet`), 8–12 real exchanges
 * of the person on duty picked by intent (`humanExamplesText`), the operator guardrails filtered by
 * section (`leanGuardrails`) and cut at 12k, then the facts and the transcript.
 *
 * Everything the model is told is DATA: `loi-chung/soan-nhap.json` ⊕ `nganh/<id>/soan-nhap.json`
 * ⊕ `nganh/<id>/vi-du-nguoi-truc.json`. The class computes the turn's situations, picks what
 * applies, fills the placeholders and reads the answer. A broken answer is `ok: false` with the
 * hand-over sentence from the JSON, so the caller can send it and call a person.
 */

import type { ShopProfile } from "@sp/contract";
import { fillAgentText, redactPII, stripDiacritics, type DraftText, type HumanExample, type HumanExamples } from "@sp/brain";
import type { Logger } from "../support/logger";
import type { ChatMessage, ChatModelPort } from "../agent/chat-model";
import { parseAgentJson } from "../agent/sales-agent";
import type { TurnContext } from "./turn-context";
import { withUsage } from "../ai/usage-context";
import { promptFillValues, renderLabelledHistory, renderPageFacts, type ContextAnalysis, type UsageTag } from "./context-analyzer";

/** Desk's draft had no timeout of its own; the gateway's 25 s applied. A caller with less budget passes less. */
export const DRAFT_TIMEOUT_MS = 20_000;
/** Desk's LLM#3 temperature. */
export const DRAFT_TEMPERATURE = 0.2;
/** Desk cut the guardrails file at 12k characters. */
export const GUARDRAILS_CHARS = 12_000;
const EXAMPLES_PER_GROUP = 8;
const EXAMPLES_OUT_OF_STOCK = 4;
const CATALOG_SUMMARY_ITEMS = 5;
const NARRATIVE_CHARS = 400;
const GOAL_CHARS = 160;

/** The facts the system looked up for this turn; each is shown to the model under its own label. */
export interface DraftFacts {
  /** Desk `stockFacts`: `{requestedSize, stock, variantsAvailable, filterLink, stockType, price, kho...}`. */
  stockFacts?: Record<string, unknown> | null | undefined;
  /** Desk `stockCascade`: `{resolvedLevel, ...}`. */
  stockCascade?: Record<string, unknown> | null | undefined;
  /** Candidate products (`{code, name, brand, color, source, price, sizes}`); the first five are shown. */
  catalog?: readonly Record<string, unknown>[] | undefined;
  adviceCandidates?: readonly unknown[] | undefined;
  imageProducts?: readonly unknown[] | undefined;
  multiItems?: readonly unknown[] | undefined;
  /** Results of the lookups LLM#1 asked for: `{command, ...result}`. */
  lookupResults?: readonly Record<string, unknown>[] | undefined;
  /** The shop's policy text, verbatim. */
  policy?: string | undefined;
  recommendationLink?: string | undefined;
  /** Any further system notes for this turn (size from the chart, "asked by name", ...), one per line. */
  notes?: readonly string[] | undefined;
  externalProduct?: unknown;
  customerPortrait?: string | undefined;
  lineDna?: string | undefined;
}

export interface DraftInput {
  turn: Pick<TurnContext, "history" | "burstText" | "replyNote" | "focusedProduct">;
  /** The intent the router settled on (LLM#1's, or the rule engine's). */
  intent: string;
  analysis?: ContextAnalysis | null | undefined;
  /** The router's entities when they differ from the analysis's. */
  entities?: Record<string, unknown> | undefined;
  frameText?: string | undefined;
  memoryText?: string | undefined;
  /** The episode stage from the memory: "tu_van" | "chot" | "sau_dat". */
  stage?: string | undefined;
  /** The size the page asked about earlier (Desk `askedSize`), to spot a letter size (S/M/L). */
  askedSize?: string | undefined;
  /** A person will review before sending (Desk `_ai_then_human`). */
  humanReview?: boolean | undefined;
  /** Situations the caller knows from its own signals: `dich_danh`, `pho_thong`, `chot_kem_hoi`, `mac_ca`, ... */
  extraTags?: readonly string[] | undefined;
  facts: DraftFacts;
  /** Tier 1 ⊕ tier 2 prompt text (`loadDraftText`). */
  text: DraftText;
  /** The industry's real exchanges (`loadHumanExamples`). */
  examples: HumanExamples;
  site: string;
  shopName?: string | undefined;
  hoSo?: ShopProfile | null | undefined;
  usage: UsageTag;
  nowIso?: string | undefined;
}

export type DraftOutcome =
  | { ok: true; reply: string; needsHuman: boolean; reason: string; raw: string; model?: string | undefined }
  /** `handoffReply`: the JSON's hand-over sentence, filled for this shop — what the caller sends while calling a person. */
  | { ok: false; viSao: string; handoffReply: string; raw?: string | undefined };

export interface DraftWriterOptions {
  model: ChatModelPort;
  logger: Logger;
}

const PAYMENT_RE = /(chuyen khoan|\bck\b|stk|coc|gui nhe|da gui)/;
const CANCEL_RE = /(khong lay|ko lay|huy|thoi khong)/;
const BARGAIN_RE = /(giam gia|bot (gia|chut|ti)|mac ca|re hon|fix (gia|them)|giam them)/;

export class DraftWriter {
  constructor(private readonly options: DraftWriterOptions) {}

  ready(): boolean {
    return this.options.model.ready();
  }

  /**
   * The situations of one turn, as Desk's `leanRuleSet` derived them: every rule whose `khi` names
   * one of these is loaded. `luon` is always in.
   */
  static situationTags(input: DraftInput): Set<string> {
    const tags = new Set<string>(["luon", `y:${input.intent}`, ...(input.extraTags ?? [])]);
    const msg = stripDiacritics(input.turn.burstText).toLowerCase();
    const a = input.analysis ?? null;
    const f = input.facts;
    const stock = f.stockFacts ?? null;
    const cascade = f.stockCascade ?? null;
    const readyToBuy = a !== null && a.needBrief["readyToBuy"] === true;
    const closing = input.intent === "place_order" || input.stage === "chot" || readyToBuy;
    tags.add(closing ? "chot" : "chua_chot");
    if (input.stage === "sau_dat") tags.add("sau_dat");
    if (stock !== null && stock["requestedSize"] && (stock["stock"] === null || stock["stock"] === undefined)) tags.add("het_hang");
    const level = cascade !== null ? String(cascade["resolvedLevel"] ?? "") : "";
    if (level !== "" && level !== "exact_code") tags.add("het_hang");
    if (stock !== null && Array.isArray(stock["variantsAvailable"]) && stock["variantsAvailable"].length > 0) tags.add("con_bien_the");
    if (stock !== null && stock["stockType"]) tags.add("hang_order");
    if (cascade !== null) tags.add("bac_thang");
    if ((f.adviceCandidates ?? []).length > 0) tags.add("goi_y");
    if ((f.imageProducts ?? []).length > 0) tags.add("anh_mau");
    if ((f.multiItems ?? []).length > 0) tags.add("nhieu_mau");
    if ((f.catalog ?? []).length === 0) tags.add("khong_catalog");
    if (f.recommendationLink) tags.add("co_link");
    const lookups = f.lookupResults ?? [];
    if (["shipping", "return_exchange"].includes(input.intent) || lookups.some((l) => ["check_order", "check_policy"].includes(String(l["command"] ?? "")))) tags.add("van_chuyen");
    if (input.frameText) tags.add("khung");
    if (a !== null && ["product_advice", "ask_size", "unknown"].includes(input.intent)) tags.add("tu_van");
    if (a !== null && /tennis|pickleball/.test(String(a.needBrief["sport"] ?? ""))) tags.add("san_tennis");
    if (input.intent === "payment_confirmation" || PAYMENT_RE.test(msg)) tags.add("thanh_toan");
    if (input.intent === "send_image" || (input.turn.history.at(-1)?.images ?? 0) > 0) tags.add("co_anh");
    if (CANCEL_RE.test(msg)) tags.add("huy");
    if (input.humanReview) tags.add("nguoi_duyet");
    if (input.askedSize !== undefined && input.askedSize !== "" && /^[^0-9]*$/.test(input.askedSize)) tags.add("size_chu");
    if (f.externalProduct !== undefined && f.externalProduct !== null) tags.add("sp_ngoai");
    if (BARGAIN_RE.test(msg)) tags.add("mac_ca");
    return tags;
  }

  /**
   * 8 examples of the intent's group, plus 4 "out of stock" ones when the variant asked for is
   * gone (Desk `humanExamplesText`). The group comes from the JSON's `nhomViDu`; a money word in
   * the message wins, and a message with no intent group is read by its own words.
   */
  static pickExamples(examples: HumanExamples, text: DraftText, intent: string, message: string, outOfStock: boolean): HumanExample[] {
    const msg = stripDiacritics(message).toLowerCase();
    let group = text.nhomViDu[intent] ?? "";
    if (/(chuyen khoan|\bck\b|stk|coc|tai khoan)/.test(msg)) group = text.nhomViDu["payment_confirmation"] ?? group;
    if (group === "") {
      group = /(size|con (ko|khong|k))/.test(msg) ? (text.nhomViDu["ask_size"] ?? "")
        : /(gia|bao nhieu)/.test(msg) ? (text.nhomViDu["ask_price"] ?? "")
          : (text.nhomViDu["_macDinh"] ?? "");
    }
    const picks = [...(examples[group] ?? []).slice(0, EXAMPLES_PER_GROUP)];
    if (outOfStock) picks.push(...(examples[text.nhomViDu["_hetHang"] ?? "het_hang"] ?? []).slice(0, EXAMPLES_OUT_OF_STOCK));
    return picks;
  }

  /** Desk `fbContextNarrative`: the analysis in one line, product codes the turn never saw blanked to "[mã cũ]". */
  static contextNarrative(input: DraftInput, label: string, goalLabel: string): string {
    const a = input.analysis ?? null;
    if (a === null) return "";
    let sum = (a.episodeSummary || a.contextSummary).trim();
    if (sum === "") return "";
    if (a.focus.product !== "") sum += ` | MAU CHINH sau tin nay: ${a.focus.product.slice(0, 80)}${a.focus.changed ? " (khach VUA DOI mau chinh)" : ""}`;
    const evidence = stripDiacritics([
      input.turn.history.map((m) => m.text).join(" "),
      input.turn.burstText,
      (input.facts.catalog ?? []).map((q) => `${String(q["code"] ?? "")} ${String(q["name"] ?? "")}`).join(" "),
      input.facts.stockFacts ? String(input.facts.stockFacts["productCode"] ?? "") : "",
      input.turn.focusedProduct ? `${input.turn.focusedProduct.code ?? ""} ${input.turn.focusedProduct.name ?? ""}` : ""
    ].join(" ")).toLowerCase();
    sum = sum.replace(/\b[A-Z]{1,3}\d{4,6}\b/g, (code) => (evidence.includes(code.toLowerCase()) ? code : "[mã cũ]"));
    const goal = a.customerGoal.trim();
    return `${label} ${sum.slice(0, NARRATIVE_CHARS)}${goal !== "" ? ` | ${goalLabel} ${goal.slice(0, GOAL_CHARS)}` : ""}`;
  }

  /** The exact messages the model is shown; exported for the dossier and the tests. */
  static composePrompt(input: DraftInput): ChatMessage[] {
    const text = input.text;
    const values = promptFillValues(input);
    const fill = (s: string): string => fillAgentText(s, values);
    // A label's own slots ({so}, {size}, {spNgoai}, {conThieu}) go in BEFORE the profile fill, or the fill reads them as profile fields.
    const nhan = (key: string, vars: Record<string, string> = {}): string => fill(
      Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text.nhan[key] ?? "")
    );
    const tags = DraftWriter.situationTags(input);
    const applies = (khi: readonly string[]): boolean => khi.length === 0 || khi.some((k) => tags.has(k));
    const f = input.facts;
    const a = input.analysis ?? null;

    const rules = text.luat.filter((rule) => applies(rule.khi)).map((rule) => `${rule.id}. ${fill(rule.loiDan)}`);
    const guard = text.guardrails.filter((g) => applies(g.khi)).map((g) => `## ${g.tieuDe}\n${fill(g.loiDan)}`).join("\n").slice(0, GUARDRAILS_CHARS);
    const stock = f.stockFacts ?? null;
    const outOfStock = stock !== null && (stock["stock"] === null || stock["stock"] === undefined) && Boolean(stock["requestedSize"]);
    const examples = DraftWriter.pickExamples(input.examples, text, input.intent, input.turn.burstText, outOfStock);
    const catalog = (f.catalog ?? []).slice(0, CATALOG_SUMMARY_ITEMS).map((p) => ({
      code: p["code"], name: p["name"], brand: p["brand"], color: p["color"] ?? "", source: p["source"], price: p["price"], sizes: p["sizes"]
    }));
    const multi = f.multiItems ?? [];
    const entities = input.entities ?? a?.entities ?? {};

    const parts: string[] = [
      nhan("moDau"),
      nhan("batBuoc"),
      "",
      nhan("luat"),
      ...rules,
      nhan("schema"),
      "",
      DraftWriter.contextNarrative(input, nhan("boiCanh"), nhan("mucTieu")),
      renderPageFacts(input.turn.history, { loiNguoiTruc: nhan("loiNguoiTruc") || "LOI NGUOI TRUC (NGUOI THAT) DA NOI TRUOC DO (su that cua hoi thoai):", loiBot: nhan("loiBot") || "CAU PAGE DA GUI TRUOC DO, CHUA CHAC DO NGUOI THAT GO (khong phai nguon su that):" }),
      examples.length > 0 ? `${nhan("viDu")}\n${examples.map((x) => `  Khach: ${fill(x.k)} → Nguoi truc: ${fill(x.n)}`).join("\n")}` : "",
      `${nhan("tinKhach")} ${JSON.stringify(input.turn.burstText)}`,
      input.turn.replyNote ? `GHI CHU HE THONG: ${input.turn.replyNote}` : "",
      `${nhan("lichSu")}\n${renderLabelledHistory(input.turn.history, input.nowIso)}`,
      `${nhan("hoSo")} ${input.memoryText?.trim() ? input.memoryText.trim() : nhan("hoSoTrong")}`,
      `${nhan("mauTapTrung")} ${JSON.stringify(input.turn.focusedProduct ?? null)}`,
      f.externalProduct !== undefined && f.externalProduct !== null ? nhan("spNgoai", { spNgoai: JSON.stringify(f.externalProduct) }) : "",
      `${nhan("yDinh")} ${JSON.stringify({ intent: input.intent, confidence: a?.confidence ?? 0 })}`,
      `${nhan("thucThe")} ${JSON.stringify(entities)}`,
      a !== null && Object.keys(a.needBrief).length > 0 ? `${nhan("nhuCau")} ${JSON.stringify(a.needBrief)}` : "",
      f.stockCascade ? `${nhan("bacThang")} ${JSON.stringify(f.stockCascade)}` : "",
      `${nhan("catalog")} ${JSON.stringify(catalog)}`,
      (f.adviceCandidates ?? []).length > 0 ? `${nhan("goiY")} ${JSON.stringify(f.adviceCandidates)}` : "",
      (f.imageProducts ?? []).length > 0 ? `${nhan("anhMau")} ${JSON.stringify(f.imageProducts)}` : "",
      input.humanReview ? nhan("nguoiDuyet") : "",
      tags.has("chot_kem_hoi") ? nhan("chotKemHoi", { conThieu: entities["size"] ? "khong thieu gi — xac nhan lai mau + bien the + gia" : "bien the (size)" }) : "",
      f.lineDna?.trim() ? `${nhan("dna")}\n${f.lineDna.trim()}` : "",
      nhan("xungHo"),
      multi.length > 0 ? `${nhan("nhieuMau", { so: String(multi.length) })} ${JSON.stringify(multi)}` : "",
      stock !== null ? `${nhan("tonThucTe", { size: String(stock["requestedSize"] ?? "") })} ${JSON.stringify(stock)}` : "",
      input.frameText ? `${nhan("khung")} ${input.frameText}` : "",
      (f.lookupResults ?? []).length > 0 ? `${nhan("traCuu")} ${JSON.stringify(f.lookupResults)}` : "",
      f.policy?.trim() ? `${nhan("chinhSach")}\n${f.policy.trim()}` : "",
      f.customerPortrait?.trim() ? `${nhan("chanDung")} ${f.customerPortrait.trim()}` : "",
      f.recommendationLink ? `${nhan("linkLoc")} ${JSON.stringify(f.recommendationLink)}` : "",
      (f.notes ?? []).length > 0 ? `${nhan("ghiChu")}\n${(f.notes ?? []).map((n) => `- ${fill(n)}`).join("\n")}` : "",
      guard.trim() !== "" ? `${nhan("guardrails")}\n${guard}` : ""
    ];
    return [
      { role: "system", content: fill(text.heThong) || "Ban la tro ly ban hang. Chi dung du lieu duoc cung cap. Chi tra JSON hop le." },
      { role: "user", content: parts.filter((p, i) => p !== "" || parts[i - 1] !== "").join("\n") }
    ];
  }

  /** The hand-over sentence for this shop (the JSON's, `{khach}` filled), the caller's reply when the draft fails. */
  static handoffReply(input: Pick<DraftInput, "text" | "site" | "shopName" | "hoSo">): string {
    return fillAgentText(input.text.cauChuyenNguoi, promptFillValues(input)).trim()
      || "Dạ mình chờ em một chút, em nhờ người phụ trách kiểm tra và trả lời ngay ạ.";
  }

  /**
   * One model call at temperature 0.2, JSON mode, within `budgetMs`. `ok: false` when the model is
   * off, fails, or answers without a `reply` — the caller sends `handoffReply` and calls a person.
   */
  async draft(input: DraftInput, budgetMs: number = DRAFT_TIMEOUT_MS): Promise<DraftOutcome> {
    const handoffReply = DraftWriter.handoffReply(input);
    if (!this.options.model.ready()) return { ok: false, viSao: "mo hinh chua cau hinh", handoffReply };
    const timeoutMs = Math.max(1000, Math.min(DRAFT_TIMEOUT_MS, Math.floor(budgetMs)));
    const messages = DraftWriter.composePrompt(input);
    const answer = await withUsage(
      { shop: input.usage.shop, agent: "draft_l3", channel: input.usage.channel, conversationId: input.usage.conversationId },
      () => this.options.model.complete(messages, { temperature: DRAFT_TEMPERATURE, json: true, timeoutMs })
    );
    if (!answer.ok) {
      this.options.logger.warn(`[soan-nhap] mo hinh loi: ${answer.viSao}`);
      return { ok: false, viSao: answer.viSao, handoffReply };
    }
    const parsed = parseAgentJson(answer.text);
    const reply = parsed !== null && typeof parsed["reply"] === "string" ? parsed["reply"].trim() : "";
    if (reply === "") {
      this.options.logger.warn(`[soan-nhap] JSON khong co reply: ${redactPII(answer.text).slice(0, 200)}`);
      return { ok: false, viSao: "khong_doc_duoc_json", handoffReply, raw: answer.text };
    }
    return {
      ok: true, reply,
      needsHuman: parsed!["needsHuman"] === true,
      reason: typeof parsed!["reason"] === "string" ? parsed!["reason"] : "",
      raw: answer.text, model: answer.model
    };
  }
}
