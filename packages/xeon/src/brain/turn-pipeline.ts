/**
 * @file THE TURN PIPELINE — one road from a customer message to what the bot says (25/09/2026).
 *
 * Sales Desk answered a message in this order (`server.js` runAIRouterForBodyInner →
 * `ai_router.js` routeCustomerMessageAsync → maybeRunLevel2Agent → send), and this class is that
 * order with Xeon's parts in each seat:
 *
 *   1. the ground (`TurnContextBuilder`): thread, memory, frame, photos of this turn;
 *   2. the photos are READ before anything writes (`readPhotos`);
 *   3. LLM#1 (`ContextAnalyzer`) reads the whole conversation — every turn, 12 s, `null` when off;
 *   4. the RULE ROUTER decides who answers: a script is sent at once, an ask-back is sent and
 *      counted, a complaint or a payment claim calls a person, everything else is the agent's;
 *   5. the notes the models are given (memory, frame, focus, photo, analysis);
 *   6. the tier-2 agent (`SalesAgent`), when the landing opens its tools and the quota allows;
 *   7. LLM#3 (`DraftWriter`) when the agent is broken, out of quota or off — Desk kept tier 1's
 *      decision when level 2 failed, and this is that;
 *   8. the deterministic `TurnEngine`, last net, with the router's intent as a hint;
 *   9. `remember`: ledger, episode, photo labels, written AFTER the reply went out.
 *
 * The same road serves the live door (`BrainService.answerTurn`, mode "gui") and the AI desk's
 * draft / sandbox (mode "khong-gui": nothing is sent, nobody is notified, no memory is written,
 * tools that write are refused) — so what a person sees as "the bot would say" IS what the bot
 * would say.
 *
 * Every model call is inside `withUsage`, so the token ledger knows shop, agent and conversation.
 */

import { TOOLS, readShopProfile, type ConversationId, type InboxOrderFormAttachment, type LinkedOrderBrief, type OrderBrief, type ShopProfile, type TenantId, type ToolName, type ToolOutput } from "@sp/contract";
import {
  CatalogResolver, CatalogScorer, FactNoteComposer, FocusResolver, PaymentClaimKit, ReplyGate, TurnEngine, UncertainProductGate, appendShopTurn, appendTurn, applyShopProfile,
  itemKey, orderedItemKeys, renderOrderNote, runningOrders,
  askedBackWithin, asksOtherVariants, buildStockFacts, catalogQueryOf, detectIntent, findLine, hasRecentImageEvidence, inStockRows, loadContextAnalysisText, loadDialogueConfig, loadDraftText,
  loadCatalogVerifyText, loadEntityConfig, loadHumanExamples, loadImageCompareText, loadImageReadText, loadIntentRules, loadLedgerTexts, loadMatchingConfig, loadNoteTexts, loadProductLines,
  loadRawProductLines, loadReplyGateConfig, loadScriptTexts, normalize, planStockCascade, redactPII, ruleRouterFor, turnFactsFromStock,
  type CascadeLine, type CatalogQuery, type CatalogResolution, type ConversationState, type Entities, type EpisodeTurn, type FocusResolution, type FoundItem,
  type GateSources, type HandleResult, type MemoryPort, type ProductRef, type RouterOutput, type RouterTurn, type RuleRouter, type StockFacts, type ToolPort,
  type TurnEvidence, type TurnFacts, type UncertainVerdict,
  MeasureReader, SizeAdvisor, loadSizeAdvice, variantSaidByCustomer, type BrandChartRow, type SizeHint,
  repairFormPromise
} from "@sp/brain";
// 05/10/2026 (phiếu Desk ảnh / phiên): the one session; the variants of the note.
import { sessionStartIndex, variantsForNote } from "@sp/brain";
// 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): the consultation profile of the turn.
import { ConsultProfiler, loadConsultProfile, type ConsultVerdict } from "@sp/brain";
// 05/10/2026 (phiếu Desk "giá theo size lấy thấp nhất giữa kho"): an item's price is the lowest in-stock size price, never its first row's.
import { bargainSaid, gateNormalize, priceOf } from "@sp/brain";
import { ReplyDispatcher, closingOnly, type DispatchPlan } from "./dispatcher";
import { humanYield, writtenByPerson } from "./human-yield";
import type { ImageIntake, PhotoReading } from "./image-intake";
import type { CatalogVerifier } from "./catalog-verifier";
import type { GatewayBreaker } from "../agent/gateway-breaker";
import { LineKnowledge, distanceBand, paceBand, parsePaceMinutes, type LineDna } from "../knowledge/line-dna";
import { LOOK_TOOL, SalesAgent, composeSystemPrompt, moneyAmounts, reviewReply, systemCapabilities, type AgentOutcome, type AgentToolBox, type AgentTurnInput, type AgentVision } from "../agent/sales-agent";
import { renderKnowledge, type TrainingKnowledge } from "../ai/knowledge";
import { withUsage } from "../ai/usage-context";
import { DRAFT_TIMEOUT_MS, DraftWriter, type DraftFacts } from "./draft-writer";
import { ContextAnalyzer, type ContextAnalysis } from "./context-analyzer";
import { TurnContextBuilder, type TurnContext } from "./turn-context";
import type { MerchantBinding, ShopProfileBundle } from "./brain-service";
import type { InboundResult } from "../protocol";
import {
  recordingToolBox, type AgentDossier, type DispatchDossier, type DraftDossier, type GateDossier, type LookupRecord, type PhotoDossier, type RecordedToolCall,
  type RouterDossier, type RuleEngineDossier, type TruthDossier, type TurnPath
} from "../chan-doan/turn-dossier";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import type { ChatModelPort } from "../agent/chat-model";

type RecentOutput = ToolOutput<"conversation.recent">;

/** The landing's channel for PUBLIC COMMENTS on a Fanpage post (wire value set by the landing's inbox). */
export const COMMENT_CHANNEL = "facebook-binh-luan";
/** Tools the agent cannot work without; a landing that does not open them keeps the rule engine. */
export const AGENT_TOOLS: ToolName[] = ["catalog.find", "conversation.recent"];
/** A human who wrote in the conversation this recently owns it: the bot does not talk over them (Desk: 5 minutes). */
export const HUMAN_YIELD_MS = 5 * 60 * 1000;
/** Pause before running a whole agent turn again when the model could not be reached at all. */
export const AGENT_TURN_RETRY_MS = 5000;
/** The whole turn's budget for the model calls (25/09/2026: 60 s): LLM#1 ≤ 12 s, the agent what is left minus 5 s, LLM#3 the rest. */
export const TURN_BUDGET_MS = 60_000;
/** The agent's whole-turn retry is skipped once this much of the budget is spent. */
const AGENT_RETRY_CUTOFF_MS = 30_000;
/** The agent never gets less than this, so a slow LLM#1 does not make it a certain timeout. */
const AGENT_MIN_DEADLINE_MS = 10_000;
/** One breaker notice per shop per open period. */
const BREAKER_NOTICE_MS = 10 * 60_000;
/** LLM#1 running over is not the agent's fault: at most this much of it counts against the rest of the turn. */
const ANALYSIS_BUDGET_CAP_MS = 15_000;
/** LLM#3 never gets less than this, so a slow agent does not turn the draft into a certain timeout. */
const DRAFT_MIN_BUDGET_MS = 5000;
const HISTORY_LIMIT = 25;
/** A Vietnamese mobile number the customer typed (the engine reads it the same way). */
const PHONE_RE = /(?:^|\D)(0\d{9})(?:\D|$)/;
/** How much of a lookup result the dossier keeps per item. */
const LOOKUP_ITEMS_KEPT = 12;

export const SUPERSEDED: InboundResult = { daTraLoi: false, viSao: "gop_vao_tin_sau" };

/** Desk v93e: asked back within this long = do not ask a second time, call a person. Unset in the pack = this. */
const ASK_BACK_WINDOW_DEFAULT_MINUTES = 30;

/** The industry's ask-back window (`gates[ask_back_once].windowMinutes`), the platform default when unset. */
export function askBackWindowMinutes(pack: { gates?: readonly { kind: string; windowMinutes?: number | undefined }[] | undefined }): number {
  const rule = (pack.gates ?? []).find((g) => g.kind === "ask_back_once");
  const minutes = Number(rule?.windowMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : ASK_BACK_WINDOW_DEFAULT_MINUTES;
}

/**
 * 05/10/2026: the newest customer message a turn has in view — the last customer line of the thread it read,
 * or the message it was pushed for when the thread does not have that one yet. "" = no message id known.
 */
export function newestCustomerMessage(lines: readonly { chieu: string; maTin?: string | undefined }[], pushed: string | undefined): string {
  const own = String(pushed ?? "").trim();
  if (own !== "" && !lines.some((m) => m.maTin === own)) return own;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const id = String(lines[i]!.maTin ?? "").trim();
    if (lines[i]!.chieu === "den" && id !== "") return id;
  }
  return own;
}

/** 05/10/2026: the landing dropped the reply because a person took the conversation over meanwhile. */
export class HumanTookOver extends Error {
  constructor(readonly conversationId: string) {
    super(`nguoi truc da tiep quan ${conversationId} trong luc bot soan`);
    this.name = "HumanTookOver";
  }
}

/**
 * 05/10/2026 (phiếu Desk "tin khách đến trong lúc AI chạy", "chống gửi trùng"): the landing's send door refused
 * the reply — `tin-moi`: the customer wrote after the newest message this turn saw (that message has its own
 * turn); `da-tra-loi`: another turn already answered it and this reply is no correction. Nothing was sent.
 */
export class ReplyRefused extends Error {
  constructor(readonly conversationId: string, readonly why: "tin-moi" | "da-tra-loi") {
    super(`landing bo cau tra loi ${conversationId}: ${why}`);
    this.name = "ReplyRefused";
  }
}

/**
 * 05/10/2026 (phiếu Desk "kết quả phân tích mù ảnh … gửi lỗi thì lần sau phải gửi lại"): the landing could not send
 * the reply (Meta refused, the landing failed). The landing gave the send door back; the brain may run the turn
 * again once (`BrainService`). Nothing reached the customer, nothing was remembered.
 */
export class ReplyNotSent extends Error {
  constructor(readonly conversationId: string, readonly why: string) {
    super(`landing khong gui duoc cau tra loi ${conversationId}: ${why}`);
    this.name = "ReplyNotSent";
  }
}

/** Only tools that READ. A draft or a demo must never leave a trace on the shop's data. */
export function readOnlyTools(inner: ToolPort): ToolPort {
  return {
    available: () => inner.available().filter((t) => TOOLS[t]?.effect === "read"),
    online: () => inner.online(),
    call: async (tool, input, ctx) => {
      if (TOOLS[tool]?.effect !== "read") return { ok: false, tool, error: { code: "tool_unknown", message: `Nháp/hộp cát không được gọi "${tool}" (công cụ có ghi).` } };
      return inner.call(tool, input, ctx);
    }
  };
}

/** A memory that reads the real one and writes nowhere: a draft must not move the conversation's state. */
export function readOnlyMemory(inner: MemoryPort): MemoryPort {
  return { load: (tenant, id) => inner.load(tenant, id), save: async () => undefined };
}

/**
 * The dossier being filled while a turn runs. The pipeline fills each part as it happens, and the
 * service writes it ONCE at the end — one message, one dossier, even when the agent tried first
 * and LLM#3 or the engine finished.
 */
export interface DossierDraft {
  duongDi: TurnPath;
  phanTich?: ContextAnalysis | null | undefined;
  router?: RouterDossier | undefined;
  traCuu?: LookupRecord[] | undefined;
  suThat?: TruthDossier | undefined;
  agent?: AgentDossier | undefined;
  nhap?: DraftDossier | undefined;
  mayLuat?: RuleEngineDossier | undefined;
  ghiChu?: string | undefined;
  cong?: GateDossier | undefined;
  guiKem?: DispatchDossier | undefined;
  anh?: PhotoDossier | undefined;
  cauDaoMo?: boolean | undefined;
  phanTichMs?: number | undefined;
}

/**
 * What stage 3 (the brain's catalog scorer, resolver, gate, focus, stock facts) and stage 4 (the
 * landing's stock ladder, orders, customer) proved for one turn — Desk steps 5–7. The note, the
 * draft's facts, the memory and the dossier all read from here.
 */
interface Truth {
  /** The exchange is about an ORDER and no phone number is known yet: the sentence to ask with (Desk `ensureOrderLookupForExchange`). */
  askOrderPhone: string | null;
  query: CatalogQuery;
  found: FoundItem[];
  /** The rung of the landing's ladder that answered, or the finder rungs Xeon walked; "" when no lookup ran. */
  level: string;
  resolution: CatalogResolution | null;
  uncertain: UncertainVerdict | null;
  focus: FocusResolution;
  stock: StockFacts | null;
  orders: OrderBrief[];
  portrait: ToolOutput<"customer.recognize"> | null;
  /** The blocks of the system note (`FactNoteComposer`). */
  facts: TurnFacts;
  /** Further plain lines for the models: the stock facts, "confirm first", the customer portrait, the order. */
  lines: string[];
  lookups: LookupRecord[];
  /** 05/10/2026: the catalog group(s) the customer's words named, as the landing read them; `question` = nothing but group words. */
  group?: CatalogGroupAsk | null;
  /** 05/10/2026: the ready category sentence (type link), sent only when no model answers — the agent answers first. */
  net?: string;
  /**
   * 05/10/2026 (phiếu Desk nhóm số đo): the customer's measurements read by tier 1, the brand in focus
   * and its own chart from the landing (`null` = none / not asked), and what the table says.
   */
  size?: { brand: string; chart: BrandChart | null; hint: SizeHint | null };
  /**
   * 05/10/2026 (phiếu Desk 22/09): the size a TAG reading came to — by the item's own brand chart (the landing's
   * conversion, or `variant.brandChart`), or `general` = the industry table because that brand has no chart.
   */
  tagSize?: { tem: string; size: string; brand: string; general: boolean };
  /** 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): the consultation profile — item named, everyday, known / missing / asked. */
  consult?: ConsultVerdict | null;
}

/** A brand's chart as the landing's `variant.brandChart` returned it. */
interface BrandChart {
  rows: BrandChartRow[];
  womenDiffer: boolean;
}

/** What the landing read as groups of ITS catalog in the customer's message (`catalog.find` with `chi_nhom`). */
interface CatalogGroupAsk {
  loai: string;
  mon: string;
  link: string;
  /** In-stock items of the group (at most the finder's eight). */
  items: FoundItem[];
  /** Every product word is a group name: a category question, not one item. */
  question: boolean;
  /** The words that are neither group names nor chatter: a narrower item than the group. */
  leftover: string[];
}

/** One step of "AI nghĩ gì", in the order it happened; the AI desk numbers them. */
export interface TurnStep {
  loai: "doc" | "cong-cu" | "loi" | "chan" | "quyet-dinh";
  ten: string;
  chiTiet: string;
}

/** The message being answered, as the landing sent it (a subset of `InboundMessageBody`). */
export interface TurnMessage {
  kenh?: string | undefined;
  nguoi: string;
  chu: string;
  maTin?: string | undefined;
  luc?: string | undefined;
  soAnh?: number | undefined;
  anh?: string[] | undefined;
  traLoiTin?: string | undefined;
  /** 05/10/2026: the landing handed this message back (`het-nhuong`) or a person asked the bot to answer (`nguoi-bam`). */
  tiepQuan?: "het-nhuong" | "nguoi-bam" | undefined;
}

/** "gui": the live door — sends, notifies, remembers. "khong-gui": draft / sandbox — none of that, tools read-only. */
export type TurnMode = "gui" | "khong-gui";

export interface TurnRequest {
  tenant: string;
  binding: MerchantBinding;
  conversationId: string;
  message: TurnMessage;
  mode: TurnMode;
  /** Re-checked before anything is sent: a newer message in the burst makes this turn's reply stale. */
  isLatest?: (() => boolean) | undefined;
  /** Filled while the turn runs; the caller writes it. */
  draft?: DossierDraft | undefined;
  /** The thread, when the caller has it (the sandbox's made-up one); otherwise `conversation.recent` is read. */
  recent?: RecentOutput | undefined;
  /** The memory to use instead of the merchant's (the sandbox's throwaway one). */
  memory?: MemoryPort | undefined;
  /** Who the model calls are billed to in the token ledger. */
  usageAgent?: "bot_l2" | "ai_draft" | "sandbox" | "web_advisor" | undefined;
}

/** Where the reply came from. */
export type TurnSource = "kich-ban" | "agent" | "nhap" | "may-luat" | "";

export interface TurnOutcome {
  /** What the inbound door returns to the landing. */
  result: InboundResult;
  /** The sentence the customer hears (or would hear, in "khong-gui" mode); "" when none. */
  reply: string;
  source: TurnSource;
  /** Desk's action names: `script_reply` | `ask_clarification` | `human_handoff` | `ai_fallback_draft` | "". */
  action: string;
  /** A person must take over (a notice was sent in "gui" mode). */
  needsHuman: boolean;
  /** One line for the screen: why this reply. */
  reason: string;
  steps: TurnStep[];
  analysis: ContextAnalysis | null;
  router: RouterOutput | null;
  /** The rule engine's result, when it ran. */
  engine: HandleResult | null;
}

export interface TurnPipelineDeps {
  /** The AI sales agent. `null` or not ready = never runs. */
  agent: SalesAgent | null;
  /** LLM#1. `null` or not ready = the router runs on the rule engine's own reading. */
  analyzer: ContextAnalyzer | null;
  /** LLM#3. `null` or not ready = the engine answers when the agent cannot. */
  writer: DraftWriter | null;
  /** The model that READS a photo the customer sent. `null` = the bot answers without seeing it. */
  vision: ChatModelPort | null;
  /** Reads the customer's photos (GĐ5): download, kind, catalogue match. */
  intake: ImageIntake;
  /** LLM#2. `null` or not ready = a weak catalog guess is flagged for the agent, not confirmed. */
  verifier: CatalogVerifier | null;
  /** The gateway breaker. `null` = every turn tries the models. */
  breaker: GatewayBreaker | null;
  clock: Clock;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  /** Counts one agent turn against the merchant's hourly quota; false when it is spent. */
  takeAgentTurn: (tenant: string, nowMs: number) => boolean;
  /** The merchant's memory (licensed: on its landing; legacy: RAM). */
  memoryFor: (binding: MerchantBinding) => MemoryPort;
  /** Asks the landing for its tool list again (the fallback list lacks the agent's tools). */
  refreshTools: (tenant: string, binding: MerchantBinding) => Promise<void>;
  /**
   * The agent SEES the customer's photos (02/10/2026, measured 72% → 87% right, none wrong), on top of
   * the system's reading. One switch for the whole platform (`XEON_AGENT_XEM_ANH`), there to back
   * out of a fault — not a per-shop choice. Absent = off (the note alone, as before).
   */
  agentSeesPhotos?: boolean | undefined;
}

/** Everything one run needs at hand, so the steps can be small methods. */
interface Turn {
  req: TurnRequest;
  live: boolean;
  isLatest: () => boolean;
  draft: DossierDraft;
  steps: TurnStep[];
  startedMs: number;
  text: string;
  channel: string;
  tools: ToolPort;
  memory: MemoryPort;
  shop: ShopProfileBundle | null;
  hoSo: ShopProfile | null;
  contexts: TurnContextBuilder;
  ctx: TurnContext;
  photos: PhotoReading | null;
  analysis: ContextAnalysis | null;
  router: RouterOutput | null;
  engine: HandleResult | null;
  /** What the lookups proved; `null` until the router said the agent drafts. */
  truth: Truth | null;
  /** Đ7: the shop paused partner goods — every finder call this turn asks for own stock only. */
  ownStockOnly: boolean;
  /** The gateway breaker is open: no model runs this turn (scripts, lookups and the engine still do). */
  modelsOff: boolean;
  /** The landing will prepend its greeting to this reply (Giai đoạn 7). */
  chaoAi: boolean;
  /** The policy text, read once per turn when a gate or the draft needs it. */
  policy: string | null;
  /** How long LLM#1 took; only up to `ANALYSIS_BUDGET_CAP_MS` of it is charged to the models after it. */
  analysisMs: number;
  /** A model path was tried (agent eligible, or LLM#3 ran): the engine must not fall back to a bare greeting. */
  modelTried: boolean;
  /**
   * 05/10/2026: the orders CERTAINLY linked to this conversation, with the stage the landing computed
   * (`conversation.recent` → `hoiThoai.donCuaHoiThoai`); [] on an older landing.
   */
  orders: LinkedOrderBrief[];
  /**
   * 05/10/2026: the newest customer message (`maTin`) in the thread this turn read — sent with the reply as
   * `theoTin`, so the landing can tell a reply written before the customer's latest message. "" = unknown.
   */
  seenUpTo: string;
}

/** One industry's stage-3 machinery, built once per pack. */
interface Stage3Kit {
  scorer: CatalogScorer;
  resolver: CatalogResolver;
  gate: UncertainProductGate;
  lines: CascadeLine[];
  /** The pack's brands, accent-stripped. */
  brands: string[];
}

export class TurnPipeline {
  private readonly turnContexts = new Map<string, TurnContextBuilder>();
  private readonly routers = new Map<string, RuleRouter>();
  private readonly kits = new Map<string, Stage3Kit>();
  private readonly focusResolver = new FocusResolver();
  private readonly dispatcher = new ReplyDispatcher();
  /** When each shop was last told the breaker is open. */
  private readonly breakerNotices = new Map<string, number>();

  constructor(private readonly deps: TurnPipelineDeps) {}

  // ---------------------------------------------------------------- the road

