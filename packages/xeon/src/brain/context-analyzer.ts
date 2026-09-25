/**
 * @file CONTEXT ANALYZER — Sales Desk's LLM#1 (`ai_fallback.js` analyzeConversationContext),
 * moved to Xeon 24/09/2026.
 *
 * Before the router decides anything, one cheap model call reads the WHOLE conversation and says
 * what the customer means: the intent, the product named (brand / line / version split, so stock
 * is looked up by field, not by string), the variant, the need profile, the product in focus of
 * this shopping episode and up to three lookups the system should run. It never concludes a price,
 * a stock level or a policy — that is the landing's job.
 *
 * The prompt is DATA: `loi-chung/phan-tich-ngu-canh.json` (every industry) ⊕
 * `nganh/<id>/phan-tich-ngu-canh.json` (the industry's fields and rules), filled from the shop
 * profile (`{khach}`, `{tenShop}`, ...). This class only arranges the turn's data under those
 * labels, calls the model at temperature 0 as JSON, and checks the answer's shape. A broken answer
 * is `null`: the router runs without it, as Desk did when every provider failed.
 */

import { emptyShopProfile, type ShopProfile } from "@sp/contract";
import { fillAgentText, redactPII, renderBlocks, type ContextAnalysisText, type FillValues } from "@sp/brain";
import type { Logger } from "../support/logger";
import type { ChatMessage, ChatModelPort } from "../agent/chat-model";
import { parseAgentJson, type HistoryLine } from "../agent/sales-agent";
import type { TurnContext } from "./turn-context";
import { withUsage } from "../ai/usage-context";

/** Desk's default for LLM#1 was 12 s; 15 s since 25/09/2026 (see `ContextAnalyzerOptions.timeoutMs`). */
export const CONTEXT_ANALYSIS_TIMEOUT_MS = 15_000;
/** Desk read the last 30 messages. */
export const CONTEXT_HISTORY_LINES = 30;
/** Desk used the last 10 page messages as "what the page already said". */
const PAGE_FACT_LINES = 10;
const PAGE_FACT_CHARS = 160;
const MAX_LOOKUPS = 3;
/** A photo older than this is history, not "the picture the customer just sent" (Desk v17). */
const OLD_IMAGE_MS = 6 * 3600 * 1000;
/** Two lines further apart than this open a new session in the transcript (Desk episode gap). */
const SESSION_GAP_MS = 6 * 3600 * 1000;

/** What the model is asked to return; every field is checked, missing ones are empty. */
export interface ContextAnalysis {
  intent: string;
  confidence: number;
  /** `brand`, `productLine`, `modelVersion`, `productType`, `size`, `color`... — the keys the two tiers declared. */
  entities: Record<string, string | number | boolean>;
  needProfile: { buyerType: string; experience: string; insistOnProduct: boolean };
  /** The industry's need brief (`sport`, `pace`, `distance`, `missingCritical`...), free-form. */
  needBrief: Record<string, unknown>;
  focus: { product: string; products: string[]; changed: boolean; reason: string; roles: { product: string; role: string }[] };
  contextSummary: string;
  episodeSummary: string;
  customerGoal: string;
  referencesPreviousMessage: boolean;
  missingInformation: string[];
  lookupCommands: { command: string; args: Record<string, unknown> }[];
  riskFlags: string[];
}

/** Who the call is for, for the token ledger (`withUsage`). */
export interface UsageTag {
  shop: string;
  channel?: string | undefined;
  conversationId?: string | undefined;
}

export interface ContextAnalysisInput {
  /** The turn as `TurnContextBuilder` built it; only these four fields are read. */
  turn: Pick<TurnContext, "history" | "burstText" | "replyNote" | "focusedProduct">;
  /** The dialogue frame in words (`TurnContextBuilder.describeFrame`), "" when the frame says nothing. */
  frameText?: string | undefined;
  /** The conversation ledger + episode rendered (`TurnContextBuilder.renderMemory`). */
  memoryText?: string | undefined;
  /** A product the shop typed by hand, outside the catalog, that the customer settled on. */
  externalProduct?: unknown;
  /** The customer's past orders in words, when the landing knows them. */
  customerPortrait?: string | undefined;
  /** The line DNA of the product named, in words. */
  lineDna?: string | undefined;
  /** Tier 1 ⊕ tier 2 prompt text (`loadContextAnalysisText`). */
  text: ContextAnalysisText;
  site: string;
  shopName?: string | undefined;
  hoSo?: ShopProfile | null | undefined;
  usage: UsageTag;
  nowIso?: string | undefined;
}

export interface ContextAnalyzerOptions {
  model: ChatModelPort;
  logger: Logger;
  /** The call's own ceiling (`XEON_AI_PHAN_TICH_MS`, default 15 s since 25/09/2026: 12 s timed out 4 turns in 20 on the real gateway). */
  timeoutMs?: number | undefined;
}

/**
 * The transcript with Desk's THREE page labels (`leanHistory`, v99): the bot's own sentences are
 * never a source of truth, a person's are, and a page line with no author is "not sure" — which
 * must not be read as a person. Timestamps, the "CU" tag on old photos and the session marker are
 * Desk's too. Shared with the draft writer.
 */
export function renderLabelledHistory(history: readonly HistoryLine[], nowIso?: string): string {
  const lines = history.slice(-CONTEXT_HISTORY_LINES);
  const now = Date.parse(nowIso ?? "") || Date.parse(lines.at(-1)?.at ?? "") || Date.now();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : `[${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}] `;
  };
  const out: string[] = [];
  let previousAt = NaN;
  for (const line of lines) {
    const who = line.who === "khach" ? "KHACH" : line.who === "bot" ? "PAGE (bot)" : line.who === "khong_ro" ? "PAGE (khong ro bot hay nguoi)" : "PAGE (nguoi truc)";
    const at = Date.parse(line.at ?? "");
    if (Number.isFinite(at) && Number.isFinite(previousAt) && at - previousAt >= SESSION_GAP_MS) {
      out.push(`  --- PHIEN MOI (cach ${Math.round((at - previousAt) / 3600000)} gio) ---`);
    }
    if (Number.isFinite(at)) previousAt = at;
    const old = Number.isFinite(at) && now - at > OLD_IMAGE_MS ? " CU" : "";
    const images = line.images > 0 ? ` [khach gui ${line.images} anh${old}]` : "";
    const urls = (line.imageUrls ?? []).map((u) => ` [ANH url=${u}]`).join("");
    const note = line.note ? ` [GHI CHU HE THONG: ${line.note}]` : "";
    out.push(`${line.at ? stamp(line.at) : ""}${who}: ${line.text}${images}${urls}${note}`);
  }
  return out.join("\n");
}

/**
 * "What the page already said", SPLIT by author (Desk `pageFactsText`, v99): a person's words are
 * the truth of this conversation; the bot's (and the unknown ones, which go with the bot — safer)
 * are only "already said, do not repeat". Labels come from the JSON. "" when the page said nothing.
 */
export function renderPageFacts(history: readonly HistoryLine[], labels: { loiNguoiTruc: string; loiBot: string }): string {
  const usable = history.filter((m) => m.who !== "khach" && m.text.trim() !== "" && !/^\[(page gửi ảnh|\d+ tệp)/i.test(m.text.trim())).slice(-PAGE_FACT_LINES);
  if (usable.length === 0) return "";
  const fmt = (m: HistoryLine) => `[${String(m.at ?? "").slice(5, 16).replace("T", " ")}] ${m.text.replace(/\s+/g, " ").slice(0, PAGE_FACT_CHARS)}`;
  const human = usable.filter((m) => m.who === "nguoi").map(fmt);
  const bot = usable.filter((m) => m.who !== "nguoi").map(fmt);
  const blocks: string[] = [];
  if (human.length > 0) blocks.push(`${labels.loiNguoiTruc}\n${human.join("\n")}`);
  if (bot.length > 0) blocks.push(`${labels.loiBot}\n${bot.join("\n")}`);
  return blocks.join("\n\n");
}

/** The placeholder values of one call: site, shop name, profile (empty when the shop has none). */
export function promptFillValues(input: { site: string; shopName?: string | undefined; hoSo?: ShopProfile | null | undefined }): FillValues {
  return { site: input.site, tenShop: input.shopName ?? input.site, hoSo: input.hoSo ?? emptyShopProfile() };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const bool = (v: unknown): boolean => v === true || v === "true";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s) => s !== "") : []);