  async run(req: TurnRequest): Promise<TurnOutcome> {
    const { tenant, binding, conversationId, message } = req;
    const live = req.mode === "gui";
    const draft = req.draft ?? { duongDi: "may-luat" };
    const steps: TurnStep[] = [];
    const text = String(message.chu || "");
    const channel = message.kenh ?? "facebook";
    const startedMs = this.deps.clock.now().getTime();

    // TIER 3 first: the shop's profile shapes every path — the agent's prompt, the router's
    // pronouns, the engine's "we do not have it" sentence. One read per turn, never kept.
    const shop = await this.shopProfileFor(binding);
    const hoSo = shop?.hoSo ?? null;
    const tools = live ? binding.gateway.tools : readOnlyTools(binding.gateway.tools);
    const memory = live ? (req.memory ?? this.deps.memoryFor(binding)) : readOnlyMemory(req.memory ?? this.deps.memoryFor(binding));

    // 1. The thread. A landing that does not open `conversation.recent` (an older build) gives the
    // turn only the message itself; every step below still runs on that.
    const recent = req.recent ?? await this.readRecent(tenant, binding, tools, conversationId);
    const nowMs = this.deps.clock.now().getTime();
    // A human on duty wrote or typed within the shop's yield window (`human-yield.ts`): they own the
    // conversation, the bot keeps quiet — and says until when, so the turn is handed back then. Not in
    // a draft — a person pressing "Soạn bot" IS the human on duty.
    const yielding = live ? humanYield({ recent, profile: hoSo, nowMs, takeover: message.tiepQuan }) : { yields: false };
    if (yielding.yields && yielding.untilMs !== undefined) {
      this.deps.logger.info(`[agent] ${conversationId}: nguoi truc ${yielding.why === "dang-go" ? "dang go" : "vua tra loi"} — bot im toi ${new Date(yielding.untilMs).toISOString()}`);
      return this.outcome({ daTraLoi: false, viSao: "nguoi_dang_truc", nhuongDen: new Date(yielding.untilMs).toISOString() }, { reply: "", source: "", action: "", needsHuman: false, reason: "Người trực đang xử lý hội thoại — bot im.", steps, analysis: null, router: null, engine: null });
    }
    const loaded = await memory.load(tenant as TenantId, conversationId as ConversationId).catch(() => null);
    const contexts = this.turnContextFor(binding);
    const ctx = contexts.build({ tenant, conversationId, message, recent, state: loaded, now: this.deps.clock.now() });
    steps.push({ loai: "doc", ten: "Đọc hội thoại", chiTiet: `${ctx.history.length} tin gần nhất; tin khách cần trả lời: "${redactPII(text).slice(0, 200)}"${ctx.photos.length > 0 ? ` (+${ctx.photos.length} ảnh)` : ""}${ctx.frame !== null ? `; khung: ${ctx.frame.kind}/${ctx.frame.answer}` : ""}` });

    const turn: Turn = {
      req, live, isLatest: req.isLatest ?? (() => true), draft, steps, startedMs, text, channel, tools, memory, shop, hoSo,
      contexts, ctx, photos: null, analysis: null, router: null, engine: null, truth: null, ownStockOnly: false, modelTried: false, modelsOff: false, chaoAi: false, policy: null, analysisMs: 0,
      orders: [...(recent.hoiThoai?.donCuaHoiThoai ?? [])],
      seenUpTo: newestCustomerMessage(recent.tin, message.maTin)
    };
    if (turn.orders.length > 0) {
      const running = runningOrders(turn.orders);
      steps.push({ loai: "doc", ten: "Đơn của hội thoại", chiTiet: turn.orders.map((o) => `${o.maDon} (${o.giaiDoan}${o.vanDonDong ? ", vận đơn đã đóng" : ""})`).join("; ") + (running.length > 0 ? " — chế độ chăm sóc đơn" : "") });
    }

    // A public comment is answered by the engine alone, under the comment, as before the pipeline:
    // neither the scripts nor the models were written for a thread the whole Fanpage can read.
    if (channel === COMMENT_CHANNEL) return this.engineTurn(turn);

    // The gateway breaker: open = no model this turn (photos, LLM#1, agent, LLM#3, LLM#2); the shop is told once.
    turn.modelsOff = await this.breakerOpen(turn);
    draft.cauDaoMo = turn.modelsOff ? true : undefined;
    // The landing prepends its greeting to the opening reply (Giai đoạn 7); every model is told so it does not greet again.
    // Desk `introAlreadySent`: the page never wrote in this thread (bot or person, text or picture) AND the landing has not greeted.
    // 05/10/2026 (phiếu Desk "chào AI khi khách chỉ khép chuyện"): only the bot's OWN earlier lines no longer
    // count — a customer it acknowledged without the greeting is greeted on the first message with content; a
    // message that only closes the exchange ("ok", "cảm ơn em") never carries the greeting.
    turn.chaoAi = !ctx.daChaoAi && !recent.tin.some((m) => writtenByPerson(m) || (m.chieu === "di" && m.boi === "")) && !closingOnly(text, loadIntentRules(binding.packId).reconcile);

    // 2. The photos, BEFORE anything writes: a picture the model never looked at is exactly how
    // "cho em xin ảnh" got sent to a customer who had just sent one. The page just asked for the shoe
    // the customer wears (frame `asked_size`): the photo is a size REFERENCE, not something to sell.
    turn.photos = turn.modelsOff ? null : await this.deps.intake.read({
      tenant, binding, photos: ctx.photos, kenh: channel, conversationId, text: loadImageReadText(binding.packId), compareText: loadImageCompareText(binding.packId),
      // 05/10/2026: or the page asked to SEE what the customer uses now (`askedReference`, the industry's words).
      reference: ctx.frame?.kind === "asked_size" || ctx.frame?.asksReference === true, receiptTextPatterns: loadLedgerTexts().receiptTextPatterns,
      agentSees: this.agentSees(binding),
      // 05/10/2026: freshness from the customer's message, not the clock — a draft made later still sees the photo.
      asOf: ctx.anchorAt
    });
    // 05/10/2026 (phiếu Desk "ảnh ngoài lượt"): a photo older than the fresh window is history — said in the dossier.
    if (ctx.stalePhotos > 0) {
      steps.push({ loai: "doc", ten: "Ảnh cũ", chiTiet: `${ctx.stalePhotos} ảnh khách gửi quá 15 phút trước — không coi là ảnh khách vừa gửi.` });
      draft.anh = { loai: "", soAnh: 0, thamChieu: false, loi: [], boCu: ctx.stalePhotos };
    }
    if (turn.photos !== null) {
      draft.anh = { loai: turn.photos.loai, soAnh: turn.photos.looks.length, thamChieu: turn.photos.thamChieu, loi: turn.photos.loi, ...(ctx.stalePhotos > 0 ? { boCu: ctx.stalePhotos } : {}) };
      if (turn.photos.note) steps.push({ loai: "doc", ten: "Đọc ảnh khách gửi", chiTiet: turn.photos.note.slice(0, 400) });
      for (const e of turn.photos.loi) steps.push({ loai: "loi", ten: "Ảnh khách gửi", chiTiet: e });
      // A transfer receipt: the neutral sentence and a person, before any model writes (Desk's payment claim path).
      if (turn.photos.loai === "bien_lai") {
        draft.duongDi = "kich-ban";
        const gateCfg = loadReplyGateConfig(binding.packId);
        const pronoun = applyShopProfile(binding.pack, hoSo, binding.chung.cauCam).identity.customerPronoun;
        const neutral = new PaymentClaimKit(gateCfg.payment).paymentPendingText({ neutral: gateCfg.payment.pendingText }, pronoun);
        steps.push({ loai: "quyet-dinh", ten: "Biên lai chuyển khoản", chiTiet: "Ảnh là biên lai — câu trung tính, gọi người đối chiếu, không model nào viết." });
        return this.deliver(turn, { reply: neutral, source: "kich-ban", action: "human_handoff", hanhDong: "send", handoff: "bien lai chuyen khoan — nguoi phu trach doi chieu", reason: "Khách gửi biên lai chuyển khoản — câu trung tính, người phụ trách đối chiếu." });
      }
    }

    // 3. LLM#1 on every turn (Desk ran it before routing), within its own budget; `null` never stops the turn.
    const analysisStarted = this.deps.clock.now().getTime();
    turn.analysis = turn.modelsOff ? null : await this.analyze(turn);
    turn.analysisMs = this.deps.clock.now().getTime() - analysisStarted;
    draft.phanTich = turn.analysis;
    draft.phanTichMs = turn.analysisMs;

    // 4. The rule router: who answers.
    const router = await this.route(turn);
    turn.router = router;
    draft.router = {
      quyetDinh: router.decision.kind, lyDo: router.decision.reason, yDinh: router.intent, yDinhCucBo: router.localIntent,
      thucThe: router.entities, duongOng: router.pipeline,
      traLoi: router.decision.kind === "agent_draft" || router.decision.kind === "silent" ? "" : router.decision.reply,
      goiY: router.decision.kind === "agent_draft" ? router.decision.hint : "",
      ...(router.decision.kind === "human_handoff" ? { tuGui: router.decision.safeToAutoSend } : {})
    };
    steps.push({ loai: "quyet-dinh", ten: "Bộ định tuyến", chiTiet: `${router.decision.kind} (${router.decision.reason}) · ý định ${router.intent.intent} · ${router.pipeline.join(" › ")}` });

    const decision = router.decision;
    if (decision.kind === "silent") {
      // 05/10/2026: "ok" again after the bot's own short acknowledgement — nothing to add, nothing sent.
      draft.duongDi = "kich-ban";
      return this.outcome({ daTraLoi: false, viSao: "khong_can_tra_loi" }, { reply: "", source: "", action: "", needsHuman: false, reason: "Khách chỉ xác nhận lại — bot đã trả lời câu ngắn, không gửi thêm.", steps, analysis: turn.analysis, router, engine: null });
    }
    if (decision.kind === "script_reply") {
      draft.duongDi = "kich-ban";
      return this.deliver(turn, { reply: decision.reply, source: "kich-ban", action: "script_reply", hanhDong: "send", reason: `Kịch bản "${decision.reason}".` });
    }
    if (decision.kind === "ask_clarification") {
      draft.duongDi = "kich-ban";
      return this.deliver(turn, { reply: decision.reply, source: "kich-ban", action: "ask_clarification", hanhDong: "ask_back", askBack: true, reason: `Hỏi lại theo kịch bản "${decision.reason}".` });
    }
    if (decision.kind === "human_handoff") {
      draft.duongDi = "kich-ban";
      // The neutral payment / receipt acknowledgement goes out as is; a complaint gets the generic
      // handoff sentence and a person — the router's own draft is for the agent to improve, which
      // is not this path (Desk `buildDecision`).
      if (decision.safeToAutoSend && decision.reply !== "") {
        // 05/10/2026: `pauseBot` — the landing switches the bot off on this conversation until a person confirms.
        return this.deliver(turn, { reply: decision.reply, source: "kich-ban", action: "human_handoff", hanhDong: "send", handoff: decision.reason, pauseBot: decision.pauseBot === true, reason: `Kịch bản "${decision.reason}" — gọi người phụ trách${decision.pauseBot === true ? ", bot dừng hội thoại này tới khi người trực xác nhận" : ""}.` });
      }
      return this.handOverToPerson(turn, `bo dinh tuyen: ${decision.reason}`, "kich-ban");
    }

    // The industry's and the shop's own "a person takes this" topics ("xin hoá đơn"...), AFTER the
    // router: complaints and money already went to a person with a sentence above.
    if (SalesAgent.mustHuman(binding.pack, text, { chung: binding.chung, hoSo })) {
      return this.handOverToPerson(turn, "bo luat nganh giao cau nay cho nguoi that", "kich-ban");
    }

    // 4b. Desk steps 5–7: the landing is asked for the stock, the orders and the customer BEFORE
    // any model writes; the brain scores the catalog, decides whether the product is clear enough,
    // settles the focus and builds the stock truth. The gate may end the turn here (ask which
    // product — once; a brand the shop does not carry; a category link).
    // The conversation's context from the shop comes first: "Tạm dừng hàng đối tác" narrows every finder call below.
    const knowledge = await this.knowledgeFor(binding, tools, conversationId, text);
    if (knowledge && (knowledge.spNgoai || knowledge.cauHinh.tatHangDoiTac)) {
      steps.push({ loai: "doc", ten: "Ngữ cảnh shop", chiTiet: [knowledge.spNgoai ? `SP ngoài đang chốt ${knowledge.spNgoai.ma}` : "", knowledge.cauHinh.tatHangDoiTac ? "đang tạm dừng hàng đối tác" : ""].filter(Boolean).join(" · ") });
    }
    turn.ownStockOnly = knowledge?.cauHinh.tatHangDoiTac === true;
    const truth = await this.groundTruth(turn);
    turn.truth = truth;
    draft.traCuu = truth.lookups;
    draft.suThat = this.truthDossier(truth);
    if (truth.askOrderPhone !== null) {
      draft.router?.duongOng.push("exchange_needs_order_phone");
      draft.duongDi = "kich-ban";
      steps.push({ loai: "quyet-dinh", ten: "Đổi size đơn đã đặt", chiTiet: "Chưa có SĐT đặt đơn — xin SĐT theo hồ sơ shop." });
      return this.deliver(turn, { reply: truth.askOrderPhone, source: "kich-ban", action: "ask_clarification", hanhDong: "ask_back", askBack: true, reason: "Đổi size cho đơn đã đặt: cần SĐT đặt đơn để tra." });
    }
    const verdict = truth.uncertain;
    if (verdict !== null && verdict.action !== "agent_draft" && verdict.action !== "drop_anchor") {
      draft.router?.duongOng.push(verdict.reason);
      draft.duongDi = "kich-ban";
      steps.push({ loai: "quyet-dinh", ten: "Cổng chưa chắc mẫu", chiTiet: `${verdict.action} (${verdict.reason})` });
      if (verdict.action === "ask_clarification") {
        return this.deliver(turn, { reply: verdict.reply, source: "kich-ban", action: "ask_clarification", hanhDong: "ask_back", askBack: true, reason: `Chưa rõ mẫu (${verdict.why}) — hỏi lại một lần.` });
      }
      if (verdict.action === "script_reply") {
        return this.deliver(turn, { reply: verdict.reply, source: "kich-ban", action: "script_reply", hanhDong: "send", reason: "Khách hỏi loại hàng khác — gửi link loại hàng." });
      }
      if (verdict.reply !== "") {
        return this.deliver(turn, { reply: verdict.reply, source: "kich-ban", action: "human_handoff", hanhDong: "send", handoff: verdict.reason, reason: "Đã hỏi lại một lần mà vẫn chưa rõ mẫu — gọi người phụ trách.", clearAskBack: verdict.reason.startsWith("uncertain_product_twice") });
      }
      return this.handOverToPerson(turn, verdict.reason, "kich-ban");
    }

    // 5. The notes every model reads: what tier 1 proved this turn.
    const notes = this.composeNotes(turn, decision.hint);
    const extraContext = [renderKnowledge(knowledge), ...notes].filter((part) => part !== "").join("\n\n");
    draft.ghiChu = extraContext;

    // 6. The agent.
    const agentRun = await this.runAgent(turn, knowledge, extraContext);
    if (agentRun === "superseded") return this.outcome(SUPERSEDED, { reply: "", source: "", action: "", needsHuman: false, reason: "Khách nhắn thêm trong lúc soạn.", steps, analysis: turn.analysis, router, engine: null });
    if (agentRun !== null && agentRun.outcome.ok) {
      const used = agentRun.outcome.trace.map((t) => t.tool ?? t.error).filter(Boolean).join(", ") || "khong goi cong cu";
      this.deps.logger.info(`[agent] ${conversationId}: tra loi sau ${agentRun.outcome.steps} buoc (${used})`);
      // Stage 6: the reply gate repairs what the review could not block; an emptied reply goes to the engine.
      const gated = await this.gateReply(turn, agentRun.outcome.reply, false, agentRun.toolCalls);
      if (gated.reply !== "") {
        draft.duongDi = "agent";
        const handsOver = gated.needsHuman || SalesAgent.handsOver(binding.pack, gated.reply, binding.chung);
        return this.deliver(turn, {
          reply: gated.reply, source: "agent", action: "ai_fallback_draft", hanhDong: "agent", toolCalls: agentRun.toolCalls,
          ...(handsOver ? { handoff: gated.needsHuman ? `cong soat: ${gated.handoffReason || "can nguoi"}` : "agent goi nguoi phu trach" } : {}),
          reason: handsOver ? "Agent trả lời, người phụ trách theo dõi." : `Agent trả lời sau ${agentRun.outcome.steps} bước.`
        });
      }
      this.deps.logger.warn(`[cong-soat] ${conversationId}: cau cua agent bi bo ca cau — may luat tra loi`);
      turn.modelTried = true;
      return this.engineTurn(turn);
    }

    // 7. LLM#3: the agent could not (broken, blocked, out of quota, off). Desk kept tier 1's own
    // decision when level 2 failed; here that is one draft from the facts already in hand.
    // LLM#3 never sees the photo: its notes say what the system read, not "look again yourself".
    const drafted = await this.runDraft(turn, agentRun?.toolCalls ?? [], turn.photos?.noteBlind != null ? this.composeNotes(turn, decision.hint, true) : notes);
    if (drafted === "superseded") return this.outcome(SUPERSEDED, { reply: "", source: "", action: "", needsHuman: false, reason: "Khách nhắn thêm trong lúc soạn.", steps, analysis: turn.analysis, router, engine: null });
    if (drafted !== null) {
      const gated = await this.gateReply(turn, drafted.reply, drafted.needsHuman, agentRun?.toolCalls ?? []);
      if (gated.reply !== "") {
        draft.duongDi = "nhap";
        const handsOver = gated.needsHuman || SalesAgent.handsOver(binding.pack, gated.reply, binding.chung);
        return this.deliver(turn, {
          reply: gated.reply, source: "nhap", action: "ai_fallback_draft", hanhDong: "agent", toolCalls: agentRun?.toolCalls ?? [],
          ...(handsOver ? { handoff: drafted.needsHuman ? `soan nhap: ${drafted.reason || "can nguoi"}` : gated.needsHuman ? `cong soat: ${gated.handoffReason || "can nguoi"}` : "soan nhap goi nguoi phu trach" } : {}),
          reason: handsOver ? "Soạn nháp (LLM#3) và gọi người phụ trách." : "Soạn nháp (LLM#3) từ dữ liệu đã tra."
        });
      }
      this.deps.logger.warn(`[cong-soat] ${conversationId}: cau nhap bi bo ca cau — may luat tra loi`);
    }

    // 8. The engine, last in line, with the router's intent as its hint. A category question whose ready
    // link sentence was held back for the agent gets that sentence instead (05/10/2026).
    if ((turn.truth?.net ?? "") !== "") {
      draft.duongDi = "kich-ban";
      return this.deliver(turn, { reply: turn.truth!.net!, source: "kich-ban", action: "script_reply", hanhDong: "send", reason: "Khách hỏi loại hàng khác — mô hình không trả lời được, gửi link loại hàng." });
    }
    return this.engineTurn(turn);
  }

  // ---------------------------------------------------------------- steps

  private async readRecent(tenant: string, binding: MerchantBinding, tools: ToolPort, conversationId: string): Promise<RecentOutput> {
    let open = tools.available();
    if (!open.includes("conversation.recent") && !binding.gateway.toolListConfirmed()) {
      // The fallback list (no landing reached yet) lacks the thread tool: ask once more before
      // answering a customer blind — the thread is what every step below stands on.
      await this.deps.refreshTools(tenant, binding);
      open = tools.available();
    }
    if (!open.includes("conversation.recent")) return { tin: [] };
    const r = await tools.call("conversation.recent", { conversationId: conversationId as ConversationId, limit: HISTORY_LIMIT });
    if (r.ok) return r.data;
    this.deps.logger.warn(`[bo-nao] ${conversationId}: khong doc duoc hoi thoai (${r.error.message}) — tra loi theo tin hien tai`);
    return { tin: [] };
  }

  private async analyze(turn: Turn): Promise<ContextAnalysis | null> {
    const analyzer = this.deps.analyzer;
    if (analyzer === null || !analyzer.ready()) return null;
    const { binding, tenant, conversationId } = turn.req;
    const nowIso = this.deps.clock.now().toISOString();
    const analysis = await analyzer.analyze({
      turn: turn.ctx,
      frameText: turn.ctx.frame !== null ? turn.contexts.describeFrame(turn.ctx.frame) : "",
      // 05/10/2026: the order block first — LLM#1 must know the customer already has an order.
      memoryText: [this.orderNote(turn), turn.contexts.renderMemory(turn.ctx.state, nowIso)].filter((p) => p !== "").join("\n\n"),
      text: loadContextAnalysisText(binding.packId),
      site: binding.origin, shopName: binding.shopName, hoSo: turn.hoSo,
      usage: { shop: tenant, channel: turn.channel, conversationId },
      nowIso
    }, Math.min(analyzer.timeoutMs(), this.budgetLeft(turn)));
    turn.steps.push(analysis !== null
      ? { loai: "doc", ten: "Phân tích ngữ cảnh (LLM#1)", chiTiet: `ý định ${analysis.intent} (${analysis.confidence}); ${analysis.contextSummary || analysis.episodeSummary || "(không tóm tắt)"}`.slice(0, 400) }
      : { loai: "loi", ten: "Phân tích ngữ cảnh (LLM#1)", chiTiet: "Mô hình không trả lời được — bộ định tuyến chạy theo luật." });
    return analysis;
  }

  /** The router on this turn; the bank script needs the account, which is fetched only when that script is asked for. */
  private async route(turn: Turn): Promise<RouterOutput> {
    const { binding } = turn.req;
    const router = this.routerFor(binding);
    const byPerson = turn.ctx.history.map((h) => h.who === "nguoi");
    const turns: RouterTurn[] = turn.ctx.turns.slice(0, -1).map((t, i) => ({ ...t, byPerson: byPerson[i] === true }));
    const input = {
      message: turn.text, turns,
      attachments: Math.max(turn.ctx.photos.length, Number(turn.req.message.soAnh || 0)),
      attachmentKinds: (turn.photos?.looks ?? []).map((l) => l.loai),
      aiIntent: turn.analysis !== null ? { intent: turn.analysis.intent, confidence: turn.analysis.confidence, matched: ["llm1"] } : null,
      aiFlags: turn.analysis?.riskFlags ?? [],
      frame: turn.ctx.frame, profile: turn.hoSo, site: binding.origin, tenShop: binding.shopName,
      orders: turn.orders
    };
    let out = router.route(input);
    if (out.decision.kind === "agent_draft" && out.decision.reason === "asks_bank_info_profile_missing" && turn.tools.available().includes("shop.bankAccount")) {
      const r = await turn.tools.call("shop.bankAccount", {});
      if (r.ok && r.data.soTaiKhoan !== "") {
        out = router.route({ ...input, bank: { bankName: r.data.nganHang, accountNumber: r.data.soTaiKhoan, accountName: r.data.chuTaiKhoan } });
      }
    }
    return out;
  }