const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Checks the model's answer against the shape the router relies on. `null` when it is not an
 * object with an intent; anything else is normalised field by field, so a missing key never
 * throws three layers deeper.
 */
export function readContextAnalysis(parsed: Record<string, unknown> | null, allowedIntents: readonly string[], allowedCommands: readonly string[]): ContextAnalysis | null {
  if (parsed === null || typeof parsed["intent"] !== "string") return null;
  const intent = allowedIntents.length === 0 || allowedIntents.includes(parsed["intent"]) ? parsed["intent"] : "unknown";
  const confidenceRaw = Number(parsed["confidence"]);
  const entities: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record(parsed["entities"]))) {
    if (typeof value === "string") { if (value.trim() !== "") entities[key] = value.trim(); }
    else if (typeof value === "number" && Number.isFinite(value) && value !== 0) entities[key] = value;
    else if (typeof value === "boolean" && value) entities[key] = value;
  }
  const profile = record(parsed["needProfile"]);
  const focus = record(parsed["focus"]);
  const roles = (Array.isArray(focus["roles"]) ? focus["roles"] : [])
    .map((r) => ({ product: str(record(r)["product"]), role: str(record(r)["role"]) }))
    .filter((r) => r.product !== "");
  const lookups = (Array.isArray(parsed["lookupCommands"]) ? parsed["lookupCommands"] : [])
    .map((c) => ({ command: str(record(c)["command"]), args: record(record(c)["args"]) }))
    .filter((c) => c.command !== "" && (allowedCommands.length === 0 || allowedCommands.includes(c.command)))
    .slice(0, MAX_LOOKUPS);
  return {
    intent,
    confidence: Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0,
    entities,
    needProfile: { buyerType: str(profile["buyerType"]), experience: str(profile["experience"]), insistOnProduct: bool(profile["insistOnProduct"]) },
    needBrief: record(parsed["needBrief"]),
    focus: {
      product: str(focus["product"]),
      products: strings(focus["products"]),
      changed: bool(focus["changed"]),
      reason: str(focus["reason"]),
      roles
    },
    contextSummary: str(parsed["contextSummary"]),
    episodeSummary: str(parsed["episodeSummary"]),
    customerGoal: str(parsed["customerGoal"]),
    referencesPreviousMessage: bool(parsed["referencesPreviousMessage"]),
    missingInformation: strings(parsed["missingInformation"]),
    lookupCommands: lookups,
    riskFlags: strings(parsed["riskFlags"])
  };
}

export class ContextAnalyzer {
  constructor(private readonly options: ContextAnalyzerOptions) {}

  ready(): boolean {
    return this.options.model.ready();
  }