  /** Desk's level-2 note (the nine fact blocks) plus the frame, the focus, the photo and LLM#1's reading, one block each. */
  private composeNotes(turn: Turn, hint: string, blind = false): string[] {
    const { binding } = turn.req;
    const identity = applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam).identity;
    const nowIso = this.deps.clock.now().toISOString();
    const memoryNote = FactNoteComposer.compose({
      site: binding.origin, customerPronoun: identity.customerPronoun,
      conversationSummary: turn.contexts.renderMemory(turn.ctx.state, nowIso),
      // 05/10/2026 (phiếu Desk "vai trò ảnh", vai 3): a photo pinned to a code IS the item — its stock list stays.
      hasImage: turn.ctx.photos.length > 0 && !(turn.photos?.chot?.ket === "tu_tin" && !turn.photos.thamChieu),
      ...(turn.truth?.facts ?? {})
    }, loadNoteTexts(binding.packId));
    const frameNote = turn.ctx.frame !== null ? turn.contexts.describeFrame(turn.ctx.frame) : "";
    const focusNote = this.focusNote(turn);
    const truthLines = (turn.truth?.lines ?? []).join("\n");
    const photoNote = (blind ? turn.photos?.noteBlind ?? turn.photos?.note : turn.photos?.note) ?? "";
    const a = turn.analysis;
    const analysisNote = a !== null ? [
      `PHAN TICH NGU CANH (LLM#1): y dinh ${a.intent} (${a.confidence})${turn.router !== null && turn.router.intent.intent !== a.intent ? `, bo dinh tuyen chot ${turn.router.intent.intent}` : ""}.`,
      Object.keys(a.entities).length > 0 ? `Thuc the: ${JSON.stringify(a.entities)}.` : "",
      a.contextSummary !== "" ? `Boi canh: ${a.contextSummary}` : "",
      a.customerGoal !== "" ? `Muc tieu khach: ${a.customerGoal}` : "",
      a.focus.product !== "" ? `Mau chinh: ${a.focus.product}${a.focus.changed ? " (khach VUA DOI mau chinh)" : ""}.` : "",
      a.missingInformation.length > 0 ? `Con thieu: ${a.missingInformation.join(", ")}.` : "",
      a.lookupCommands.length > 0 ? `Nen tra cuu: ${a.lookupCommands.map((c) => `${c.command} ${JSON.stringify(c.args)}`).join("; ")}.` : "",
      a.riskFlags.length > 0 ? `Rui ro: ${a.riskFlags.join(", ")}.` : ""
    ].filter((line) => line !== "").join("\n") : "";
    // 30/09/2026: a customer who described a need is searched BY that need, never asked for a model name.
    // The impatience hint (an apology, then the answer) is kept; only the "ask for the model" hint gives way.
    const need = knownNeedOf(a, turn.ctx.state);
    const apology = turn.router?.decision.kind === "agent_draft" && turn.router.decision.reason === "impatience";
    // 05/10/2026 (phiếu Desk "vai trò ảnh", vai 2): the "photo not clear → ask which / what size" hint is only for a
    // photo nobody recognised; a photo read (or a reference) with a real question is the photo note's to answer.
    if (turn.router?.decision.kind === "agent_draft" && turn.router.decision.reason === "image_unclear_ai" && (turn.photos?.thamChieu === true || (turn.ctx.photos.length > 0 && !this.photoUnrecognised(turn)))) hint = "";
    const hintNote = [
      apology && hint !== "" ? hint : "",
      need !== ""
        ? `KHACH DA NOI NHU CAU: ${need}. Goi cong cu tra kho theo NHU CAU va nhung gi khach da cho biet; KHONG hoi lai ten / ma mau. Chi hoi dung dieu con thieu de chon.`
        : !apology && hint !== "" ? `CAU HOI LAI MAU (dung khi thieu mau/size, viet lai cho hop): ${hint}` : ""
    ].filter((line) => line !== "").join("\n");
    // 05/10/2026: the order block FIRST and whole — every model must know the customer already has an order.
    return [this.orderNote(turn), memoryNote, truthLines, frameNote, focusNote, photoNote, analysisNote, hintNote].filter((part) => part !== "");
  }

  /**
   * Codes (normalised) THIS message names: a code typed, a name / line the catalog resolved, the photo
   * matched this turn, the page card the customer replied to. Not the session's focus or the ledger.
   */
  private namedThisTurn(turn: Turn): string[] {
    const e = turn.router?.entities;
    const out = new Set<string>();
    if ((e?.productCode ?? "") !== "") out.add(itemKey(e!.productCode));
    if ((e?.productName ?? "") !== "" || (turn.truth?.query.productLine ?? "") !== "") for (const c of turn.truth?.resolution?.selected ?? []) out.add(itemKey(c.code));
    if (turn.photos?.chot?.ket === "tu_tin" && !turn.photos.thamChieu) out.add(itemKey(turn.photos.chot.ma));
    if (turn.ctx.focusedProduct?.by === "reply_to") out.add(itemKey(turn.ctx.focusedProduct.code ?? ""));
    out.delete("");
    return [...out];
  }

  /** "ĐƠN ĐANG CHẠY" / "ĐƠN CŨ" for the models (`order-care.ts`, wording in `ghi-chu-he-thong.json`); "" when no order. */
  private orderNote(turn: Turn): string {
    return turn.orders.length > 0 ? renderOrderNote(turn.orders, loadNoteTexts(turn.req.binding.packId).blocks) : "";
  }

  /** "MẪU ĐANG NÓI TỚI": the focus the resolver settled on, worded by where it came from; "" when none. */
  private focusNote(turn: Turn): string {
    const page = turn.ctx.focusedProduct;
    const resolved = turn.truth?.focus ?? null;
    const product = resolved !== null ? resolved.product : page;
    if (product === null || (product.code ?? "") === "") return "";
    const source = resolved?.source ?? (page?.by === "human_page" ? "page_sent" : "page_sent");
    const by = source === "page_sent" ? (page?.by === "reply_to" ? "khách trả lời vào tin này" : "người trực vừa gửi")
      : source === "catalog" ? "khớp catalog theo chữ khách gõ"
      : source === "ai" ? "LLM#1 nhận ra trong sổ"
      : source === "episode" ? "mẫu chính của phiên" : source === "ledger" ? "mẫu mới nhất trong sổ" : "đang bám từ lượt trước";
    return `MẪU ĐANG NÓI TỚI (${by}): ${product.name ?? ""} (${product.code}) — tra kho theo mã này trước, KHÔNG đổi sang mẫu khác trong sổ.`;
  }

  // ---------------------------------------------------------------- Desk steps 5–7: the truth

  private kitFor(binding: MerchantBinding): Stage3Kit {
    const cached = this.kits.get(binding.packId);
    if (cached !== undefined) return cached;
    const lines = loadProductLines(binding.packId);
    const scorer = new CatalogScorer(loadMatchingConfig(binding.packId), lines, binding.pack.lexicon.brands);
    const kit: Stage3Kit = { scorer, resolver: new CatalogResolver(scorer), gate: new UncertainProductGate(scorer, lines), lines, brands: binding.pack.lexicon.brands.map((b) => normalize(b)) };
    this.kits.set(binding.packId, kit);
    return kit;
  }

  /** One landing call, recorded for the dossier with its result cut down; a failure is data, never a throw. */
  private async lookup(turn: Turn, tool: ToolName, input: Record<string, unknown>, cut: (data: unknown) => unknown): Promise<unknown | null> {
    const started = this.deps.clock.now().getTime();
    const record: LookupRecord = { ten: tool, vao: input, ra: null, ms: 0 };
    turn.truth?.lookups.push(record);
    try {
      const r = await turn.tools.call(tool, input as never);
      record.ms = this.deps.clock.now().getTime() - started;
      if (!r.ok) { record.loi = r.error.message; this.deps.logger.warn(`[tra-cuu] ${turn.req.conversationId}: ${tool} loi: ${r.error.message}`); return null; }
      record.ra = cut(r.data);
      return r.data;
    } catch (error) {
      record.ms = this.deps.clock.now().getTime() - started;
      record.loi = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** Items as the dossier keeps them: code, name, the sizes with their quantities. */
  private cutItems(items: readonly FoundItem[]): unknown {
    return items.slice(0, LOOKUP_ITEMS_KEPT).map((it) => ({ ma: it.ma, ten: it.ten, size: it.cac_size.map((s) => `${s.size}${s.so_luong !== undefined ? `(${s.so_luong})` : ""}${s.gia ? `@${s.gia}` : ""}`).join(" ") }));
  }

  /** The finder's `ketQua` as items; a sentence ("không có") is no item. */
  private itemsOf(data: unknown): FoundItem[] {
    const list = data !== null && typeof data === "object" ? (data as { ketQua?: unknown }).ketQua : undefined;
    return Array.isArray(list) ? (list as FoundItem[]).filter((it) => it && typeof it.ma === "string" && Array.isArray(it.cac_size)) : [];
  }

  /**
   * Desk steps 5–7. The stock is looked up when the intent is about a product and something names
   * one (the message, LLM#1, the focus); the orders when the message is about an order and the
   * customer gave a phone number. Everything else is pure computation on what came back.
   */
  private async groundTruth(turn: Turn): Promise<Truth> {
    const { binding } = turn.req;
    const router = turn.router!;
    const kit = this.kitFor(binding);
    const cfg = kit.scorer.cfg;
    const nowIso = this.deps.clock.now().toISOString();
    const a = turn.analysis;
    const intent = router.intent.intent;
    const query = catalogQueryOf(router.entities, intent, this.trustedAnalysisEntities(turn));
    const truth: Truth = { askOrderPhone: null, query, found: [], level: "", resolution: null, uncertain: null, focus: { product: null, source: "none" }, stock: null, orders: [], portrait: null, facts: {}, lines: [], lookups: [] };
    turn.truth = truth;

    // The product something already points at: the page's card, the episode's main item, the engine's focus.
    let carried: ProductRef | null = turn.ctx.focusedProduct
      ?? (turn.ctx.state.episode?.focus ? { code: turn.ctx.state.episode.focus.code, name: turn.ctx.state.episode.focus.name } : null)
      ?? (turn.ctx.state.focusItemCode ? { code: turn.ctx.state.focusItemCode } : null);
    const photoCode = turn.photos?.chot?.ket === "tu_tin" && !turn.photos.thamChieu ? turn.photos.chot.ma : "";
    // Desk `dropStaleFocusOnImageTurn`, BEFORE any lookup: under a photo nobody recognised, a focus
    // inherited from outside this session is not "đôi này" — its stock must not even be looked up.
    const photos = turn.photos;
    const imageRecognised = photos !== null && (photos.chot !== null || photos.read.code !== "" || (photos.read.model !== "" && !photos.dongChuaChac));
    if (turn.ctx.photos.length > 0 && !imageRecognised && turn.ctx.focusedProduct === null && carried !== null && (carried.code ?? "") !== "") {
      const session = normalize(this.sessionLines(turn).map((t) => t.text).join(" "));
      if (!session.includes(normalize(carried.code))) carried = null;
    }
    // Desk `contextProduct`: the local hint names nothing usable (no code, no line, no brand) but LLM#1's
    // focus is a product this session still talks about → look THAT up (kb2-19 "size 41 1/3 nhé").
    const focusHint = this.focusFromAnalysis(turn, kit);
    if (query.productCode === "" && !this.namesProduct(query.productName, kit) && focusHint !== null) {
      if (focusHint.code !== "") query.productCode = focusHint.code; else query.productName = focusHint.name;
      truth.lines.push(`MAU THEO NGU CANH (LLM#1, phien nay con nhac): ${focusHint.name || focusHint.code}.`);
    }
    // An exchange of an ORDER ("đổi sang size 43, mình đặt hôm qua"): the order branch, never the
    // "which product?" gate — the product is on the order (Desk `ensureOrderLookupForExchange`, kb2-07).
    const exchangeOfOrder = this.exchangeOfOrder(turn, intent);
    const aboutProduct = new Set([...cfg.uncertain.askProductIntents, ...cfg.uncertain.productTalkIntents]);
    // Money / account talk is never a product question, whatever LLM#1 read (kb2-20: "gửi mình số tài khoản" was asked "which product?").
    const moneyTalk = ["asks_bank_info", "deposit_instruction", "payment_confirmation"].includes(router.localIntent.intent) || ["asks_bank_info", "deposit_instruction", "payment_confirmation"].includes(intent);
    const wantsStock = !exchangeOfOrder && !moneyTalk && (aboutProduct.has(intent) || (a?.lookupCommands ?? []).some((c) => c.command === "resolve_stock"));
    const named = query.productCode !== "" || query.productName !== "" || query.productLine !== "" || photoCode !== "" || (carried?.code ?? "") !== "";
    // 05/10/2026 (phiếu Desk 22/09 "size 2x trần là cm tem"): a TAG reading goes down as written ("25cm") — the
    // landing converts it with the chart of EACH item's own brand. The industry table's label is only the net.
    const tagCm = router.entities.sizeTag ?? "";
    const tagNet = query.size;
    let tagAsked = tagCm !== "" && query.size !== "" && query.size === router.entities.size ? `${tagCm}cm` : "";
    // The brand is already named and has NO chart on this landing (or the landing has no charts at all): the
    // finder could not convert either — the net straight away, said as a general conversion.
    const tagBrand = tagAsked !== "" ? this.focusBrand(turn, truth) : "";
    if (tagAsked !== "" && (tagBrand !== "" || !turn.tools.available().includes("variant.brandChart" as ToolName))) {
      const chart = await this.brandChart(turn, truth, tagBrand);
      if (chart !== null) truth.size = { brand: tagBrand, chart, hint: null };
      else { tagAsked = ""; truth.tagSize = { tem: tagCm, size: tagNet, brand: tagBrand, general: true }; }
    }
    if (tagAsked !== "") query.size = tagAsked;
    const stockCode = query.productCode || photoCode || (query.productName === "" && query.productLine === "" ? carried?.code ?? "" : "");

    // (a) The stock: the landing's ladder when it opens one, else Xeon walks the finder rung by rung.
    if (wantsStock && named) {
      await this.lookupStock(turn, kit, { ...query, productCode: stockCode });
    }

    // (a2) 05/10/2026 (phiếu Desk 08/09, 30/09, 09/09): nothing of the kind asked came back by name — ask the
    // landing which of ITS catalog's groups the words name (item names never carry the group's word). Every product word a group name = a CATEGORY question: look up by the group, no "which
    // item?", no old anchor, and an empty group is "đang hết", never "không bán". A photo turn is the photo's.
    truth.group = wantsStock && query.productCode === "" && turn.ctx.photos.length === 0 ? await this.groupLookup(turn, kit, query) : null;
    const groupQuestion = truth.group?.question === true && intent !== "place_order";
    if (groupQuestion) {
      const seen = new Set(truth.found.map((it) => normalize(it.ma)));
      for (const it of truth.group!.items) if (!seen.has(normalize(it.ma))) { seen.add(normalize(it.ma)); truth.found.push(it); }
    }
    if (tagAsked !== "") {
      await this.settleTagSize(turn, query, { tem: tagCm, asked: tagAsked, net: tagNet, relook: wantsStock && named ? (size) => this.lookupStock(turn, kit, { ...query, productCode: stockCode, size }) : null });
    }

    // (b) Which product, and is it clear enough.
    const ledgerProducts = turn.ctx.state.ledger?.products ?? [];
    truth.resolution = wantsStock && !groupQuestion ? kit.resolver.resolve({
      query: { ...query, productCode: query.productCode || photoCode }, found: truth.found, focused: carried, ledgerProducts,
      strongEvidence: photoCode !== "" ? "image_auto_match" : undefined
    }) : null;
    // LLM#2: one candidate, no strong reason → ask the model which one, with the last lines in view.
    if (truth.resolution !== null && truth.resolution.needVerify) await this.verifyGuess(turn, carried);
    truth.uncertain = wantsStock ? this.applyGate(turn, kit, query, carried !== null || photoCode !== "" || focusHint !== null, groupQuestion) : null;
    // 05/10/2026 (phiếu Desk 09/09): the category link is the agent's to give, with real items — the ready
    // sentence is only the net when no model answers (step 8).
    if (truth.uncertain?.action === "script_reply" && this.agentMayRun(turn)) {
      const v = truth.uncertain;
      truth.net = v.reply;
      truth.uncertain = { action: "drop_anchor", reason: "type_mismatch_category", why: "type_mismatch_category", productType: v.productType, dropped: v.dropped };
    }
    if (truth.uncertain?.action === "drop_anchor") {
      truth.query = { ...query, productCode: "" };
      truth.lines.push(`KHACH HOI LOAI HANG "${truth.uncertain.productType.label}", KHONG PHAI mau dang bam — tra kho theo loai hang nay, KHONG tra loi ve mau cu.`);
    }
    if (groupQuestion) {
      truth.query = { ...query, productCode: "" };
      const g = truth.group!;
      const label = [g.loai, g.mon].filter(Boolean).join(" ");
      const examples = g.items.slice(0, 5).map((it) => `${it.ten} (${it.ma})`).join("; ");
      truth.lines.push(`KHACH HOI NHOM HANG "${label}" cua catalog shop (khong phai mot mau) — tra kho theo nhom (tra_kho nhom="${label}"), KHONG tra loi ve mau dang bam, KHONG noi "khong ban". `
        + (g.items.length > 0 ? `Nhom con ${g.items.length}${g.items.length >= 8 ? "+" : ""} mau con hang, vd: ${examples}.` : `Nhom nay hien KHONG con mau nao con hang${query.size !== "" ? ` size ${query.size}` : ""}: noi "nha em hien dang het hang", moi khach xem: ${g.link || "web shop"}.`));
    }
    const anchorDropped = groupQuestion || truth.uncertain?.action === "drop_anchor";

    // (c) The focus, in Desk's trust order. A dropped anchor is not "the item we are talking about".
    truth.focus = anchorDropped ? { product: null, source: "none" } : this.resolveFocus(turn, carried, nowIso);

    // (d) The stock truth of the focus (or the single match), and the note blocks.
    const anchorCode = anchorDropped ? "" : truth.focus.product?.code || truth.resolution?.selected[0]?.code || "";
    const requestedSize = query.size || (turn.ctx.frame?.answer === "size" ? turn.ctx.frame.size : "");
    if (anchorCode !== "" && truth.found.length > 0) {
      const size = requestedSize;
      truth.stock = buildStockFacts(truth.found, { code: anchorCode, requestedSize: size, otherColorsAsked: asksOtherVariants(cfg, turn.text) }, cfg, {
        lines: kit.lines,
        filterLink: (q) => `${binding.origin}/?q=${encodeURIComponent([q.line, q.version].filter((x) => x !== "").join(" "))}${q.size !== "" ? `&size=${encodeURIComponent(q.size)}` : ""}#products`
      });
    }
    const selected = truth.resolution?.selected ?? [];
    await this.sizeAdvice(turn, truth);
    // 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): named item / everyday need / the specialist profile, from the session.
    truth.consult = aboutProduct.has(intent) || a?.intent === "product_advice" ? this.consultOf(turn, truth, kit) : null;
    truth.facts = {
      ...(selected.length > 0 ? { found: selected.map((c) => ({ code: c.code, name: c.name, price: c.price || undefined, variants: variantsForNote(c.sizes, requestedSize, kit.scorer.sizes), partner: c.source === "partner" })) } : {}),
      ...turnFactsFromStock(truth.stock),
      ...(truth.tagSize !== undefined && truth.tagSize.size !== ""
        ? { variantHint: { variant: truth.tagSize.size, tem: truth.tagSize.tem, bareJp: router.entities.sizeSource === "bare_tag", raw: truth.tagSize.tem, brand: truth.tagSize.brand || undefined, general: truth.tagSize.general } }
        : router.entities.sizeNote !== "" && router.entities.size !== "" ? { variantHint: { variant: router.entities.size, label: router.entities.sizeNote } } : {}),
      // 05/10/2026: MON (a sport group with stock) / LOAI_HANG (a type, or a group with nothing in stock: the web's list of it).
      ...this.groupFacts(truth, groupQuestion, query.size),
      // 05/10/2026 (phiếu Desk nhóm số đo): the variant the table gives for the customer's measurements, or "not yet".
      ...(truth.size?.hint ? { sizeAdvice: { ...truth.size.hint, brand: truth.size.brand } } : {}),
      ...this.consultFacts(turn, truth, query.size)
    };
    if (truth.stock !== null) truth.lines.push(`TON THUC TE cua ${truth.stock.productName} (${truth.stock.productCode})${truth.stock.requestedSize !== "" ? ` size ${truth.stock.requestedSize}` : ""} — NGUON DUY NHAT khi noi ve ton/gia bien the nay; stock=null la HET bien the do: ${JSON.stringify(truth.stock)}`);
    if (truth.resolution?.needVerify === true && selected[0] !== undefined) {
      truth.lines.push(`CHUA CHAC MAU: khach gõ chưa đủ để khẳng định; gần nhất là ${selected[0].name} (${selected[0].code}). HỎI XÁC NHẬN "mẫu ${selected[0].name} phải không ạ?" TRƯỚC khi báo giá/tồn, KHÔNG tự chốt.`);
    }
    if (truth.resolution?.status === "multiple_matches" && selected.length > 1) {
      truth.lines.push(`NHIEU MAU GAN GIONG (${selected.map((c) => `${c.name} (${c.code})`).join("; ")}): hoi khach chon mau, KHONG doan.`);
    }
    if (truth.uncertain?.action === "agent_draft") truth.lines.push(`CHUA RO MAU (${truth.uncertain.why}): hoi lai ten mau / ma, KHONG bao ton hay gia.`);

    // (d2) Advice by need (Desk line_fit + server.js:16182): pace × distance → the lines that fit, with stock → NHIEU_DONG.
    await this.lineFamilies(turn);

    // (e) The orders and the customer, by the phone number the customer typed.
    await this.lookupOrders(turn, intent, exchangeOfOrder);
    return truth;
  }

  /** The hint names a product: a line of the industry, a brand, or a word that is not a stop word. */
  private namesProduct(hint: string, kit: Stage3Kit): boolean {
    const n = normalize(hint);
    if (n === "") return false;
    if (findLine(n, kit.lines) !== null) return true;
    const brands = this.kitBrands(kit);
    if (brands.some((b) => b !== "" && n.includes(b))) return true;
    return n.split(" ").some((t) => /\p{L}/u.test(t) && t.length >= 4);
  }

  private kitBrands(kit: Stage3Kit): string[] {
    return kit.brands;
  }

  /**
   * LLM#1's focus as a product to look up: a ledger product it names (by code or name), or a name
   * the last 30 minutes of the thread mention. A focus nobody mentioned is a hallucination and is ignored.
   */
  private focusFromAnalysis(turn: Turn, kit: Stage3Kit): { code: string; name: string } | null {
    const a = turn.analysis;
    if (a === null) return null;
    const raw = (a.focus.product || [String(a.entities["productLine"] ?? ""), String(a.entities["modelVersion"] ?? "")].filter((x) => x.trim() !== "").join(" ")).trim();
    if (raw === "") return null;
    const n = normalize(raw);
    const ledger = turn.ctx.state.ledger?.products ?? [];
    const hit = ledger.find((p) => p.code !== "" && n.includes(normalize(p.code))) ?? ledger.find((p) => p.name !== "" && (n.includes(normalize(p.name)) || normalize(p.name).includes(n)));
    if (hit !== undefined) {
      // 05/10/2026 (phiếu Desk "ảnh lượt này mượn dữ liệu ngoài phiên"): under a photo nobody recognised, a
      // memory item counts only when THIS session names it — the model read it from the old part of the thread.
      if (this.photoUnrecognised(turn)) {
        const session = normalize(this.sessionTexts(turn).join(" "));
        if (!session.includes(normalize(hit.code)) && !(hit.name !== "" && session.includes(normalize(hit.name)))) return null;
      }
      return { code: hit.code, name: hit.name };
    }
    const nowMs = this.deps.clock.now().getTime();
    const recent = turn.ctx.history.filter((h) => { const at = Date.parse(h.at ?? ""); return !Number.isFinite(at) || nowMs - at <= 30 * 60_000; }).map((h) => normalize(h.text)).join(" | ");
    const line = findLine(raw, kit.lines);
    const words = n.split(" ").filter((t) => t.length >= 3);
    const mentioned = (line !== null && [line.name, ...(line.aliases ?? [])].some((al) => recent.includes(normalize(al)))) || (words.length > 0 && words.every((w) => recent.includes(w)));
    if (!mentioned) return null;
    return { code: /^[A-Z]{1,3}\d{4,}$/i.test(raw) ? raw.toUpperCase() : "", name: raw };
  }

  /** The turn asks to exchange / change the size of an ORDER already placed. */
  private exchangeOfOrder(turn: Turn, intent: string): boolean {
    const { binding } = turn.req;
    const engineIntent = detectIntent(binding.pack, turn.text);
    const exchange = intent === "return_exchange" || turn.analysis?.intent === "return_exchange" || engineIntent?.tools.includes("policy.get") === true;
    const orderTalk = packRegexOf(loadEntityConfig(binding.packId).orderTalk)?.test(normalize(turn.text)) ?? false;
    return exchange && orderTalk;
  }

  /**
   * Advice by need: the pace and distance LLM#1 read (or the customer's words) against the industry's
   * line-fit matrices (`line-dna.json`), the finder asked for that segment and size, the fitting lines
   * that have stock → the NHIEU_DONG block with one link per line (Desk server.js:16182).
   */
  private async lineFamilies(turn: Turn): Promise<void> {
    const { binding } = turn.req;
    const truth = turn.truth!;
    const a = turn.analysis;
    const intent = turn.router?.intent.intent ?? "";
    // 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): with a consultation profile, lines are offered only once it is
    // complete (or its missing pieces were already asked) — never for a named item, an everyday need, or a profile still
    // to ask — and the profile is read from the whole session (a short follow-up keeps it); the axes the profile
    // knows (an inference gives its band) feed the scorer.
    const consult = truth.consult ?? null;
    if (consult !== null && consult !== undefined) {
      if (consult.status !== "du" && consult.status !== "da-hoi") return;
    } else if (!(intent === "product_advice" || a?.intent === "product_advice" || (turn.router?.entities.need ?? "") !== "")) return;
    const knownPace = consult?.axes["pace"];
    const knownDistance = consult?.axes["distance"];
    const paceText = knownPace?.said || String(a?.needBrief["pace"] ?? "") || turn.text;
    const distanceText = knownDistance?.said || String(a?.needBrief["distance"] ?? "") || turn.text;
    const minutes = parsePaceMinutes(paceText);
    const pb = knownPace?.band || paceBand(minutes);
    const db = knownDistance?.band || distanceBand(distanceText);
    if (pb === null && db === null) return;
    const rawLines = loadRawProductLines(binding.packId) as LineDna[];
    if (rawLines.length === 0) return;
    const knowledge = new LineKnowledge(rawLines);
    const size = turn.router?.entities.size ?? "";
    // The segment the pack's own rule states (agent.json): racing under 5:00, tempo under 6:00, daily otherwise.
    const segment = minutes !== null && minutes < 5 ? "dua" : minutes !== null && minutes < 6 ? "tempo" : "daily";
    if (!turn.tools.available().includes("catalog.find")) return;
    const data = await this.lookup(turn, "catalog.find", { phan_khuc: segment, ...(size !== "" ? { size } : {}), ...(turn.ownStockOnly ? { chi_hang_san: true } : {}) }, (d) => this.cutItems(this.itemsOf(d)));
    const items = this.itemsOf(data);
    if (items.length === 0) return;
    const rec = knowledge.recommend({ paceText, distanceText, ...(pb !== null && pb !== "" ? { paceBand: pb } : {}), ...(db !== null && db !== "" ? { distanceBand: db } : {}) }, items.map((it) => it.ten), 3);
    if (rec.picks.length === 0) return;
    truth.facts.lineFamilies = rec.picks.map((pick) => {
      const line = knowledge.byId(pick.id);
      const own = items.filter((it) => knowledge.findByText(it.ten)?.id === pick.id);
      const examples = own.slice(0, 2).map((it) => `${it.ten} (${it.ma})${priceOf(it) > 0 ? ` — ${priceOf(it).toLocaleString("vi-VN")}đ` : ""}`);
      const q = line?.aliases?.[0] ?? pick.name;
      return { name: pick.name, note: pick.note, examples, url: `${binding.origin}/?q=${encodeURIComponent(q)}${size !== "" ? `&size=${encodeURIComponent(size)}` : ""}#products` };
    });
    for (const it of items) { const key = normalize(it.ma); if (key !== "" && !truth.found.some((f) => normalize(f.ma) === key)) truth.found.push(it); }
    truth.lines.push(`NHU CAU KHACH (LLM#1/chu khach): pace ${pb ?? "?"}, cu ly ${db ?? "?"} → phan khuc "${segment}". Chi goi y trong cac ho ben duoi; KHONG doi sang mau khac phan khuc.`);
    turn.steps.push({ loai: "cong-cu", ten: "Chấm dòng theo nhu cầu", chiTiet: rec.picks.map((p) => `${p.name} (${p.score})`).join("; ") });
  }

  /** The landing's stock ladder when it opens one, else the finder rung by rung as `planStockCascade` says. */
  private async lookupStock(turn: Turn, kit: Stage3Kit, query: CatalogQuery): Promise<void> {
    const truth = turn.truth!;
    const open = turn.tools.available();
    const seen = new Set<string>();
    const gather = (items: readonly FoundItem[]): void => {
      for (const it of items) { const key = normalize(it.ma); if (key === "" || seen.has(key)) continue; seen.add(key); truth.found.push(it); }
    };
    const size = query.size;
    if (open.includes("catalog.resolveStock")) {
      const hint = query.productName || query.productLine;
      const line = (findLine(hint, kit.lines) ?? findLine(turn.text, kit.lines)) as CascadeLine | null;
      const byId = new Map(kit.lines.map((l) => [l.id, l] as const));
      const aliasesOf = (ids: readonly string[]): string[] => ids.flatMap((id) => { const l = byId.get(id); return l ? [l.name, ...(l.aliases ?? [])] : []; });
      const version = query.modelVersion || (line !== null ? kit.scorer.versions.afterLine(`${hint} ${turn.text}`, [line.name, ...(line.aliases ?? [])]) : "");
      const input = {
        ...(query.productCode !== "" ? { ma: query.productCode } : {}),
        ...(hint !== "" ? { ten: hint } : line !== null ? { ten: line.name } : {}),
        ...(version !== "" ? { doiSo: version } : {}),
        ...(size !== "" ? { size } : {}),
        ...(query.productType !== "" ? { loaiHang: query.productType } : {}),
        ...(line !== null && (line.equivalents ?? []).length > 0 ? { dongTuongDuong: aliasesOf(line.equivalents ?? []) } : {}),
        ...(line !== null && (line.beginnerAlternative ?? []).length > 0 ? { dongNguoiMoi: aliasesOf(line.beginnerAlternative ?? []) } : {})
      };
      const data = await this.lookup(turn, "catalog.resolveStock", input, (d) => {
        const o = d as ToolOutput<"catalog.resolveStock">;
        return { resolvedLevel: o.resolvedLevel, anchor: o.anchor, exact: o.exact ? { hasRequestedSize: o.exact.hasRequestedSize, rows: this.cutItems(o.exact.rows), otherKho: o.exact.otherKho } : null, sameLineSameVersion: this.cutItems(o.sameLineSameVersion), sameLineOtherVersion: this.cutItems(o.sameLineOtherVersion), equivalents: this.cutItems(o.equivalents), note: o.note };
      }) as ToolOutput<"catalog.resolveStock"> | null;
      if (data !== null) {
        truth.level = data.resolvedLevel;
        const strip = (rows: readonly ToolOutput<"catalog.resolveStock">["sameLineSameVersion"][number][]): FoundItem[] => rows.map(({ hasRequestedSize: _h, doi: _d, ...item }) => item as FoundItem);
        gather(strip(data.exact?.rows ?? []));
        gather(strip(data.sameLineSameVersion));
        gather(strip(data.sameLineOtherVersion));
        gather(strip(data.equivalents));
        if (data.note !== "") truth.lines.push(`BAC THANG TON KHO (landing): ${data.note}`);
        return;
      }
    }
    if (!open.includes("catalog.find")) return;
    let steps = planStockCascade({ productCode: query.productCode, productName: query.productName || query.productLine, size, modelVersion: query.modelVersion, message: turn.text }, kit.lines, kit.scorer.versions);
    if (steps.length === 0 && (query.productCode !== "" || query.productName !== "")) {
      steps = [{ level: "exact_code", find: { ...(query.productCode !== "" ? { ma: query.productCode } : { ten: query.productName }), ...(size !== "" ? { size } : {}) }, stopWhenSizeFound: true }];
    }
    const walked: string[] = [];
    let served = false;
    for (const step of steps) {
      // The line's own rungs are walked until one serves the size; an equivalent / beginner line is
      // only opened when none did, and ONE such line with the size is enough — the cascade must not
      // cost eleven finder calls for a customer who asked for one shoe.
      const alternative = step.level === "equivalent_line" || step.level === "beginner_line";
      if (alternative && served) break;
      const find = { ...this.groupWords(kit), ...step.find };
      const data = await this.lookup(turn, "catalog.find", turn.ownStockOnly ? { ...find, chi_hang_san: true } : find, (d) => this.cutItems(this.itemsOf(d)));
      const items = this.itemsOf(data);
      walked.push(step.level);
      gather(items);
      if (step.line?.note && items.length > 0 && alternative) {
        truth.lines.push(`${step.level === "equivalent_line" ? "DONG TUONG DUONG" : "DONG CHO NGUOI MOI"} ${step.line.name}: ${step.line.note}`);
      }
      const hasSize = size !== "" && items.some((it) => kit.scorer.sizes.nearest(inStockRows(it), size) !== null);
      if (hasSize || (size === "" && items.length > 0)) served = true;
      if (served && (step.stopWhenSizeFound || alternative)) break;
    }
    truth.level = walked.join(" › ");
  }

  /** The industry's everyday words for the catalog's groups, for every `catalog.find` (an older landing ignores them). */
  private groupWords(kit: Stage3Kit): { biDanhNhom?: Record<string, string>; khongPhaiNhom?: string[] } {
    const g = kit.scorer.cfg.groups;
    return {
      ...(Object.keys(g.aliases).length > 0 ? { biDanhNhom: g.aliases } : {}),
      ...(g.notGroup.length > 0 ? { khongPhaiNhom: g.notGroup } : {})
    };
  }

  /**
   * 05/10/2026: which groups of the merchant's catalog the message names — asked only when nothing of the
   * kind asked came back by name. The landing reads its OWN group labels (the storefront filter) plus the
   * industry's everyday words; Xeon only decides whether the words left over are chatter or a product name.
   */
  private async groupLookup(turn: Turn, kit: Stage3Kit, query: CatalogQuery): Promise<CatalogGroupAsk | null> {
    const truth = turn.truth!;
    if (!turn.tools.available().includes("catalog.find")) return null;
    const asked = kit.scorer.canonicalType(query.productType);
    if (truth.found.some((it) => { const kind = kit.scorer.typeOf(it); return asked === "" || kind === "" || kind === asked; })) return null;
    const input = { ten: turn.text, chi_nhom: true, ...this.groupWords(kit), ...(query.size !== "" ? { size: query.size } : {}), ...(turn.ownStockOnly ? { chi_hang_san: true } : {}) };
    const data = await this.lookup(turn, "catalog.find", input, (d) => ({ nhomKhop: (d as { nhomKhop?: unknown }).nhomKhop ?? null, ketQua: this.cutItems(this.itemsOf(d)) }));
    const match = data !== null && typeof data === "object" ? (data as ToolOutput<"catalog.find">).nhomKhop : undefined;
    if (match === undefined || match === null || (String(match.loai ?? "") === "" && String(match.mon ?? "") === "")) return null;
    const cfg = kit.scorer.cfg;
    const chatter = new Set([...cfg.uncertain.genericItemTokens, ...cfg.noiseTokens].map((t) => normalize(t)));
    const leftover = (Array.isArray(match.conLai) ? match.conLai : []).map((w) => normalize(String(w)))
      .filter((w) => w.length > 2 && !chatter.has(w) && !kit.brands.includes(w));
    const group: CatalogGroupAsk = { loai: String(match.loai ?? ""), mon: String(match.mon ?? ""), link: String(match.link ?? ""), items: this.itemsOf(data), question: leftover.length === 0, leftover };
    turn.steps.push({ loai: "cong-cu", ten: "Nhóm hàng của catalog", chiTiet: `${[group.loai, group.mon].filter(Boolean).join(" / ")} — ${group.items.length} mẫu còn hàng${group.question ? "" : ` · còn chữ "${leftover.join(" ")}" → không phải câu hỏi nhóm`}` });
    return group;
  }

  /** The note blocks of a category question: MON for a sport group with stock, else LOAI_HANG with the web's list. */
  private groupFacts(truth: Truth, groupQuestion: boolean, size: string): Pick<TurnFacts, "sport" | "productType"> {
    const g = truth.group;
    if (groupQuestion && g) {
      const label = [g.loai, g.mon].filter(Boolean).join(" ");
      if (g.mon !== "" && g.items.length > 0) return { sport: { label: g.mon, purpose: label, count: g.items.length, ...(size !== "" ? { variant: size } : {}) } };
      if (g.link !== "") return { productType: { type: label, link: g.link, ...(size !== "" ? { variant: size } : {}) } };
      return {};
    }
    const v = truth.uncertain;
    if (v?.action === "drop_anchor" && v.productType.link !== "") return { productType: { type: v.productType.label, link: v.productType.link } };
    return {};
  }

  /** The agent will be asked this turn (models on, an agent with its handbook) — tools are checked when it runs. */
  private agentMayRun(turn: Turn): boolean {
    const agent = this.deps.agent;
    return !turn.modelsOff && agent !== null && agent !== undefined && agent.ready() && turn.req.binding.pack.agent !== undefined;
  }

  /** Desk `applyUncertainProductGate` with this shop's sentences (`hoiLai`, filled by the router's filler). */
  private applyGate(turn: Turn, kit: Stage3Kit, query: CatalogQuery, hasFocus: boolean, groupQuestion = false): UncertainVerdict | null {
    const { binding } = turn.req;
    const router = turn.router!;
    const truth = turn.truth!;
    const texts = loadScriptTexts(binding.packId).hoiLai;
    const fillInput = { profile: turn.hoSo, site: binding.origin, tenShop: binding.shopName };
    const hoiLai = (key: string, vars: Record<string, string>): string | null => {
      const text = texts[key];
      if (text === undefined) return null;
      const pre = Object.entries(vars).reduce((s, [k, v]) => (v !== "" ? s.split(`{${k}}`).join(v) : s), text);
      return this.routerFor(binding).fillScript({ action: "ask_clarification", reply: pre }, fillInput);
    };
    const cfg = kit.scorer.cfg;
    // 05/10/2026: the storefront's TYPE filter (`?type=`, desktop and mobile), not the free-text box (`?q=`
    // searched names on mobile, so a type label found nothing there) — Desk's link was `?type=` too.
    const typeLinks = Object.fromEntries(Object.entries(cfg.types.labels).map(([kind, label]) => [kind, `${binding.origin}/?type=${encodeURIComponent(label)}#products`]));
    const turns = turn.ctx.turns.slice(0, -1);
    const lastPage = [...turns].reverse().find((t) => t.role === "shop");
    const lastCustomer = [...turns].reverse().find((t) => t.role === "customer");
    const now = this.deps.clock.now();
    const brand = normalize(String(turn.analysis?.entities["brand"] ?? "") || query.brand);
    const brandInCatalog = brand !== "" && truth.found.length > 0 ? truth.found.some((it) => kit.scorer.brandOf(it).includes(brand)) : undefined;
    // Brands to offer instead of one the stock does not have: ONLY those the stock search returned (02/10/2026).
    const carriedBrands = [...new Set(truth.found.map((it) => kit.scorer.brandOf(it)).filter((b) => b !== "" && !b.includes(brand)))];
    return kit.gate.apply({
      message: turn.text, intent: router.intent.intent,
      entities: { productCode: query.productCode, productName: query.productName, brand: query.brand, productType: query.productType },
      analysis: turn.analysis !== null ? { productName: String(turn.analysis.entities["productName"] ?? "") || undefined, brand: String(turn.analysis.entities["brand"] ?? "") || undefined, productType: String(turn.analysis.entities["productType"] ?? "") || undefined } : undefined,
      resolution: truth.resolution, hasImage: turn.ctx.photos.length > 0, hasFocus,
      // 05/10/2026 (phiếu Desk 07/09): only an item of the kind asked counts as "found" — a shoe the name
      // search brought up by a short word (a letter size) must not silence the "which item?" question.
      cascadeFound: truth.found.some((it) => { const asked = kit.scorer.canonicalType(query.productType); const kind = kit.scorer.typeOf(it); return asked === "" || kind === "" || kind === asked; }),
      continuation: router.intent.matched.some((tag) => tag.startsWith("frame_")),
      groupQuestion,
      // 05/10/2026: the item the conversation is pinned to is an anchor too (a category question while pinned to another type).
      anchorItems: hasFocus ? truth.found.filter((it) => { const c = normalize(it.ma); return c !== "" && (c === normalize(turn.ctx.focusedProduct?.code ?? "") || c === normalize(turn.ctx.state.episode?.focus?.code ?? "") || c === normalize(turn.ctx.state.focusItemCode ?? "")); }) : [],
      state: {
        // 05/10/2026 (phiếu Desk "lượt trước đã gửi câu gì", Desk v93e): "already asked back" means asked back
        // WITHIN the industry's ask-back window (`ask_back_once.windowMinutes`, platform default 30 minutes) — not
        // ever in the episode, which turned every unclear message of a long chat into a handoff.
        askedBackBefore: askedBackWithin(turn.ctx.state, now, askBackWindowMinutes(binding.pack)),
        askBackCount: askedBackWithin(turn.ctx.state, now, askBackWindowMinutes(binding.pack)) ? turn.ctx.state.askBackCount : undefined,
        // 05/10/2026 (phiếu Desk "gửi ảnh rồi hỏi"): the thread's photo lines too — a draft, a folded photo never reached the memory.
        hasRecentImageEvidence: hasRecentImageEvidence(turn.ctx.state, now) || turn.ctx.photoEvidence,
        lastPageAt: lastPage?.at, lastCustomerAt: lastCustomer?.at, episodeLastAt: turn.ctx.state.episode?.lastAt
      },
      now: now.toISOString(),
      lexicon: binding.pack.lexicon,
      brandInCatalog, carriedBrands, typeLinks, hoiLai
    });
  }

  /** Desk's focus chain: the page's card, the session test on an unrecognised photo, the catalog match, the carried focus, LLM#1's claim, the episode, the ledger. */
  /** The session: the thread's lines after the last gap of six hours or more. */
  /**
   * 05/10/2026 (phiếu Desk 22/09 "size 2x trần là cm tem", phần 2): LLM#1's variant is kept only when the
   * CUSTOMER said it, or just agreed to the page's message naming it — a model reading back the bot's own
   * "44 2/3" made the bot defend what it had invented.
   */
  private trustedAnalysisEntities(turn: Turn): Record<string, unknown> {
    const entities = this.corroboratedProduct(turn, turn.analysis?.entities ?? {});
    const raw = entities["size"];
    const size = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
    if (size === "") return entities;
    const agreedTo = turn.ctx.frame?.answer === "agree" ? turn.ctx.frame.pageText : "";
    if (variantSaidByCustomer(size, this.customerSessionTexts(turn), agreedTo)) return entities;
    return { ...entities, size: "" };
  }

  /**
   * 05/10/2026 (phiếu Desk "ảnh lượt này mượn dữ liệu ngoài phiên", Desk ai_router.js:1279): the code LLM#1
   * filled stands only when someone SAID it — in the thread, or in the memory the analysis was shown. On a
   * turn whose photo nobody recognised, only THIS session counts (the photo is "cái này", not the list the page
   * sent thirteen days ago), and a product name of which the session says no word is dropped too.
   */
  private corroboratedProduct(turn: Turn, entities: Record<string, unknown>): Record<string, unknown> {
    const str = (key: string): string => { const v = entities[key]; return typeof v === "string" || typeof v === "number" ? String(v).trim() : ""; };
    const code = str("productCode");
    const name = str("productName");
    if (code === "" && name === "") return entities;
    const blindPhoto = this.photoUnrecognised(turn);
    const scope = normalize((blindPhoto ? this.sessionTexts(turn) : turn.ctx.history.map((h) => h.text)).join(" ") + " " + turn.text);
    const out = { ...entities };
    if (code !== "") {
      const memory = blindPhoto ? [] : (turn.ctx.state.ledger?.products ?? []).map((p) => normalize(p.code));
      const printed = [turn.photos?.read.code ?? "", turn.photos?.chot?.ket === "tu_tin" ? turn.photos.chot.ma : ""].map((c) => normalize(c)).filter((c) => c !== "");
      const k = normalize(code).replace(/\s+/g, "");
      // 05/10/2026 (phiếu Desk "mã viết cách"): "IM 7681" typed in the thread is the same code as LLM#1's "IM7681".
      const said = scope.includes(k) || scope.replace(/([a-z]) (?=\d)/g, "$1").includes(k);
      if (!said && !memory.includes(k) && !printed.includes(k)) {
        out["productCode"] = "";
        turn.steps.push({ loai: "chan", ten: "Mã LLM#1 điền", chiTiet: `Bỏ mã ${code}: ${blindPhoto ? "phiên này" : "hội thoại"} không ai nhắc.` });
      }
    }
    if (blindPhoto && name !== "" && !normalize(name).split(" ").some((w) => w.length >= 3 && scope.includes(w))) out["productName"] = "";
    return out;
  }

  /** 05/10/2026: what the current session SAID, as the transcript shows it (a recognised photo by its label). */
  private sessionTexts(turn: Turn): string[] {
    return turn.ctx.history.slice(sessionStartIndex(turn.ctx.history.map((h) => h.at))).map((h) => h.text);
  }

  /** 05/10/2026: the turn carries a photo nobody recognised (no code pinned or read, no confirmed line) — "cái này" is that photo. */
  private photoUnrecognised(turn: Turn): boolean {
    const p = turn.photos;
    return turn.ctx.photos.length > 0 && !(p !== null && (p.chot !== null || p.read.code !== "" || (p.read.model !== "" && !p.dongChuaChac)));
  }

  /** The customer's lines of the current session, oldest first, the message being handled last. */
  private customerSessionTexts(turn: Turn): string[] {
    const lines = this.sessionLines(turn).filter((t) => t.role === "customer").map((t) => t.text);
    if (lines[lines.length - 1] !== turn.text && turn.text.trim() !== "") lines.push(turn.text);
    return lines;
  }

  /**
   * 05/10/2026 (phiếu Desk nhóm số đo): the customer's measurements (with or without their unit) → the
   * variant of the industry's table in the brand's own labels, or "not yet: ask for the rest". A tag
   * reading this turn is surer than a self-measured body and wins (it already filled the size).
   */
  private async sizeAdvice(turn: Turn, truth: Truth): Promise<void> {
    const cfg = loadSizeAdvice(turn.req.binding.packId);
    if (cfg.measures.length === 0 || cfg.rows.length === 0) return;
    const source = turn.router?.entities.sizeSource ?? "";
    if (source === "tag" || source === "bare_tag") return;
    const lines = this.customerSessionTexts(turn).slice(-(cfg.history > 0 ? cfg.history : 10));
    const reading = new MeasureReader(cfg).read(lines);
    if (Object.keys(reading.values).length === 0) return;
    const brand = this.focusBrand(turn, truth);
    const chart = await this.brandChart(turn, truth, brand);
    const anchor = truth.found.find((it) => it.ma === (truth.focus.product?.code ?? "")) ?? truth.found[0];
    const context = [...lines, truth.focus.product?.name ?? "", anchor?.ten ?? "", anchor?.nhom ?? "", turn.router?.entities.need ?? "", String(turn.analysis?.needBrief["sport"] ?? "")].join("\n");
    const hint = new SizeAdvisor(cfg).advise(reading, { context, brand, brandRows: chart?.rows ?? null });
    truth.size = { brand, chart, hint };
  }

  /**
   * 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): the consultation profile of the turn, read from the ONE session
   * (customer lines for what is known, page lines for what was already asked); `null` when the industry has none.
   */
  private consultOf(turn: Turn, truth: Truth, kit: Stage3Kit): ConsultVerdict | null {
    const cfg = loadConsultProfile(turn.req.binding.packId);
    if (cfg.needs.length === 0) return null;
    const customerLines = this.customerSessionTexts(turn);
    const pageLines = this.sessionLines(turn).filter((t) => t.role !== "customer").map((t) => t.text);
    // The verdict goes to the dossier (`suThat.hoSoTuVan`), not to the step list.
    return new ConsultProfiler(cfg).assess({
      customerLines, pageLines, named: this.namedItem(turn, truth, kit, customerLines),
      analysis: turn.analysis?.needBrief ?? null, groupAliases: kit.scorer.cfg.groups.aliases
    });
  }

  /**
   * The customer named an item: a code, a line of the industry, a sure catalog match, a matched photo, a card replied to —
   * this message, or earlier this session while that item is still the one talked about and nothing else is asked for.
   */
  private namedItem(turn: Turn, truth: Truth, kit: Stage3Kit, customerLines: readonly string[]): boolean {
    if (truth.group?.question === true) return false;
    // The CUSTOMER's words name it (LLM#1's own reading of a product is not the customer naming one).
    const e = turn.router?.entities;
    const res = truth.resolution;
    const sure = res !== null && res.status === "single_match" && !res.needVerify && (e?.productName ?? "") !== "";
    if ((e?.productCode ?? "") !== "" || sure || (turn.photos?.chot?.ket === "tu_tin" && !turn.photos.thamChieu) || turn.ctx.focusedProduct?.by === "reply_to") return true;
    if (findLine(turn.text, kit.lines) !== null) return true;
    // A follow-up ("size 42"): the item in focus is one the customer named earlier this session, and this message asks for no other.
    const focus = truth.focus.product;
    if (focus === null || focus === undefined) return false;
    if (packRegexOf(loadReplyGateConfig(turn.req.binding.packId).evidence.wantsDifferent)?.test(normalize(turn.text)) === true) return false;
    const said = normalize(customerLines.join(" \n "));
    const focusLine = findLine(focus.name ?? "", kit.lines);
    return ((focus.code ?? "") !== "" && said.includes(normalize(focus.code ?? "")))
      || (focusLine !== null && customerLines.some((l) => findLine(l, kit.lines)?.id === focusLine.id));
  }

  /** PHO_THONG (an everyday need → the everyday search by purpose) and HO_SO_TU_VAN (the rest of the verdict). */
  private consultFacts(turn: Turn, truth: Truth, size: string): Pick<TurnFacts, "everyday" | "consult"> {
    const v = truth.consult ?? null;
    if (v === null) return {};
    if (v.status === "pho-thong" && v.need !== null && v.need.purpose !== "") {
      const gender = normalize(turn.router?.entities.gender ?? "");
      return { everyday: { purpose: v.need.purpose, ...(size !== "" ? { variant: size } : {}), ...(gender === "nu" || gender === "nam" ? { gender } : {}) } };
    }
    if (v.status === "chua-ro") return {};
    const cfg = loadConsultProfile(turn.req.binding.packId);
    const notAsked = cfg.needs.filter((n) => n.kind === "chuyen-mon").flatMap((n) => n.fields.map((f) => f.name));
    return { consult: { ...v, notAsked: [...new Set(notAsked)] } };
  }

  /**
   * 05/10/2026 (phiếu Desk 22/09 "size 2x trần là cm tem"): what the tag reading the stock was looked up with
   * ("25cm") comes to. In order: the label the landing converted it to on an item (`quy_doi`, the item named first);
   * else the brand's own chart (`variant.brandChart`, the tag is its `link`); else — the brand has no chart, or no
   * brand is known — the industry table's label as a GENERAL conversion (the note says so), looked up by it.
   * The query carries the settled label from here on (links, notes, stock facts).
   */
  private async settleTagSize(turn: Turn, query: CatalogQuery, t: { tem: string; asked: string; net: string; relook: ((size: string) => Promise<void>) | null }): Promise<void> {
    const truth = turn.truth!;
    const asked = t.asked.toLowerCase();
    const convertedOn = (it: FoundItem): string => it.cac_size.find((r) => String(r.quy_doi ?? "").trim().toLowerCase() === asked)?.size ?? "";
    const named = normalize(query.productCode);
    const hit = [...truth.found].sort((x, y) => Number(normalize(y.ma) === named) - Number(normalize(x.ma) === named)).find((it) => convertedOn(it) !== "");
    let settled: { size: string; brand: string; general: boolean };
    if (hit !== undefined) {
      settled = { size: convertedOn(hit), brand: String(hit.hang ?? "").trim().toLowerCase(), general: false };
    } else {
      let relooked = false;
      let brand = this.focusBrand(turn, truth);
      // Nothing came back and no brand is known: the net label finds the item — and with it, its brand.
      if (brand === "" && truth.found.length === 0 && t.relook !== null && t.net !== "") { await t.relook(t.net); relooked = true; brand = this.focusBrand(turn, truth); }
      const chart = brand !== "" ? await this.brandChart(turn, truth, brand) : null;
      if (chart !== null) truth.size = { brand, chart, hint: null };
      const cm = Number(t.tem);
      const row = chart?.rows.find((r) => r.link !== null && Math.abs(r.link - cm) < 0.01);
      if (row !== undefined) {
        settled = { size: row.label, brand, general: false };
      } else {
        settled = { size: t.net, brand, general: true };
        if (!relooked && t.relook !== null && t.net !== "") await t.relook(t.net);
      }
    }
    query.size = settled.size;
    truth.tagSize = { tem: t.tem, ...settled };
    turn.steps.push({ loai: "doc", ten: "Quy đổi theo bảng hãng", chiTiet: `${t.asked} → ${settled.size} (${settled.general ? "bảng chung của ngành — hãng chưa có bảng" : `bảng hãng ${settled.brand || "của món"}`})` });
  }

  /** The brand of the item in focus (the focus, the item found, the customer's words, LLM#1), lower case; "" when unknown. */
  private focusBrand(turn: Turn, truth: Truth | null | undefined): string {
    const anchor = truth?.found.find((it) => it.ma === (truth.focus.product?.code ?? "")) ?? truth?.found[0];
    const raw = truth?.focus.product?.brand || anchor?.hang || turn.router?.entities.brand || String(turn.analysis?.entities["brand"] ?? "");
    return String(raw ?? "").trim().toLowerCase();
  }

  /** The brand's own chart from the landing (`variant.brandChart`), once per turn; `null` = unknown brand, no chart, or an older landing. */
  private async brandChart(turn: Turn, truth: Truth | null | undefined, brand: string): Promise<BrandChart | null> {
    if (truth?.size !== undefined && truth.size.brand === brand) return truth.size.chart;
    if (brand === "" || !turn.tools.available().includes("variant.brandChart" as ToolName)) return null;
    const data = await this.lookup(turn, "variant.brandChart" as ToolName, { brand }, (d) => ({ found: (d as { found?: unknown }).found, rows: Array.isArray((d as { rows?: unknown }).rows) ? (d as { rows: unknown[] }).rows.length : 0 }));
    const out = data as ToolOutput<"variant.brandChart"> | null;
    if (out === null || out.found !== true || !Array.isArray(out.rows) || out.rows.length === 0) return null;
    return {
      rows: out.rows.map((r) => ({ label: String(r.label ?? ""), link: typeof r.link === "number" && Number.isFinite(r.link) ? r.link : null, alt: Object.fromEntries(Object.entries(r.alt ?? {}).map(([k, v]) => [k, String(v)])) })).filter((r) => r.label !== ""),
      womenDiffer: out.womenDiffer === true
    };
  }

  private sessionLines(turn: Turn): TurnContext["turns"] {
    // 05/10/2026: the ONE session of the turn (`sessionStartIndex`) — the frame and the focus use the same.
    return turn.ctx.turns.slice(sessionStartIndex(turn.ctx.turns.map((t) => t.at)));
  }

  private resolveFocus(turn: Turn, carried: ProductRef | null, nowIso: string): FocusResolution {
    const truth = turn.truth!;
    const session = this.sessionLines(turn);
    const photos = turn.photos;
    return this.focusResolver.resolve({
      now: nowIso,
      episode: turn.ctx.state.episode, ledger: turn.ctx.state.ledger,
      pageSentProduct: turn.ctx.focusedProduct,
      focusedProduct: turn.ctx.focusedProduct === null ? carried : null,
      analysisFocus: turn.analysis !== null && turn.analysis.focus.product !== "" ? { product: turn.analysis.focus.product, changed: turn.analysis.focus.changed } : null,
      resolution: truth.resolution,
      hasImage: turn.ctx.photos.length > 0,
      imageRecognised: photos !== null && (photos.chot !== null || photos.read.code !== "" || (photos.read.model !== "" && !photos.dongChuaChac)),
      sessionTexts: session.map((t) => t.text).filter((t) => t.trim() !== ""),
      sessionStartAt: session[0]?.at,
      pool: truth.found.map((it) => ({ code: it.ma, name: it.ten }))
    });
  }

  /** `order.lookup` + `customer.recognize` by the phone the customer typed — the VAN_DON / DON_DOI_SIZE blocks and the portrait line. */
  private async lookupOrders(turn: Turn, intent: string, exchangeOfOrder = false): Promise<void> {
    const { binding, conversationId } = turn.req;
    const truth = turn.truth!;
    const open = turn.tools.available();
    const engineIntent = detectIntent(binding.pack, turn.text);
    // An exchange question about an ORDER ("đơn của tôi đổi size 43 được không") needs the order too.
    const exchangeTalk = exchangeOfOrder || intent === "return_exchange" || engineIntent?.tools.includes("policy.get") === true;
    const orderTalk = engineIntent?.tools.includes("order.lookup") === true
      || (turn.photos?.maDon.length ?? 0) > 0
      || ["return_exchange", "shipping"].includes(intent)
      || (turn.analysis?.lookupCommands ?? []).some((c) => c.command === "check_order")
      || (exchangeTalk && /\bdon\b/.test(normalize(turn.text)))
      || exchangeOfOrder;
    if (!orderTalk) return;
    if ((turn.photos?.maDon.length ?? 0) > 0) truth.lines.push(`ANH DON HANG khach gui: ma ${turn.photos!.maDon.join(", ")} — doi chieu voi don tra duoc duoi day.`);
    const phone = turn.router?.entities.phone
      || turn.ctx.history.filter((h) => h.who === "khach").map((h) => PHONE_RE.exec(h.text.replace(/[.\s-]/g, ""))?.[1] ?? "").filter((p) => p !== "").at(-1)
      || "";
    if (phone === "" && !turn.ctx.dienThoaiDaCho) {
      // The exchange needs the order and the order needs the phone: ask for it, with the shop's own rule on changing a placed order.
      if (exchangeOfOrder) {
        const ask = this.routerFor(binding).fillHoiLai("xinSdtDon", { profile: turn.hoSo, site: binding.origin, tenShop: binding.shopName });
        const rule = turn.hoSo?.banHang.doiSizeDonDaDat?.trim() ?? "";
        if (ask !== null) truth.askOrderPhone = rule !== "" ? `${ask} ${rule}` : ask;
      }
      return;
    }
    if (open.includes("order.lookup")) {
      const data = await this.lookup(turn, "order.lookup", { conversationId: conversationId as ConversationId, phoneGivenInConversation: phone }, (d) => {
        const o = d as ToolOutput<"order.lookup">;
        return o.orders.map((x) => ({ maDon: x.orderId, trangThai: x.statusLabel ?? x.status, vanDon: x.tracking?.active === true }));
      }) as ToolOutput<"order.lookup"> | null;
      const orders = [...(data?.orders ?? [])].sort((l, r) => Date.parse(r.createdAt) - Date.parse(l.createdAt));
      truth.orders = orders;
      const order = orders[0];
      if (order !== undefined) {
        const status = order.statusLabel ?? order.status;
        const items = order.lines.map((l) => `${l.name}${l.variantLabel ? ` ${l.variantLabel}` : ""}${l.qty > 1 ? ` x${l.qty}` : ""}`).join("; ");
        truth.lines.push(`DON GAN NHAT CUA KHACH (tra theo SDT khach cho): ${order.orderId} — ${status}${items !== "" ? ` — ${items}` : ""}${orders.length > 1 ? ` (khach co ${orders.length} don)` : ""}. KHONG doc dia chi/SDT ra.`);
        if (order.tracking?.url && order.tracking.active) {
          truth.facts.tracking = { orderId: order.orderId, statusLabel: status, trackingCode: order.tracking.code, trackingUrl: order.tracking.url };
        }
        if (exchangeTalk && order.exchange !== undefined) {
          truth.facts.orderExchange = { orderId: order.orderId, allowed: order.exchange.allowed, note: [order.exchange.note ?? "", (order.exchange.openItems ?? []).join(", ")].filter((x) => x !== "").join(" — ") };
        }
      }
    }
    if (open.includes("customer.recognize")) {
      const portrait = await this.lookup(turn, "customer.recognize", { conversationId: conversationId as ConversationId, phoneGivenInConversation: phone }, (d) => d) as ToolOutput<"customer.recognize"> | null;
      if (portrait !== null && portrait.isReturning) {
        truth.portrait = portrait;
        const last = portrait.lastOrder ?? null;
        truth.lines.push(`CHAN DUNG KHACH (tu don cu, KHONG co SDT/dia chi): da mua ${portrait.orderCount} don${(portrait.usualSizes ?? []).length > 0 ? `, size hay mua ${portrait.usualSizes!.join(", ")}` : ""}${last ? `, don gan nhat: ${last.productName} size ${last.size} (${last.statusLabel ?? last.status})` : ""}${portrait.hasSavedAddress ? ", da co dia chi luu — co the HOI khach dung lai, KHONG doc dia chi" : ""}.`);
      }
    }
  }

  /** Prices and links the lookups proved: the agent may repeat them without being accused of inventing them. */
  private provenAmounts(turn: Turn): { knownAmounts: number[]; allowedHosts: string[] } {
    const amounts = new Set<number>();
    const hosts = new Set<string>();
    for (const it of turn.truth?.found ?? []) {
      numbersIn(it, amounts);
      for (const m of JSON.stringify(it).matchAll(/https?:\/\/[^\s"\\]+/g)) { const host = hostOf(m[0]); if (host) hosts.add(host); }
    }
    for (const o of turn.truth?.orders ?? []) { const host = hostOf(o.tracking?.url ?? ""); if (host) hosts.add(host); }
    return { knownAmounts: [...amounts], allowedHosts: [...hosts] };
  }

  /** The truth as the dossier keeps it. */
  private truthDossier(truth: Truth): TruthDossier {
    const r = truth.resolution;
    const order = truth.orders[0];
    return {
      ton: truth.stock,
      ...(r !== null ? { khop: { trangThai: r.status, lyDo: r.reason, canXacNhan: r.needVerify, ma: r.selected.map((c) => c.code) } } : {}),
      ...(truth.uncertain !== null ? { chuaChac: truth.uncertain.reason } : {}),
      ...(truth.focus.product !== null || truth.focus.dropped !== undefined ? { mauChinh: { ma: truth.focus.product?.code ?? "", ten: truth.focus.product?.name ?? "", nguon: truth.focus.source, ...(truth.focus.dropped !== undefined ? { boDi: truth.focus.dropped } : {}) } } : {}),
      bacThang: truth.level,
      ...(order !== undefined ? { donHang: { maDon: order.orderId, trangThai: order.statusLabel ?? order.status, vanDon: order.tracking?.active === true, ...(truth.facts.orderExchange !== undefined ? { doiSize: truth.facts.orderExchange.allowed } : {}) } } : {}),
      ...(truth.portrait !== null ? { khach: { daMua: truth.portrait.orderCount, sizeHayMua: truth.portrait.usualSizes ?? [] } } : {}),
      ...(truth.consult ? { hoSoTuVan: { trangThai: truth.consult.status, nhuCau: truth.consult.need?.name ?? "", daBiet: truth.consult.known.map((k) => `${k.name} = ${k.said}`), thieu: truth.consult.missing.map((m) => m.name), daHoi: truth.consult.asked.map((m) => m.name) } } : {})
    };
  }

  /**
   * The agent, as `tryAgent` ran it: eligible only when it is configured, the pack has a playbook,
   * the landing opens its tools and the quota allows. `null` = it did not run or failed (the record
   * is in the dossier either way); "superseded" = the customer wrote again during the retry pause.
   */
  private async runAgent(turn: Turn, knowledge: TrainingKnowledge | null, extraContext: string): Promise<{ outcome: AgentOutcome; toolCalls: RecordedToolCall[] } | "superseded" | null> {
    const { tenant, binding, conversationId } = turn.req;
    const agent = this.deps.agent;
    const profile = binding.pack.agent;
    if (turn.modelsOff) {
      turn.steps.push({ loai: "quyet-dinh", ten: "Không dùng mô hình", chiTiet: "Cầu dao cổng AI đang mở — kịch bản / máy luật trả lời." });
      return null;
    }
    if (agent === null || !agent.ready() || profile === undefined) {
      turn.steps.push({ loai: "quyet-dinh", ten: "Không dùng mô hình", chiTiet: agent === null || !agent.ready() ? "Xeon chưa cấu hình mô hình cho agent." : "Ngành này chưa có sổ tay agent." });
      return null;
    }
    let open = turn.tools.available();
    if (!AGENT_TOOLS.every((t) => open.includes(t)) && !binding.gateway.toolListConfirmed()) {
      await this.deps.refreshTools(tenant, binding);
      open = turn.tools.available();
    }
    if (!AGENT_TOOLS.every((t) => open.includes(t))) {
      const thieu = AGENT_TOOLS.filter((t) => !open.includes(t));
      this.deps.logger.warn(`[agent] shop "${tenant}": landing chua mo ${thieu.join(", ")} — soan nhap / may luat tra loi thay`);
      turn.steps.push({ loai: "quyet-dinh", ten: "Không dùng mô hình", chiTiet: `Landing chưa mở ${thieu.join(", ")} cho agent.` });
      return null;
    }
    turn.modelTried = true;
    const nowMs = this.deps.clock.now().getTime();
    if (turn.live && !this.deps.takeAgentTurn(tenant, nowMs)) {
      turn.steps.push({ loai: "quyet-dinh", ten: "Hết quota agent", chiTiet: "Lượt agent trong giờ đã hết — soạn nháp / máy luật trả lời." });
      return null;
    }

    // 02/10/2026: the agent sees the photos (the switch, a vision model, tier 1's words, a photo near).
    const vision = this.agentVision(turn);
    const turnInput: AgentTurnInput = {
      agent: profile, chung: binding.chung, hoSo: turn.hoSo, chinhSach: turn.shop?.chinhSach,
      nangLuc: systemCapabilities({
        open, visionReady: this.visionReady(), hoSo: turn.hoSo, chaoAi: turn.chaoAi, guiKem: open.includes("order.formLink") || turn.ctx.theDaGui.length > 0,
        photoLine: vision !== null ? binding.chung.xemAnh?.nangLuc : undefined,
        phieu: this.formThisTurn(turn)
      }),
      site: binding.origin, shopName: binding.shopName, history: turn.ctx.history,
      neverSay: applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam).identity.neverSay,
      extraContext,
      ...this.provenAmounts(turn),
      ...(vision !== null ? { xemAnh: { anh: vision.photos.map((p) => p.url) } } : {}),
      deadlineMs: Math.max(AGENT_MIN_DEADLINE_MS, this.budgetLeft(turn) - 5000)
    };
    if (vision !== null) turn.steps.push({ loai: "doc", ten: "Agent xem ảnh", chiTiet: `${vision.photos.length} ảnh đính kèm cho agent; được gọi ${LOOK_TOOL} xem ảnh cũ trong hội thoại / ảnh sản phẩm.` });
    const toolCalls: RecordedToolCall[] = [];
    const usage = { shop: tenant, agent: turn.req.usageAgent ?? "bot_l2", channel: turn.channel, conversationId };
    const runTurn = () => {
      // A whole-turn retry starts over: the first attempt's calls must not end up in the record,
      // or a replay would answer from a tool result this turn never actually saw.
      toolCalls.length = 0;
      return withUsage(usage, () => agent.run({
        ...turnInput,
        tools: recordingToolBox(this.agentToolBox(binding, turn.tools, knowledge, turn.shop), toolCalls, this.deps.clock),
        ...(vision !== null ? { vision } : {})
      }));
    };
    let outcome = await runTurn();
    // The gateway was down for the whole turn (every call retried and failed): wait, then run the
    // whole turn once more — a customer must not get "em nhờ nhân viên" because of a 20-second blip.
    if (!outcome.ok && outcome.modelDown && turn.isLatest() && this.deps.clock.now().getTime() - turn.startedMs < AGENT_RETRY_CUTOFF_MS && !(this.deps.breaker?.isOpen() ?? false)) {
      this.deps.logger.warn(`[agent] ${conversationId}: mo hinh khong tra loi (${outcome.viSao}) — cho ${AGENT_TURN_RETRY_MS / 1000}s roi chay lai ca luot`);
      await this.deps.sleep(AGENT_TURN_RETRY_MS);
      if (!turn.isLatest()) return "superseded";
      outcome = await runTurn();
    }
    // The agent ran: whatever happens next, this is the turn to be able to explain and re-run.
    turn.draft.agent = {
      model: outcome.modelAnswers.at(-1)?.model ?? "",
      goiNganh: binding.packId,
      luot: turnInput,
      systemPrompt: composeSystemPrompt(turnInput),
      traLoiModel: outcome.modelAnswers.map((a) => a.text),
      congCu: toolCalls,
      buoc: outcome.trace,
      soBuoc: outcome.steps,
      traLoi: outcome.ok ? outcome.reply : undefined,
      viSao: outcome.ok ? undefined : outcome.viSao
    };
    for (const t of outcome.trace) {
      if (t.tool) turn.steps.push({ loai: "cong-cu", ten: t.tool, chiTiet: `${JSON.stringify(t.args ?? {})}${t.result ? ` → ${t.result.slice(0, 300)}` : ""}` });
      else if (String(t.error ?? "").startsWith("chan:")) turn.steps.push({ loai: "chan", ten: "Câu bị chặn", chiTiet: String(t.error ?? "") });
      else turn.steps.push({ loai: "loi", ten: "Lỗi", chiTiet: String(t.error ?? "") });
    }
    if (!outcome.ok) {
      this.deps.logger.warn(`[agent] ${conversationId}: khong dung duoc (${outcome.viSao}) — soan nhap / may luat tra loi`);
      turn.steps.push({ loai: "loi", ten: "Agent không viết được", chiTiet: `${outcome.viSao} — soạn nháp / máy luật thay.` });
    }
    return { outcome, toolCalls };
  }

  /**
   * LLM#3 from the facts already in hand: the lookups the agent made before it gave up, the shop's
   * policy, the notes. Its reply passes the SAME review as the agent's (no invented price, no
   * foreign link, no banned phrase) — a safety net must not be a hole in the fence.
   */
  private async runDraft(turn: Turn, toolCalls: readonly RecordedToolCall[], notes: readonly string[]): Promise<{ reply: string; needsHuman: boolean; reason: string } | "superseded" | null> {
    const writer = this.deps.writer;
    if (turn.modelsOff || writer === null || !writer.ready() || turn.router === null) return null;
    const { tenant, binding, conversationId } = turn.req;
    turn.modelTried = true;
    const knownAmounts = new Set<number>();
    const allowedHosts = new Set<string>([hostOf(binding.origin)].filter(Boolean));
    const catalog: Record<string, unknown>[] = [];
    for (const call of toolCalls) {
      if (call.ten !== "findStock" || !Array.isArray(call.ketQua)) continue;
      numbersIn(call.ketQua, knownAmounts);
      for (const m of JSON.stringify(call.ketQua).matchAll(/https?:\/\/[^\s"\\]+/g)) { const host = hostOf(m[0]); if (host) allowedHosts.add(host); }
      for (const item of call.ketQua as { ma?: unknown; ten?: unknown; loai?: unknown; link?: unknown; cac_size?: { size?: unknown; gia?: unknown }[] }[]) {
        catalog.push({
          code: String(item.ma ?? ""), name: String(item.ten ?? ""), source: String(item.loai ?? ""), link: String(item.link ?? ""),
          price: priceOf({ ma: "", ten: "", cac_size: (item.cac_size ?? []) as FoundItem["cac_size"] }), sizes: (item.cac_size ?? []).map((s) => String(s.size ?? ""))
        });
      }
    }
    const policy = await this.policyOf(turn);
    numbersIn(policy, knownAmounts);
    const truth = turn.truth;
    const selected = (truth?.resolution?.selected ?? []).map((c) => ({ code: c.code, name: c.name, brand: c.brand, source: c.source, price: c.price, sizes: c.sizes.map((r) => r.size) }));
    const facts: DraftFacts = {
      catalog: selected.length > 0 ? selected : catalog, policy, notes,
      ...(truth?.stock ? { stockFacts: truth.stock as unknown as Record<string, unknown> } : {}),
      ...(truth?.level ? { stockCascade: { resolvedLevel: truth.level } } : {}),
      ...(truth && truth.orders.length > 0 ? { lookupResults: truth.orders.map((o) => ({ command: "check_order", orderId: o.orderId, status: o.statusLabel ?? o.status, tracking: o.tracking?.url ?? "" })) } : {}),
      ...(truth?.portrait ? { customerPortrait: truth.lines.find((l) => l.startsWith("CHAN DUNG KHACH")) } : {}),
      imageProducts: turn.photos?.chot?.ket === "tu_tin" && !turn.photos.thamChieu ? [{ code: turn.photos.chot.ma, name: turn.photos.chot.ten }] : []
    };
    for (const it of truth?.found ?? []) numbersIn(it, knownAmounts);
    const nowIso = this.deps.clock.now().toISOString();
    const budget = Math.max(DRAFT_MIN_BUDGET_MS, Math.min(DRAFT_TIMEOUT_MS, this.budgetLeft(turn)));
    const out = await writer.draft({
      turn: turn.ctx, intent: turn.router.intent.intent, analysis: turn.analysis,
      entities: entityRecord(turn.router.entities),
      frameText: turn.ctx.frame !== null ? turn.contexts.describeFrame(turn.ctx.frame) : "",
      memoryText: turn.contexts.renderMemory(turn.ctx.state, nowIso),
      stage: turn.ctx.state.episode?.stage,
      facts, text: loadDraftText(binding.packId), examples: loadHumanExamples(binding.packId),
      // 05/10/2026 (phiếu Desk nhóm nhu cầu): the situations only tier 1 knows — an item named, an everyday need.
      extraTags: [
        ...(truth?.consult?.status === "dich-danh" ? ["dich_danh"] : truth?.consult?.status === "pho-thong" ? ["pho_thong"] : []),
        // 05/10/2026 (phiếu Desk "khách mặc cả"): the one bargaining reader of tier 1 (the gate's), not a regex of LLM#3's own.
        ...(bargainSaid(gateNormalize(turn.text), loadReplyGateConfig(binding.packId)) ? ["mac_ca"] : [])
      ],
      site: binding.origin, shopName: binding.shopName, hoSo: turn.hoSo,
      usage: { shop: tenant, channel: turn.channel, conversationId }, nowIso
    }, budget);
    if (!out.ok) {
      turn.draft.nhap = { model: "", yDinh: turn.router.intent.intent, viSao: out.viSao, tho: out.raw };
      this.deps.logger.warn(`[soan-nhap] ${conversationId}: khong dung duoc (${out.viSao}) — may luat tra loi`);
      turn.steps.push({ loai: "loi", ten: "Soạn nháp (LLM#3) không viết được", chiTiet: `${out.viSao} — máy luật thay.` });
      return null;
    }
    const identity = applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam).identity;
    const budgetAmounts = turn.ctx.history.filter((line) => line.who === "khach").flatMap((line) => moneyAmounts(line.text));
    const blocked = reviewReply({ reply: out.reply, knownAmounts, budgetAmounts, allowedHosts, neverSay: identity.neverSay });
    turn.draft.nhap = { model: out.model ?? "", yDinh: turn.router.intent.intent, traLoi: out.reply, canNguoi: out.needsHuman, lyDo: out.reason, tho: out.raw, ...(blocked ? { viSao: `chan: ${blocked}` } : {}) };
    if (blocked) {
      this.deps.logger.warn(`[soan-nhap] ${conversationId}: cau bi chan (${blocked}): ${redactPII(out.reply).slice(0, 300)} — may luat tra loi`);
      turn.steps.push({ loai: "chan", ten: "Câu nháp bị chặn", chiTiet: `chan: ${blocked}` });
      return null;
    }
    if (!turn.isLatest()) return "superseded";
    return { reply: out.reply, needsHuman: out.needsHuman, reason: out.reason };
  }

  /** The deterministic engine, last net. It writes its own memory; the dossier keeps both states. */
  private async engineTurn(turn: Turn): Promise<TurnOutcome> {
    const { tenant, binding, conversationId, message } = turn.req;
    const state: { vao: unknown; ra: unknown } = { vao: null, ra: null };
    const watchedMemory: MemoryPort = {
      load: async (t, id) => { const loaded = await turn.memory.load(t, id); state.vao = loaded; return loaded; },
      save: async (s) => { state.ra = s; await turn.memory.save(s); }
    };
    const engine = new TurnEngine(applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam), {
      tools: turn.tools, catalog: binding.gateway.catalog, memory: watchedMemory, clock: this.deps.clock
    });
    const result = await engine.handle({
      tenant: tenant as TenantId,
      conversationId: conversationId as ConversationId,
      text: turn.text,
      imageCount: Number(message.soAnh || 0),
      at: String(message.luc || this.deps.clock.now().toISOString()),
      intentHint: turn.router?.intent.intent,
      knownNeed: knownNeedOf(turn.analysis ?? null, turn.ctx.state)
    });
    turn.engine = result;
    turn.draft.duongDi = "may-luat";
    turn.draft.mayLuat = {
      trangThaiVao: state.vao,
      trangThaiRa: state.ra ?? result.state ?? null,
      hanhDong: result.action,
      maYDinh: result.intentId ?? null,
      maHang: result.itemCode ?? undefined,
      cong: [...(result.gates ?? [])],
      traLoi: result.reply
    };
    for (const fact of result.facts) turn.steps.push({ loai: "cong-cu", ten: fact.source, chiTiet: fact.text.slice(0, 300) });
    if (turn.modelTried) this.deps.logger.warn(`[bo-nao] ${conversationId}: mo hinh khong tra loi duoc — may luat tra loi`);

    if (!turn.isLatest()) return this.outcome(SUPERSEDED, { reply: "", source: "", action: "", needsHuman: false, reason: "Khách nhắn thêm trong lúc soạn.", steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: result });
    // A model was tried and could not answer, and the engine did not understand either (no intent),
    // or hands over SILENTLY: the customer must hear something, and the shop must be told.
    if (turn.modelTried && (result.intentId === null || result.action === "handoff")) {
      return this.handOverToPerson(turn, `agent khong tra loi duoc, ${result.handoffReason ?? "may luat khong hieu cau"}`, "may-luat");
    }
    const engineReason = result.action === "handoff"
      ? result.handoffReason ?? String((result.gates ?? []).find((g) => g.action === "handoff" || g.action === "block")?.reason || "bot khong chac, chuyen nguoi that")
      : result.intentId ? `Máy luật nhận ý "${result.intentId}".` : "Máy luật chưa hiểu câu này.";
    // The engine's handoff is a DELIBERATE non-answer: a human beats a wrong reply. Logged, and the
    // merchant is told there is work waiting.
    if (result.action === "handoff") {
      this.deps.logger.info(`[bo-nao] chuyen nguoi that: ${tenant} / ${message.nguoi}`);
      if (turn.live) await this.notify(turn, engineReason);
      return this.outcome({ daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: result.reply }, { reply: "", source: "", action: "human_handoff", needsHuman: true, reason: engineReason, steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: result });
    }
    if (turn.live) await this.send(turn, result.reply, {}, { askBack: result.action === "ask_back" });
    return this.outcome(
      { daTraLoi: true, hanhDong: result.action, traLoi: redactPII(result.reply) },
      { reply: result.reply, source: "may-luat", action: result.action === "ask_back" ? "ask_clarification" : "script_reply", needsHuman: false, reason: engineReason, steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: result }
    );
  }

  // ---------------------------------------------------------------- endings

  /** Sends a reply (unless the turn is stale or the mode says not to), remembers it, tells the shop when a person is needed. */
  private async deliver(turn: Turn, what: {
    reply: string; source: TurnSource; action: string; hanhDong: "send" | "ask_back" | "agent"; reason: string;
    toolCalls?: RecordedToolCall[] | undefined; askBack?: boolean | undefined;
    /** The notice's reason when a person must take over after this reply. */
    handoff?: string | undefined;
    /** 05/10/2026: with the notice, ask the landing to pause the bot on this conversation until a person confirms. */
    pauseBot?: boolean | undefined;
    /** 05/10/2026: a person was called after the second ask-back — the ask-back count starts again (Desk v93e). */
    clearAskBack?: boolean | undefined;
  }): Promise<TurnOutcome> {
    const base = { reply: what.reply, source: what.source, action: what.action, needsHuman: what.handoff !== undefined, reason: what.reason, steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: null };
    if (!turn.isLatest()) {
      this.deps.logger.info(`[agent] ${turn.req.conversationId}: khach nhan them trong luc soan — bo cau nay, luot sau tra loi ca chum`);
      return this.outcome(SUPERSEDED, { ...base, reply: "", source: "", action: "", needsHuman: false, reason: "Khách nhắn thêm trong lúc soạn." });
    }
    // Giai đoạn 7: what goes with the reply — cards, the order form, the measuring guide, the greeting.
    const plan = this.planExtras(turn, what.reply, what.toolCalls ?? [], what.action);
    const extras = await this.extrasOf(turn, plan);
    // 05/10/2026 (phiếu Desk "thẻ đặt hàng không đi khi khách chốt hoặc giục"): a promise of the form stays only
    // when the landing really returned one for this turn (preview: when one is planned); a closing that needs a
    // person (form refused, running order, closing not declared) calls one.
    const formSent = turn.live ? extras["phieuDatHang"] !== undefined : plan.phieu !== undefined;
    const formPerson = plan.canNguoiChot !== "" || (plan.phieu !== undefined && !formSent);
    const promise = repairFormPromise(what.reply, loadReplyGateConfig(turn.req.binding.packId).contact, { formSent, personNeeded: plan.goiNguoi || formPerson, vars: this.noteVars(turn) });
    if (promise.cut) {
      turn.steps.push({ loai: "chan", ten: "Hứa phiếu", chiTiet: `Phiếu đặt hàng không đi lượt này — cắt câu hứa phiếu${formPerson ? ", gọi người" : ""}.` });
      what = { ...what, reply: promise.reply };
      base.reply = promise.reply;
    }
    if (turn.live) {
      await this.send(turn, what.reply, extras, { askBack: what.askBack === true, toolCalls: what.toolCalls ?? [] });
      await this.rememberTurn(turn, what.reply, what.toolCalls ?? [], what.askBack === true, what.clearAskBack === true);
      if (what.handoff !== undefined) await this.notify(turn, what.handoff, what.pauseBot === true);
      else if (plan.goiNguoi) await this.notify(turn, "khach chot don — shop chot qua nguoi phu trach");
      else if (formPerson && promise.callPerson) await this.notify(turn, `khach chot don — phieu khong di (${plan.canNguoiChot || "landing chan phieu"})`);
    }
    turn.steps.push({ loai: "quyet-dinh", ten: "Đề xuất phản hồi", chiTiet: what.reason });
    if (plan.lyDo.length > 0) turn.steps.push({ loai: "quyet-dinh", ten: "Gửi kèm", chiTiet: plan.lyDo.join("; ") });
    const result: InboundResult = what.handoff !== undefined && what.action === "human_handoff"
      ? { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: what.reply }
      : { daTraLoi: true, hanhDong: what.hanhDong, traLoi: redactPII(what.reply) };
    return this.outcome(result, base);
  }

  /**
   * Says one polite sentence to the customer AND tells the shop there is work waiting. Both halves
   * matter: a notice alone leaves the customer staring at silence, a sentence alone leaves them
   * waiting for a person nobody called. In "khong-gui" mode neither happens: the screen is told.
   */
  private async handOverToPerson(turn: Turn, lyDo: string, path: TurnPath): Promise<TurnOutcome> {
    const { binding } = turn.req;
    if (!turn.isLatest()) return this.outcome(SUPERSEDED, { reply: "", source: "", action: "", needsHuman: false, reason: "Khách nhắn thêm trong lúc soạn.", steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: turn.engine });
    turn.draft.duongDi = path;
    const identity = applyShopProfile(binding.pack, turn.hoSo).identity;
    const sentence = String(binding.pack.templates["handoff"] ?? "")
      .split("{shop}").join(identity.selfPronoun).split("{khach}").join(identity.customerPronoun);
    // 30/09/2026: a customer who is chasing us hears the apology first, in the shop's own pronouns —
    // not a bare "a person will answer", which reads as being brushed off a second time.
    const sorry = turn.router?.intent.matched.includes("impatience") === true
      ? this.routerFor(binding).fillHoiLai("xinLoiCho", { profile: turn.hoSo, site: binding.origin, tenShop: binding.shopName }) ?? ""
      : "";
    const polite = sorry !== "" ? `${sorry}${sentence.replace(/^Dạ\s+/, "")}`
      : sentence.charAt(0).toUpperCase() === sentence.charAt(0) ? sentence : `Dạ ${sentence}`;
    if (turn.live) {
      await this.send(turn, polite);
      await this.notify(turn, lyDo);
    }
    turn.steps.push({ loai: "quyet-dinh", ten: "Chuyển người thật", chiTiet: lyDo });
    return this.outcome(
      { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: polite },
      { reply: "", source: "", action: "human_handoff", needsHuman: true, reason: lyDo, steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: turn.engine }
    );
  }

  private outcome(result: InboundResult, rest: Omit<TurnOutcome, "result">): TurnOutcome {
    return { result, ...rest };
  }

  private async send(turn: Turn, reply: string, extras: Record<string, unknown> = {}, basis: { askBack?: boolean; toolCalls?: readonly RecordedToolCall[] } = {}): Promise<void> {
    const { binding, conversationId, message } = turn.req;
    // A comment is answered UNDER that comment: its id is the message id the landing sent in.
    const underComment = turn.channel === COMMENT_CHANNEL && message.maTin ? { traLoiTin: String(message.maTin) } : {};
    const pressed = message.tiepQuan === "nguoi-bam" ? { tiepQuan: true } : {};
    // 05/10/2026 (phiếu Desk "chống gửi trùng" / "tin khách đến trong lúc AI chạy" / "lượt trước đã gửi câu gì"):
    // the newest customer message this turn saw, and what the reply rests on — the landing's send door judges them.
    const judged = turn.channel !== COMMENT_CHANNEL && turn.seenUpTo !== "" ? { theoTin: turn.seenUpTo, bangChung: this.replyEvidence(turn, basis) } : {};
    let result: Awaited<ReturnType<typeof binding.gateway.sendReply>>;
    try {
      result = await binding.gateway.sendReply({ kenh: message.kenh, nguoi: message.nguoi, chu: reply, maHoiThoai: conversationId, ...underComment, ...extras, ...pressed, ...judged });
    } catch (error) {
      throw new ReplyNotSent(conversationId, error instanceof Error ? error.message : String(error));
    }
    // What really went: the landing answers `daGui` at the top (contract) or inside `ketQua` (older builds); a queued Zalo send must answer it too.
    const inner = result["ketQua"] as { daGui?: typeof result.daGui; chaoAi?: boolean; nhuongNguoi?: boolean; tinMoi?: boolean; daTraLoi?: boolean } | undefined;
    // 05/10/2026: a person wrote or typed after the customer while this turn was being written — the landing
    // sent nothing. The turn ends here as a yield: nothing remembered, nobody notified.
    if (result["nhuongNguoi"] === true || inner?.nhuongNguoi === true) throw new HumanTookOver(conversationId);
    // 05/10/2026: the customer wrote again (that message has its own turn), or this message was answered already.
    if (result["tinMoi"] === true || inner?.tinMoi === true) throw new ReplyRefused(conversationId, "tin-moi");
    if (result["daTraLoi"] === true || inner?.daTraLoi === true) throw new ReplyRefused(conversationId, "da-tra-loi");
    let daGui = result.daGui ?? inner?.daGui;
    // An older landing answers the greeting at the top only: fold it into `daGui` so the dossier reads one shape.
    const chaoAiTop = typeof result["chaoAi"] === "boolean" ? (result["chaoAi"] as boolean) : typeof inner?.chaoAi === "boolean" ? inner.chaoAi : undefined;
    if (daGui === undefined && chaoAiTop !== undefined) daGui = { the: [], boQua: [], chaoAi: chaoAiTop };
    if (turn.draft.guiKem !== undefined && daGui !== undefined) turn.draft.guiKem.daGui = daGui;
    else if (Object.keys(extras).length > 0) this.deps.logger.warn(`[gui-kem] ${conversationId}: landing khong tra daGui cho ${Object.keys(extras).join(", ")} — khong biet the/phieu/chao da di chua`);
  }

  /**
   * 05/10/2026 (phiếu Desk "thẻ đặt hàng không đi"): the agent is told, before it writes, whether the order
   * form goes with this turn — the same dispatcher decision the delivery takes (the item part does not
   * depend on the reply). `undefined` = the customer is not closing. The dossier's plan is left untouched.
   */
  private formThisTurn(turn: Turn): "se-gui" | "khong-gui" | undefined {
    const kept = turn.draft.guiKem;
    const plan = this.planExtras(turn, "", []);
    turn.draft.guiKem = kept;
    if (!plan.chot) return undefined;
    return plan.phieu !== undefined ? "se-gui" : "khong-gui";
  }

  /** `{khach}` / `{Khach}` / `{shop}` / `{tenNguoiPhuTrach}` of this shop, for a note added after the gate. */
  private noteVars(turn: Turn): Record<string, string> {
    const identity = applyShopProfile(turn.req.binding.pack, turn.hoSo).identity;
    const khach = identity.customerPronoun.trim() || "mình";
    return {
      khach, Khach: khach.charAt(0).toUpperCase() + khach.slice(1), shop: identity.selfPronoun.trim() || "em",
      tenNguoiPhuTrach: String(turn.hoSo?.tenNguoiPhuTrach ?? "").trim() || "người phụ trách"
    };
  }

  /**
   * 05/10/2026: what a reply rests on, for the landing's send door. WEAK = it asks the customer back, or the
   * customer sent a photo and no product came of it — only a weak reply may later be corrected, once, by a turn
   * that read more photos or found the product.
   */
  private replyEvidence(turn: Turn, basis: { askBack?: boolean; toolCalls?: readonly RecordedToolCall[] }): { yeu: boolean; soAnh: number; suThat: boolean } {
    const toolFound = (basis.toolCalls ?? []).some((c) => c.ten === "findStock" && Array.isArray(c.ketQua) && c.ketQua.length > 0);
    const suThat = (turn.truth?.found.length ?? 0) > 0 || toolFound || (turn.photos?.read.code ?? "") !== "";
    // 05/10/2026: only photos a model really read are evidence (a failed look is not a photo "seen").
    const soAnh = turn.photos?.ok === true ? turn.photos.looks.filter((l) => l.docDuoc === true).length : 0;
    return { yeu: basis.askBack === true || (turn.ctx.photos.length > 0 && !suThat), soAnh, suThat };
  }

  // ---------------------------------------------------------------- stage 6 and Giai đoạn 7

  /** What the models may still spend of the turn's budget. */
  private budgetLeft(turn: Turn): number {
    const forgiven = Math.max(0, turn.analysisMs - ANALYSIS_BUDGET_CAP_MS);
    return Math.max(0, TURN_BUDGET_MS - (this.deps.clock.now().getTime() - turn.startedMs) + forgiven);
  }

  /** The policy text, read once per turn. */
  private async policyOf(turn: Turn): Promise<string> {
    if (turn.policy === null) turn.policy = await this.policyText(turn.req.binding, turn.tools, turn.shop);
    return turn.policy;
  }

  /**
   * The gateway breaker: while open, one probe per minute; a probe that fails keeps the models off,
   * and the shop is told once per open period that the bot is on scripts and rules.
   */
  private async breakerOpen(turn: Turn): Promise<boolean> {
    const breaker = this.deps.breaker;
    if (breaker === null || !breaker.isOpen()) return false;
    const probe = this.deps.vision;
    if (probe !== null && probe.ready() && await breaker.probe(probe)) return false;
    const { tenant } = turn.req;
    const now = this.deps.clock.now().getTime();
    const last = this.breakerNotices.get(tenant) ?? 0;
    if (turn.live && now - last >= BREAKER_NOTICE_MS) {
      this.breakerNotices.set(tenant, now);
      this.deps.logger.warn(`[cau-dao] shop "${tenant}": cong AI dang loi, cau dao mo — bot chi tra loi bang kich ban / may luat, da bao shop`);
      await this.notify(turn, "cong AI dang loi (cau dao mo) — bot chi tra loi bang kich ban / may luat, nguoi truc theo doi giup");
    }
    turn.steps.push({ loai: "loi", ten: "Cầu dao cổng AI", chiTiet: "Đang mở — không gọi mô hình lượt này." });
    return true;
  }

  /**
   * Stage 6, the reply gate: the SECOND check of what the agent / LLM#3 wrote, with the turn's
   * sources of truth — a person's lines, the policy, the profile, the stock looked up. It repairs
   * (cuts a sentence, swaps a number, appends the tracking link) and says when a person must follow.
   */
  private async gateReply(turn: Turn, reply: string, needsHuman: boolean, toolCalls: readonly RecordedToolCall[]): Promise<{ reply: string; needsHuman: boolean; handoffReason: string }> {
    const { binding, tenant } = turn.req;
    const identity = applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam).identity;
    const truth = turn.truth;
    const found: FoundItem[] = [...(truth?.found ?? [])];
    for (const call of toolCalls) if (call.ten === "findStock" && Array.isArray(call.ketQua)) found.push(...(call.ketQua as FoundItem[]).filter((it) => it && typeof it.ma === "string"));
    const order = truth?.orders[0];
    // 05/10/2026: the running orders linked to the conversation — a tracking link only for a parcel on its
    // way; a cancelled / returned waybill leaves the order "not looked up" so "đang giao" is still cut.
    const running = runningOrders(turn.orders);
    const linkedTracking = running.find((o) => o.giaiDoan === "dang_giao" && !o.vanDonDong && (o.vanDon?.link ?? "") !== "");
    const linkedLooked = running.length > 0 && !running.some((o) => o.vanDonDong);
    // 05/10/2026 (phiếu Desk nhóm số đo): the variant map of the brand in focus — its own chart from the landing
    // (asked only when the draft pairs a label with a cm value or a UK label), the industry table otherwise.
    const sizeTable = loadSizeAdvice(binding.packId);
    const pairWords = loadReplyGateConfig(binding.packId).sizePair;
    const pairsNumbers = sizeTable.rows.length > 0 && [pairWords.unit, ...Object.values(pairWords.alt)].some((p) => { if (p === "") return false; try { return new RegExp(p, "iu").test(reply); } catch { return false; } });
    const sizeBrand = truth?.size?.brand ?? this.focusBrand(turn, truth);
    const sizeChart = pairsNumbers ? await this.brandChart(turn, truth, sizeBrand) : (truth?.size?.chart ?? null);
    const sources: GateSources = {
      shopSaid: turn.ctx.history.filter((h) => h.who === "nguoi").map((h) => h.text).join("\n"),
      customerSaid: turn.ctx.history.filter((h) => h.who === "khach").map((h) => h.text).join("\n"),
      customerMessage: turn.text,
      policy: await this.policyOf(turn),
      hoSo: turn.hoSo,
      found,
      // 05/10/2026: the stock tool's answers IN WORDS ("HET SIZE …: size dang con …") list labels too.
      toolText: toolCalls.filter((c) => c.ten === "findStock" && typeof c.ketQua === "string").map((c) => String(c.ketQua)).join("\n"),
      stockFacts: truth?.stock ?? null,
      lookups: {
        orderLooked: (truth?.lookups ?? []).some((l) => l.ten === "order.lookup" && l.loi === undefined) || linkedLooked,
        tracking: order?.tracking?.url && order.tracking.active ? { url: order.tracking.url, code: order.tracking.code, statusLabel: order.statusLabel ?? order.status }
          : linkedTracking !== undefined ? { url: linkedTracking.vanDon!.link!, code: linkedTracking.vanDon!.ma } : null,
        exchange: order?.exchange ? { allowed: order.exchange.allowed } : null
      },
      // What the bot may recommend: the pipeline's candidates AND what the agent's own finder calls returned this turn.
      adviceCandidates: [
        ...(truth?.resolution?.selected ?? []).map((c) => ({ code: c.code, name: c.name, price: c.price || undefined, link: c.item.link })),
        ...found.filter((it) => !(truth?.resolution?.selected ?? []).some((c) => c.code === it.ma)).map((it) => ({ code: it.ma, name: it.ten, price: priceOf(it) || undefined, link: it.link }))
      ],
      links: { ...(truth?.stock?.filterLink ? { filterLink: truth.stock.filterLink } : {}) },
      currentShoe: turn.analysis !== null ? String(turn.analysis.needBrief["currentShoe"] ?? "") || undefined : undefined,
      pronoun: identity.customerPronoun,
      uncertainProduct: truth?.uncertain !== null && truth?.uncertain !== undefined,
      moneyContext: { deposit: undefined },
      hasImages: turn.ctx.photos.length > 0,
      // 05/10/2026 (phiếu Desk "gửi ảnh rồi hỏi"): a photo within the fresh window — asking for "a photo" again is wrong.
      photoSent: turn.ctx.photoEvidence || hasRecentImageEvidence(turn.ctx.state, this.deps.clock.now()),
      // The cards that will go with this reply, planned on the draft as written (re-planned on the repaired one at delivery).
      cardsSent: (turn.req.binding.gateway.tools.available().includes("order.formLink") || turn.ctx.theDaGui.length > 0) && this.planExtras(turn, reply, toolCalls).theSanPham.length > 0,
      closing: turn.router?.intent.intent === "place_order",
      site: binding.origin, tenShop: binding.shopName,
      sizeChart: loadEntityConfig(binding.packId).sizeChart,
      runningOrders: running.map((o) => ({ maDon: o.maDon, giaiDoan: o.giaiDoan, taoLuc: o.taoLuc, mon: o.mon.map((m) => ({ ma: m.ma, ten: m.ten, size: m.size })) })),
      customerLines: turn.ctx.history.filter((h) => h.who === "khach").map((h) => ({ text: h.text, at: h.at ?? "" })),
      focusCode: truth?.focus.product?.code ?? "",
      // The only data that the customer paid: an order certainly theirs with a paid amount (never the bot's words).
      paidEvidence: running.some((o) => Number(o.tien.daTra) > 0) || (truth?.orders ?? []).some((o) => Number(o.money?.paid) > 0),
      // 05/10/2026 (phiếu Desk "khẳng định đúng là mẫu từ ảnh khách"): a customer photo in play — this turn's or
      // one of the last half-hour still in the transcript; a code PRINTED on it; the code it was matched to.
      photoContext: turn.ctx.photos.length > 0 || turn.ctx.history.some((h) => h.who === "khach" && (h.imageUrls?.length ?? 0) > 0),
      photoCodesRead: turn.photos?.read.code ? [turn.photos.read.code] : [],
      photoCodes: turn.photos?.chot?.ket === "tu_tin" ? [turn.photos.chot.ma] : [],
      // 05/10/2026 (phiếu Desk "cổng đè câu agent bằng tồn mẫu khác"): the industry's brands, to tell which item a stock sentence names.
      brandWords: binding.pack.lexicon.brands,
      // 05/10/2026 (phiếu Desk "chống thúc ép chốt"): the router's / the model's reading of a buying step.
      buyingSignals: (turn.router?.entities.closingSignals.length ?? 0) > 0 || turn.analysis?.needBrief["readyToBuy"] === true,
      // 05/10/2026 (phiếu Desk nhóm số đo): what tier 1 read from the customer's measurements; the brand's variant map.
      sizeHint: truth?.size?.hint ?? null,
      variantRows: pairsNumbers ? new SizeAdvisor(sizeTable).variantRows(sizeBrand, sizeChart?.rows ?? null) : [],
      variantBrand: sizeBrand,
      variantWomenDiffer: sizeChart?.womenDiffer === true,
      pageSaid: turn.ctx.history.filter((h) => h.who !== "khach").map((h) => h.text).join("\n"),
      // 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): the questions the consultation profile says not to ask this turn.
      consultNoAsk: truth?.consult?.noAsk ?? []
    };
    const out = new ReplyGate(loadReplyGateConfig(binding.packId)).run(reply, sources, { needsHuman });
    const mask = (text: string): string => text.replace(/\d{9,}/g, (d) => `${d.slice(0, 2)}***${d.slice(-2)}`);
    turn.draft.cong = { goc: mask(reply), sua: mask(out.reply), dauVet: out.trace, canNguoi: out.needsHuman, lyDo: out.handoffReason };
    if (out.trace.length > 0) {
      turn.steps.push({ loai: "chan", ten: "Cổng soát", chiTiet: `${out.trace.join(" › ")}${out.needsHuman ? ` — cần người (${out.handoffReason})` : ""}` });
      // 05/10/2026: when the gate CHANGED the draft, the agent's own sentence goes to the log too (Desk trace) — a
      // wrong repair can then be told from a wrong draft without opening the dossier.
      const changed = out.reply !== reply ? ` — câu gốc: ${mask(reply).replace(/\s+/g, " ").slice(0, 300)}` : "";
      this.deps.logger.info(`[cong-soat] ${tenant}/${turn.req.conversationId}: ${out.trace.join(" › ")}${changed}`);
    }
    return { reply: out.reply, needsHuman: out.needsHuman, handoffReason: out.handoffReason };
  }

  /** LLM#2: the scorer's one weak guess is confirmed, denied, or left to the focus / the uncertain gate. */
  private async verifyGuess(turn: Turn, carried: ProductRef | null): Promise<void> {
    const verifier = this.deps.verifier;
    const truth = turn.truth!;
    const resolution = truth.resolution!;
    if (turn.modelsOff || verifier === null || !verifier.ready()) return;
    const { binding, tenant, conversationId } = turn.req;
    const kit = this.kitFor(binding);
    const candidates = kit.scorer.retrieve(truth.found, { ...resolution.query }).map((c) => ({ code: c.code, name: c.name, brand: c.brand }));
    const pool = candidates.length > 0 ? candidates : resolution.selected.map((c) => ({ code: c.code, name: c.name, brand: c.brand }));
    const out = await verifier.verify({
      candidates: pool, history: turn.ctx.history, message: turn.text, text: loadCatalogVerifyText(binding.packId),
      usage: { shop: tenant, channel: turn.channel, conversationId }
    }, Math.min(8000, this.budgetLeft(turn)));
    if (out === null) { truth.lines.push("LLM#2 khong tra loi — mau van CHUA CHAC."); return; }
    if (out.code !== "") {
      const pick = resolution.selected.find((c) => c.code === out.code) ?? kit.scorer.retrieve(truth.found, { ...resolution.query, productCode: out.code })[0];
      if (pick !== undefined) {
        truth.resolution = { ...resolution, status: "single_match", selected: [pick], needsClarification: false, needVerify: false, reason: "llm2_confirmed" };
        turn.steps.push({ loai: "quyet-dinh", ten: "Xác nhận mẫu (LLM#2)", chiTiet: `${pick.code} ${pick.name} — ${out.reason}` });
        return;
      }
    }
    // "None": the focus, when there is one, stays (Do Quan 24/08); otherwise the uncertain gate decides.
    truth.resolution = { ...resolution, selected: carried !== null ? resolution.selected : [], status: carried !== null ? resolution.status : "not_found", needVerify: carried === null ? false : resolution.needVerify, reason: "llm2_none" };
    turn.steps.push({ loai: "quyet-dinh", ten: "Xác nhận mẫu (LLM#2)", chiTiet: `không mã nào khớp — ${out.reason}` });
  }

  /** The dispatcher's plan for this reply (pure). */
  private planExtras(turn: Turn, reply: string, toolCalls: readonly RecordedToolCall[], action = ""): DispatchPlan {
    const { binding } = turn.req;
    const truth = turn.truth;
    // The codes the turn knows: the pipeline's lookups and the agent's own finder calls.
    const found: FoundItem[] = [...(truth?.found ?? [])];
    for (const call of toolCalls) if (call.ten === "findStock" && Array.isArray(call.ketQua)) found.push(...(call.ketQua as FoundItem[]).filter((it) => it && typeof it.ma === "string" && Array.isArray(it.cac_size)));
    const plan = this.dispatcher.plan({
      reply, found, stock: truth?.stock ?? null,
      theDaGui: turn.ctx.theDaGui, daChaoAi: turn.ctx.daChaoAi, firstReply: turn.chaoAi, handoff: action === "human_handoff",
      intent: turn.router?.intent.intent ?? "", closingSignals: turn.router?.entities.closingSignals ?? [],
      readyToBuy: turn.analysis?.needBrief["readyToBuy"] === true,
      focusCode: truth?.focus.product?.code ?? "", requestedSize: truth?.stock?.requestedSize ?? turn.router?.entities.size ?? "",
      hoSo: turn.hoSo, asksFootMeasure: loadIntentRules(binding.packId).reconcile.asksFootMeasure, site: binding.origin,
      sharedFilter: (codes) => this.sharedFilterOf(turn, found, codes),
      // 05/10/2026: a customer with a running order — no card / form for what is already in it, and a form
      // only for an item named in THIS message (never one carried over from the session).
      orderedCodes: [...orderedItemKeys(turn.orders)],
      namedThisTurn: this.namedThisTurn(turn),
      // 05/10/2026 (phiếu Desk "thẻ đặt hàng không đi"): several codes each with its own variant → one form, one line each.
      message: turn.text
    });
    turn.draft.guiKem = {
      the: plan.theSanPham.map((c) => c.ma), linkLoc: plan.linkLoc, ...(plan.phieu ? { phieu: { items: plan.phieu.items } } : {}),
      anhHuongDan: plan.anhHuongDan !== undefined, chaoAi: plan.chaoAi, goiNguoi: plan.goiNguoi, lyDo: plan.lyDo
    };
    return plan;
  }

  /**
   * A filter the codes really share: the same product line (by the industry's line aliases) on the
   * host the items' own links point to (an outside warehouse's site, not the landing, when the items
   * live there). The line families' link when one family holds them all. `undefined` = no real filter.
   */
  private sharedFilterOf(turn: Turn, found: readonly FoundItem[], codes: readonly string[]): string | undefined {
    const { binding } = turn.req;
    const kit = this.kitFor(binding);
    const items = codes.map((c) => found.find((it) => normalize(it.ma) === normalize(c))).filter((it): it is FoundItem => it !== undefined);
    if (items.length < codes.length || items.length === 0) return undefined;
    const lines = items.map((it) => findLine(it.ten, kit.lines));
    const first = lines[0];
    if (first === null || first === undefined || !lines.every((l) => l !== null && l.id === first.id)) {
      const family = (turn.truth?.facts.lineFamilies ?? []).find((f) => items.every((it) => normalize(it.ten).includes(normalize(f.name).split(" ").slice(-1)[0] ?? "\u0000")));
      return family?.url;
    }
    const hosts = new Set(items.map((it) => hostOf(it.link ?? "")).filter((h) => h !== ""));
    const origin = hosts.size === 1 ? `https://${[...hosts][0]}` : binding.origin;
    const size = turn.truth?.stock?.requestedSize || turn.router?.entities.size || "";
    const q = first.aliases?.[0] ?? first.name;
    return `${origin}/?q=${encodeURIComponent(q)}${size !== "" ? `&size=${encodeURIComponent(size)}` : ""}#products`;
  }

  /** The send-body extras of a plan; the order form is asked of the landing (live mode only). */
  private async extrasOf(turn: Turn, plan: DispatchPlan): Promise<Record<string, unknown>> {
    const { binding, conversationId } = turn.req;
    const extras: Record<string, unknown> = {};
    if (plan.theSanPham.length > 0) extras["theSanPham"] = plan.theSanPham;
    if (plan.linkLoc) extras["linkLoc"] = plan.linkLoc;
    if (plan.anhHuongDan) extras["anhHuongDan"] = plan.anhHuongDan;
    if (plan.chaoAi) extras["chaoAi"] = true;
    if (plan.phieu && turn.live && binding.gateway.tools.available().includes("order.formLink")) {
      const r = await binding.gateway.tools.call("order.formLink", { conversationId: conversationId as ConversationId, items: plan.phieu.items, dienSan: "chat" });
      const kem = turn.draft.guiKem;
      if (!r.ok) { if (kem?.phieu) kem.phieu.chan = r.error.message; }
      else if (r.data.chan !== undefined || r.data.url === "") { if (kem?.phieu) kem.phieu.chan = r.data.chan?.lyDo ?? "khong_co_link"; turn.truth?.lines.push(`PHIEU DAT HANG bi chan: ${r.data.chan?.lyDo ?? ""}.`); }
      else {
        const phieu: InboxOrderFormAttachment = { url: r.data.url, loiMoi: r.data.loiMoi, tieuDe: r.data.the?.tieuDe, phuDe: r.data.the?.phuDe, anh: r.data.the?.anh };
        extras["phieuDatHang"] = phieu;
        if (kem?.phieu) kem.phieu.url = r.data.url;
      }
    }
    return extras;
  }

  private async notify(turn: Turn, lyDo: string, pauseBot = false): Promise<void> {
    const { binding, conversationId, message } = turn.req;
    await binding.gateway.notifyHandoff({ kenh: message.kenh, nguoi: message.nguoi, maHoiThoai: conversationId, lyDo, tinCuoi: redactPII(turn.text), ...(pauseBot ? { dungBot: true } : {}) });
  }

  /** Writes the ledger, the episode and the photo label AFTER the reply went out. A memory that cannot be saved is logged, never fatal. */
  private async rememberTurn(turn: Turn, reply: string, toolCalls: readonly RecordedToolCall[], askBack: boolean, clearAskBack = false): Promise<void> {
    try {
      const truth = turn.truth;
      await turn.memory.save(this.remember(turn.contexts, turn.ctx, {
        text: turn.text, reply, toolCalls, photos: turn.photos, analysis: turn.analysis, askBack, ...(clearAskBack ? { clearAskBack } : {}),
        intentId: turn.router?.intent.intent, now: this.deps.clock.now().toISOString(),
        ...(truth !== null ? {
          focus: truth.focus.product,
          matched: truth.resolution?.status === "single_match" && truth.resolution.selected[0] !== undefined
            ? { item: { code: truth.resolution.selected[0].code, name: truth.resolution.selected[0].name, brand: truth.resolution.selected[0].brand, price: truth.resolution.selected[0].price || undefined }, reliable: !truth.resolution.needVerify, stock: truth.stock !== null && truth.stock.requestedSize !== "" ? { requestedSize: truth.stock.requestedSize, inStock: truth.stock.stock !== null } : undefined }
            : undefined,
          found: truth.found.map((it) => ({ code: it.ma, name: it.ten })),
          orders: truth.orders.map((o) => ({ id: o.orderId, status: o.statusLabel ?? o.status, tracking: o.tracking?.code, items: o.lines.map((l) => `${l.name} ${l.variantLabel}`.trim()) }))
        } : {})
      }));
    } catch (e) {
      this.deps.logger.warn(`[agent] ${turn.req.conversationId}: khong ghi duoc so hoi thoai: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * What the turn leaves in memory (Desk `updateLedger` + `episodeTracker.update` + the photo label):
   * the products the lookup returned and the reply named, the product the photo was matched to, the
   * customer's and the bot's lines, and LLM#1's summaries. The customer's words go through
   * `appendTurn` like the rule engine's turns, so `hasRecentImageEvidence` and the ask-back
   * counters keep working.
   */
  remember(contexts: TurnContextBuilder, ctx: TurnContext, turn: {
    text: string; reply: string; toolCalls: readonly RecordedToolCall[]; photos: PhotoReading | null; now: string;
    analysis?: ContextAnalysis | null | undefined; askBack?: boolean | undefined; intentId?: string | undefined;
    /** 05/10/2026: a person was called after the second ask-back — forget the ask-backs, or every later unclear message is a handoff (Desk v93e). */
    clearAskBack?: boolean | undefined;
    /** The focus the resolver settled on (stage 3); the page's card when absent. */
    focus?: ProductRef | null | undefined;
    /** The catalog resolver's single match, with the stock answer for the size asked. */
    matched?: TurnEvidence["matched"] | undefined;
    /** Items the lookups returned before the agent ran (beyond the agent's own tool calls). */
    found?: readonly ProductRef[] | undefined;
    orders?: TurnEvidence["orders"] | undefined;
  }): ConversationState {
    const found: ProductRef[] = [...(turn.found ?? [])];
    for (const call of turn.toolCalls) {
      if (call.ten !== "findStock" || !Array.isArray(call.ketQua)) continue;
      for (const item of call.ketQua as { ma?: unknown; ten?: unknown; cac_size?: { gia?: unknown }[] }[]) {
        const code = String(item.ma ?? "").trim();
        if (code === "") continue;
        const price = priceOf({ ma: "", ten: "", cac_size: (item.cac_size ?? []) as FoundItem["cac_size"] });
        found.push({ code, name: String(item.ten ?? ""), ...(Number.isFinite(price) && price > 0 ? { price } : {}) });
      }
    }
    const inReply = (p: ProductRef): boolean => p.code !== undefined && p.code !== "" && turn.reply.toUpperCase().includes(p.code.toUpperCase());
    const replied = found.filter(inReply);
    // 05/10/2026: a REFERENCE photo (what the customer uses now) is never the item in focus.
    const imageProducts: ProductRef[] = turn.photos?.chot?.ket === "tu_tin" && !turn.photos.thamChieu ? [{ code: turn.photos.chot.ma, name: turn.photos.chot.ten }] : [];
    const page: ProductRef | undefined = ctx.focusedProduct !== null ? { code: ctx.focusedProduct.code, name: ctx.focusedProduct.name } : undefined;
    const focused: ProductRef | undefined = turn.focus ? { code: turn.focus.code, name: turn.focus.name, brand: turn.focus.brand } : page;
    const top = turn.matched?.item ?? imageProducts[0] ?? focused ?? replied[0];
    const ledger = contexts.ledgerOf();
    const a = turn.analysis ?? null;
    const evidence: TurnEvidence = {
      now: turn.now,
      intentId: turn.intentId,
      size: ctx.frame?.answer === "size" ? ctx.frame.size : undefined,
      matched: turn.matched ?? (top !== undefined ? { item: top, reliable: true, fromImage: imageProducts.length > 0 } : undefined),
      imageProducts,
      repliedProducts: replied,
      pageProduct: page ?? focused,
      orders: turn.orders,
      customerMessage: turn.text,
      summary: a !== null ? (a.contextSummary || a.episodeSummary) : undefined,
      customerGoal: a !== null && a.customerGoal !== "" ? a.customerGoal : undefined,
      customerNeed: statedNeed(a) || undefined
    };
    const episodeTurn: EpisodeTurn = {
      now: turn.now, customerText: turn.text, intentId: turn.intentId,
      reliableTop: focused ?? replied[0], pageProduct: focused, imageProducts,
      pool: [...(ctx.state.ledger?.products ?? []).map((p) => ({ code: p.code, name: p.name })), ...found],
      aiSummary: a !== null ? (a.episodeSummary || a.contextSummary) : undefined,
      aiFocus: a !== null && a.focus.product !== "" ? { product: a.focus.product, changed: a.focus.changed, roles: a.focus.roles } : undefined
    };
    const episodes = contexts.episodesOf();
    const updated = episodes.update(ctx.state.episode, ctx.state.episodesPast, episodeTurn);
    const imageLabels = { ...(ctx.state.imageLabels ?? {}) };
    if (turn.photos !== null && ctx.photos.length > 0) {
      const recognised = ledger.recognizeImage({
        visionOk: turn.photos.ok,
        receiptByIntent: turn.photos.loai === "bien_lai",
        visibleTexts: turn.photos.bienLai ? [turn.photos.bienLai.text, turn.photos.bienLai.amount > 0 ? String(turn.photos.bienLai.amount) : ""] : undefined,
        match: turn.photos.thamChieu ? undefined : turn.photos.chot?.ket === "tu_tin" ? { action: "auto_match", primary: imageProducts[0] }
          : turn.photos.chot?.ket === "hoi_lai" ? { action: "ask_choose", selected: turn.photos.chot.luaChon.map((c) => ({ code: c.ma, name: c.ten })) }
          : undefined,
        // An unconfirmed line is a guess: never a name later turns would repeat as fact (01/10/2026)…
        ocr: turn.photos.read.code !== "" || (turn.photos.read.model !== "" && !turn.photos.dongChuaChac) ? { brand: turn.photos.read.brand, code: turn.photos.read.code, name: turn.photos.dongChuaChac ? "" : turn.photos.read.model } : undefined,
        // …but kept AS a guess (02/10/2026): "not read" left a later "cứ đoán đi" with nothing to go on.
        guess: turn.photos.dongChuaChac && turn.photos.read.model !== "" ? {
          brand: normalize(turn.photos.read.model).startsWith(normalize(turn.photos.read.brand)) ? "" : turn.photos.read.brand,
          name: turn.photos.read.model
        } : undefined
      });
      const label = recognised !== null ? ledger.imageLabel(recognised) : "";
      // 05/10/2026 (phiếu Desk "kết quả phân tích mù ảnh được dùng lại"): a labelled message is skipped by later turns
      // as "already read", so only a message EVERY photo of which a model really read gets the label — one photo the
      // reading missed (download / model failure, beyond the per-turn cap) leaves the message to be read again.
      const read = new Set((turn.photos.looks ?? []).filter((l) => l.docDuoc === true).map((l) => l.url));
      const byMessage = new Map<string, string[]>();
      for (const photo of ctx.photos) if (photo.maTin !== "") byMessage.set(photo.maTin, [...(byMessage.get(photo.maTin) ?? []), photo.url]);
      for (const [maTin, urls] of byMessage) if (label !== "" && urls.every((u) => read.has(u))) imageLabels[maTin] = label;
      // Forty labels are plenty: older photos have long since scrolled out of the transcript.
      for (const key of Object.keys(imageLabels).slice(0, Math.max(0, Object.keys(imageLabels).length - 40))) delete imageLabels[key];
    }
    const now = new Date(turn.now);
    let state = appendTurn(ctx.state, { role: "customer", text: turn.text, at: turn.now, imageCount: ctx.photos.length }, now);
    state = appendShopTurn(state, { role: "shop", text: turn.reply, at: turn.now });
    return {
      ...state,
      ledger: ledger.update(ctx.state.ledger, evidence),
      episode: updated.episode,
      episodesPast: updated.past,
      imageLabels,
      focusItemCode: updated.episode?.focus?.code || state.focusItemCode,
      // An ask-back is counted the way the engine counts its own, so `ask_back_once` still trips.
      ...(turn.askBack === true ? { lastAskBackAt: turn.now, askBackCount: (ctx.state.askBackCount ?? 0) + 1 } : {}),
      ...(turn.clearAskBack === true ? { lastAskBackAt: undefined, askBackCount: undefined } : {})
    };
  }

  // ---------------------------------------------------------------- what the models read

  /**
   * The tools the agent may call on this merchant's landing. Đ7: a shop that paused partner goods
   * ("Tạm dừng hàng đối tác") gets in-stock-only answers, whatever the model asked for.
   */
  agentToolBox(binding: MerchantBinding, tools: ToolPort, knowledge: TrainingKnowledge | null, shop: ShopProfileBundle | null = null): AgentToolBox {
    const open = tools.available();
    const ownStockOnly = knowledge?.cauHinh.tatHangDoiTac === true;
    return {
      findStock: async (args) => {
        // 05/10/2026: the industry's everyday words for the catalog's groups ride along.
        const withGroups = { ...this.groupWords(this.kitFor(binding)), ...args };
        const r = await tools.call("catalog.find", ownStockOnly ? { ...withGroups, chi_hang_san: true } : withGroups);
        return r.ok ? r.data.ketQua : `LOI tra kho: ${r.error.message}`;
      },
      policy: async () => this.policyText(binding, tools, shop),
      bankAccount: async () => {
        if (!open.includes("shop.bankAccount")) return { loi: "shop chua mo thong tin tai khoan" };
        const r = await tools.call("shop.bankAccount", {});
        return r.ok ? r.data : { loi: r.error.message };
      }
    };
  }

  /** What the shop taught the AI (Đ7), or `null` when the landing does not open the tool or fails. */
  async knowledgeFor(binding: MerchantBinding, tools: ToolPort, conversationId: string, text: string): Promise<TrainingKnowledge | null> {
    void binding;
    if (!tools.available().includes("training.knowledge")) return null;
    const r = await tools.call("training.knowledge", { q: text.slice(0, 300), conversationId });
    return r.ok ? r.data : null;
  }

  /**
   * The shop's policy from the landing: the three texts, the selling terms of the profile, and every
   * warehouse's own policy. NO fallback text (24/09/2026): before this, a shop that filled in nothing
   * had the bot quote the pack's sample policy — another shop's deposit and lead time.
   */
  async policyText(binding: MerchantBinding, tools: ToolPort, shop: ShopProfileBundle | null): Promise<string> {
    void binding;
    const parts: string[] = [];
    const texts = shop?.chinhSach ?? null;
    if (texts !== null) {
      for (const [key, title] of [["doiTra", "DOI TRA"], ["ship", "SHIP"], ["baoHanh", "BAO HANH"]] as const) {
        if (texts[key].trim() !== "") parts.push(`## ${title}\n${texts[key].trim()}`);
      }
    } else if (tools.available().includes("policy.get")) {
      for (const [topic, title] of [["doi-tra", "DOI TRA"], ["ship", "SHIP"], ["bao-hanh", "BAO HANH"]] as const) {
        const r = await tools.call("policy.get", { topic });
        if (r.ok && r.data.found) parts.push(`## ${title}\n${r.data.text}`);
      }
    }
    const hoSo = shop?.hoSo ?? null;
    if (hoSo !== null) {
      const terms: string[] = [];
      // 05/10/2026: no "shop sells made-to-order: yes / no" — that is the stock's kind, per warehouse. These
      // are the general order terms, for an order warehouse without a policy of its own; said only when set.
      const order = [hoSo.banHang.thoiGianOrder ? `thoi gian ${hoSo.banHang.thoiGianOrder}` : "", hoSo.banHang.tiLeCoc !== null ? `coc toi thieu ${hoSo.banHang.tiLeCoc}%` : ""].filter(Boolean);
      if (order.length > 0) terms.push(`Hang order (dieu kien chung, khi kho order khong khai chinh sach rieng): ${order.join("; ")}.`);
      if (hoSo.banHang.doiTraHangOrder) terms.push(`Doi tra hang order: ${hoSo.banHang.doiTraHangOrder}`);
      if (hoSo.banHang.codHangSan) terms.push(`Hang san: ${hoSo.banHang.codHangSan === "co" ? "COD duoc" : "khong COD, thanh toan truoc"}.`);
      if (hoSo.banHang.doiSizeDonDaDat) terms.push(`Doi size don da dat: ${hoSo.banHang.doiSizeDonDaDat}`);
      if (terms.length > 0) parts.push(`## DIEU KIEN BAN (ho so shop)\n${terms.join("\n")}`);
    }
    const kho = (shop?.kho ?? []).filter((k) => k.chinhSach.trim() !== "");
    if (kho.length > 0) parts.push(`## CHINH SACH THEO KHO\n${kho.map((k) => `- ${k.ten} (${k.loai === "ready" ? "hang san" : "hang order"}): ${k.chinhSach}`).join("\n")}`);
    return parts.length > 0 ? parts.join("\n\n") : "SHOP CHUA KHAI CHINH SACH. Khong duoc noi chinh sach; noi de nguoi phu trach tra loi.";
  }

  /** Tier 3 from the landing, or `null` when the landing does not open `shop.profile` (an older build). */
  async shopProfileFor(binding: MerchantBinding): Promise<ShopProfileBundle | null> {
    if (!binding.gateway.tools.available().includes("shop.profile" as ToolName)) return null;
    const r = await binding.gateway.tools.call("shop.profile" as ToolName, {} as never);
    if (!r.ok) { this.deps.logger.warn(`[bo-nao] khong doc duoc ho so shop: ${r.error.message}`); return null; }
    return readShopProfileBundle(r.data);
  }

  /** Whether a photo the customer sends is read this turn (a vision-capable model is configured). */
  visionReady(): boolean {
    return this.deps.vision !== null && this.deps.vision.ready();
  }

  /** The agent may see photos: the switch is on, a model reads pictures, and tier 1 has the words for it. */
  private agentSees(binding: MerchantBinding): boolean {
    return this.deps.agentSeesPhotos === true && this.visionReady() && binding.chung.xemAnh !== undefined;
  }

  /**
   * What the agent sees this turn (02/10/2026): the customer's fresh photos as the intake prepared them,
   * and a way to open one more — a photo the customer sent in the last half hour, or a product photo a
   * stock result showed. `null` = nothing to show (no photo anywhere near), or seeing is off.
   */
  private agentVision(turn: Turn): AgentVision | null {
    const { binding } = turn.req;
    if (!this.agentSees(binding)) return null;
    const fresh = (turn.photos?.looks ?? []).filter((l) => (l.xem ?? "") !== "").map((l) => ({ url: l.url, dataUrl: l.xem! }));
    const earlier = turn.ctx.history.some((line) => (line.imageUrls ?? []).length > 0);
    if (fresh.length === 0 && !earlier) return null;
    const intake = this.deps.intake;
    return {
      photos: fresh,
      // A product photo may be a path on the shop's own site ("assets/…", "/api/…"): resolved there.
      look: (url, kind) => {
        let absolute = url;
        if (!/^https?:\/\//i.test(url)) { try { absolute = new URL(url.startsWith("/") ? url : `/${url}`, binding.origin).toString(); } catch { return Promise.resolve(null); } }
        return intake.view(absolute, kind);
      }
    };
  }

  /** WHAT THE CUSTOMER'S PHOTOS ARE, for a caller outside a turn (the AI desk's image door): the intake with the industry's prompt. */
  async readPhotos(tenant: string, binding: MerchantBinding, message: { anh?: string[] | undefined; kenh?: string | undefined }, conversationId: string): Promise<PhotoReading | null> {
    return this.deps.intake.read({
      tenant, binding, photos: (message.anh ?? []).map((url) => ({ url })), kenh: message.kenh, conversationId, text: loadImageReadText(binding.packId),
      receiptTextPatterns: loadLedgerTexts().receiptTextPatterns
    });
  }

  /** One context builder per industry pack (its dialogue frames and note texts), built on first use. */
  turnContextFor(binding: MerchantBinding): TurnContextBuilder {
    const cached = this.turnContexts.get(binding.packId);
    if (cached !== undefined) return cached;
    const built = new TurnContextBuilder({ dialogue: loadDialogueConfig(binding.packId), ledgerTexts: loadLedgerTexts(), brands: binding.pack.lexicon.brands });
    this.turnContexts.set(binding.packId, built);
    return built;
  }

  /** One rule router per industry pack (its merged intent rules, entities and scripts), built on first use. */
  routerFor(binding: MerchantBinding): RuleRouter {
    const cached = this.routers.get(binding.packId);
    if (cached !== undefined) return cached;
    const built = ruleRouterFor(binding.packId);
    this.routers.set(binding.packId, built);
    return built;
  }
}

// ---------------------------------------------------------------- small helpers

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); } catch { return ""; }
}

/** Every number in a JSON-ish value, for the "price has a source" check (same rule as the agent's). */
function numbersIn(value: unknown, into: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) { into.add(value); return; }
  if (typeof value === "string") { for (const n of moneyAmounts(value)) into.add(n); return; }
  if (Array.isArray(value)) { for (const v of value) numbersIn(v, into); return; }
  if (value !== null && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, into);
}