  /**
   * The exact messages the model is shown. Exported so a dossier can store the resolved prompt and
   * a test can read it: tier 1 ⊕ tier 2 blocks, the output schema with both tiers' keys, the
   * allowed lookups, then the turn's data under the JSON's labels, in Desk's order.
   */
  static composePrompt(input: ContextAnalysisInput): ChatMessage[] {
    const text = input.text;
    const values = promptFillValues(input);
    // A label's own slots ({spNgoai}) are put in BEFORE the profile fill, or the fill reads them as profile fields.
    const nhan = (key: string, vars: Record<string, string> = {}): string => fillAgentText(
      Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text.nhan[key] ?? ""), values
    );
    const schema = {
      intent: "", confidence: 0,
      entities: text.schema.entities,
      needProfile: { buyerType: "", experience: "", insistOnProduct: false },
      needBrief: text.schema.needBrief,
      contextSummary: "", episodeSummary: "",
      focus: { product: "", products: [""], changed: false, reason: "", roles: [{ product: "", role: "shop_goi_y|khach_so_sanh|dang_di|da_bo" }] },
      customerGoal: "", referencesPreviousMessage: false, missingInformation: [], riskFlags: [], lookupCommands: []
    };
    const lookups = Object.entries(text.lenhTraCuu).map(([name, about]) => `- ${name}: ${fillAgentText(about, values)}`);
    const parts: string[] = [
      renderBlocks(text.khoi, values),
      `${nhan("schema")} ${JSON.stringify(schema)}`,
      lookups.length > 0 ? `${nhan("lenh")}\n${lookups.join("\n")}` : "",
      `${nhan("tinMoi")} ${JSON.stringify(input.turn.burstText)}`,
      input.turn.replyNote ? `GHI CHU HE THONG: ${input.turn.replyNote}` : "",
      input.frameText ? `${nhan("khung")} ${input.frameText}` : "",
      `${nhan("lichSu")}\n${renderLabelledHistory(input.turn.history, input.nowIso)}`,
      `${nhan("mauTapTrung")} ${JSON.stringify(input.turn.focusedProduct ?? null)}`,
      input.externalProduct !== undefined && input.externalProduct !== null ? nhan("spNgoai", { spNgoai: JSON.stringify(input.externalProduct) }) : "",
      renderPageFacts(input.turn.history, { loiNguoiTruc: nhan("loiNguoiTruc"), loiBot: nhan("loiBot") }),
      `${nhan("hoSo")} ${input.memoryText?.trim() ? input.memoryText.trim() : nhan("hoSoTrong")}`,
      input.customerPortrait?.trim() ? `${nhan("chanDung")} ${input.customerPortrait.trim()}` : "",
      input.lineDna?.trim() ? `${nhan("dna")}\n${input.lineDna.trim()}` : ""
    ];
    return [
      { role: "system", content: fillAgentText(text.heThong, values) || "Phan tich hoi thoai ban hang. Chi tra JSON." },
      { role: "user", content: parts.filter((p) => p.trim() !== "").join("\n") }
    ];
  }

  /**
   * One model call, temperature 0, JSON mode, within `budgetMs` (at most Desk's 12 s). `null` when
   * the model is off, fails, or answers something that is not a context analysis — the router then
   * runs on the rule engine's own reading, as Desk did.
   */
  /** The ceiling this analyzer was built with. */
  timeoutMs(): number {
    return Math.max(1000, this.options.timeoutMs ?? CONTEXT_ANALYSIS_TIMEOUT_MS);
  }

  async analyze(input: ContextAnalysisInput, budgetMs: number = this.timeoutMs()): Promise<ContextAnalysis | null> {
    if (!this.options.model.ready()) return null;
    const timeoutMs = Math.max(1000, Math.min(this.timeoutMs(), Math.floor(budgetMs)));
    const messages = ContextAnalyzer.composePrompt(input);
    const answer = await withUsage(
      { shop: input.usage.shop, agent: "context_analysis", channel: input.usage.channel, conversationId: input.usage.conversationId },
      () => this.options.model.complete(messages, { temperature: 0, json: true, timeoutMs })
    );
    if (!answer.ok) {
      this.options.logger.warn(`[phan-tich-ngu-canh] mo hinh loi: ${answer.viSao}`);
      return null;
    }
    const analysis = readContextAnalysis(parseAgentJson(answer.text), input.text.yDinh, Object.keys(input.text.lenhTraCuu));
    if (analysis === null) this.options.logger.warn(`[phan-tich-ngu-canh] JSON khong doc duoc: ${redactPII(answer.text).slice(0, 200)}`);
    return analysis;
  }
}