/** A pack regex, or `null` when the pattern is empty or broken. */
function packRegexOf(pattern: string): RegExp | null {
  if (pattern === "") return null;
  try { return new RegExp(pattern); } catch { return null; }
}

/** The router's entities as the draft prompt shows them: only what was said. */
function entityRecord(entities: Entities): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (value === "" || value === 0 || (Array.isArray(value) && value.length === 0)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The `shop.profile` answer made safe (30/09/2026): landings of every build answer it, so the
 * profile goes through `readShopProfile` (an unanswered choice is "chua khai", never "khong") and a
 * warehouse whose kind is not "ready"/"order" is dropped rather than guessed.
 */
export function readShopProfileBundle(raw: unknown): ShopProfileBundle {
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const cs = o["chinhSach"] !== null && typeof o["chinhSach"] === "object" ? (o["chinhSach"] as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const kho: ShopProfileBundle["kho"] = [];
  for (const w of Array.isArray(o["kho"]) ? o["kho"] : []) {
    const k = w !== null && typeof w === "object" ? (w as Record<string, unknown>) : {};
    if (k["loai"] !== "ready" && k["loai"] !== "order") continue;
    kho.push({ ma: str(k["ma"]), ten: str(k["ten"]), loai: k["loai"], uuTien: Number(k["uuTien"]) || 0, chinhSach: str(k["chinhSach"]).trim() });
  }
  return { hoSo: readShopProfile(o["hoSo"]), chinhSach: { doiTra: str(cs["doiTra"]), ship: str(cs["ship"]), baoHanh: str(cs["baoHanh"]) }, kho };
}

/**
 * The need the customer described this turn, in the model's words; "" when they did not (30/09/2026).
 * `product_advice` is the PLATFORM's intent for "help me choose by what I need" (loi-chung), so this
 * holds for every industry: a greeting, a bare "size 42 còn không" or a named model is not a need.
 */
export function statedNeed(a: { intent: string; customerGoal: string; contextSummary: string } | null): string {
  if (a === null || a.intent !== "product_advice") return "";
  return (a.customerGoal || a.contextSummary).trim();
}

/** The need the engine must not ignore: this turn's, else the ledger's — only if said in THIS shopping episode. */
export function knownNeedOf(a: { intent: string; customerGoal: string; contextSummary: string } | null, state: { ledger?: { customerNeed?: string; customerNeedAt?: string } | undefined; episode?: { startedAt?: string } | null | undefined }): string {
  const now = statedNeed(a);
  if (now !== "") return now;
  const need = (state.ledger?.customerNeed ?? "").trim();
  const at = state.ledger?.customerNeedAt ?? "";
  const since = state.episode?.startedAt ?? "";
  if (need === "" || at === "") return "";
  return since === "" || at >= since ? need : "";
}
