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

import { TOOLS, type ConversationId, type InboxOrderFormAttachment, type OrderBrief, type ShopProfile, type TenantId, type ToolName, type ToolOutput } from "@sp/contract";
import {
  CatalogResolver, CatalogScorer, FactNoteComposer, FocusResolver, PaymentClaimKit, ReplyGate, TurnEngine, UncertainProductGate, appendShopTurn, appendTurn, applyShopProfile,
  buildStockFacts, catalogQueryOf, detectIntent, findLine, hasRecentImageEvidence, inStockRows, loadContextAnalysisText, loadDialogueConfig, loadDraftText,
  loadCatalogVerifyText, loadEntityConfig, loadHumanExamples, loadImageReadText, loadIntentRules, loadLedgerTexts, loadMatchingConfig, loadNoteTexts, loadProductLines,
  loadRawProductLines, loadReplyGateConfig, loadScriptTexts, normalize, planStockCascade, redactPII, ruleRouterFor, turnFactsFromStock,
  type CascadeLine, type CatalogQuery, type CatalogResolution, type ConversationState, type Entities, type EpisodeTurn, type FocusResolution, type FoundItem,
  type GateSources, type HandleResult, type MemoryPort, type ProductRef, type RouterOutput, type RouterTurn, type RuleRouter, type StockFacts, type ToolPort,
  type TurnEvidence, type TurnFacts, type UncertainVerdict
} from "@sp/brain";
import { ReplyDispatcher, type DispatchPlan } from "./dispatcher";
import type { ImageIntake, PhotoReading } from "./image-intake";
import type { CatalogVerifier } from "./catalog-verifier";
import type { GatewayBreaker } from "../agent/gateway-breaker";
import { LineKnowledge, distanceBand, paceBand, parsePaceMinutes, type LineDna } from "../knowledge/line-dna";
import { SalesAgent, composeSystemPrompt, moneyAmounts, reviewReply, systemCapabilities, type AgentOutcome, type AgentToolBox, type AgentTurnInput } from "../agent/sales-agent";
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
/** Message authors on the landing that are NOT a human on duty. */
const BOT_AUTHORS = new Set(["bo-nao"]);
const HISTORY_LIMIT = 25;
/** Two lines further apart than this open a new session (Desk episode gap): what "this session names" means to the focus resolver. */
const SESSION_GAP_MS = 6 * 3600 * 1000;
/** "còn màu nào khác" — the customer asks for the same model's other colourways (Desk `asksColors`). */
const OTHER_COLORS_RE = /(mau|mau sac) (nao |gi )?khac|con mau (nao|gi)|mau khac (khong|ko|k)\b/;
/** A Vietnamese mobile number the customer typed (the engine reads it the same way). */
const PHONE_RE = /(?:^|\D)(0\d{9})(?:\D|$)/;
/** How much of a lookup result the dossier keeps per item. */
const LOOKUP_ITEMS_KEPT = 12;

export const SUPERSEDED: InboundResult = { daTraLoi: false, viSao: "gop_vao_tin_sau" };

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
    // A human on duty answered moments ago: they own the conversation, the bot keeps quiet. Not in
    // a draft — a person pressing "Soạn bot" IS the human on duty.
    if (live && recent.tin.some((m) => m.chieu === "di" && !BOT_AUTHORS.has(m.boi) && nowMs - Date.parse(m.luc) < HUMAN_YIELD_MS)) {
      this.deps.logger.info(`[agent] ${conversationId}: nguoi truc vua tra loi — bot im`);
      return this.outcome({ daTraLoi: false, viSao: "nguoi_dang_truc" }, { reply: "", source: "", action: "", needsHuman: false, reason: "Người trực vừa trả lời — bot im.", steps, analysis: null, router: null, engine: null });
    }
    const loaded = await memory.load(tenant as TenantId, conversationId as ConversationId).catch(() => null);
    const contexts = this.turnContextFor(binding);
    const ctx = contexts.build({ tenant, conversationId, message, recent, state: loaded, now: this.deps.clock.now() });
    steps.push({ loai: "doc", ten: "Đọc hội thoại", chiTiet: `${ctx.history.length} tin gần nhất; tin khách cần trả lời: "${redactPII(text).slice(0, 200)}"${ctx.photos.length > 0 ? ` (+${ctx.photos.length} ảnh)` : ""}${ctx.frame !== null ? `; khung: ${ctx.frame.kind}/${ctx.frame.answer}` : ""}` });

    const turn: Turn = {
      req, live, isLatest: req.isLatest ?? (() => true), draft, steps, startedMs, text, channel, tools, memory, shop, hoSo,
      contexts, ctx, photos: null, analysis: null, router: null, engine: null, truth: null, ownStockOnly: false, modelTried: false, modelsOff: false, chaoAi: false, policy: null, analysisMs: 0
    };

    // A public comment is answered by the engine alone, under the comment, as before the pipeline:
    // neither the scripts nor the models were written for a thread the whole Fanpage can read.
    if (channel === COMMENT_CHANNEL) return this.engineTurn(turn);

    // The gateway breaker: open = no model this turn (photos, LLM#1, agent, LLM#3, LLM#2); the shop is told once.
    turn.modelsOff = await this.breakerOpen(turn);
    draft.cauDaoMo = turn.modelsOff ? true : undefined;
    // The landing prepends its greeting to the opening reply (Giai đoạn 7); every model is told so it does not greet again.
    // Desk `introAlreadySent`: the page never wrote in this thread (bot or person, text or picture) AND the landing has not greeted.
    turn.chaoAi = !ctx.daChaoAi && !recent.tin.some((m) => m.chieu === "di");

    // 2. The photos, BEFORE anything writes: a picture the model never looked at is exactly how
    // "cho em xin ảnh" got sent to a customer who had just sent one. The page just asked for the shoe
    // the customer wears (frame `asked_size`): the photo is a size REFERENCE, not something to sell.
    turn.photos = turn.modelsOff ? null : await this.deps.intake.read({
      tenant, binding, photos: ctx.photos, kenh: channel, conversationId, text: loadImageReadText(binding.packId),
      reference: ctx.frame?.kind === "asked_size", receiptTextPatterns: loadLedgerTexts().receiptTextPatterns
    });
    if (turn.photos !== null) {
      draft.anh = { loai: turn.photos.loai, soAnh: turn.photos.looks.length, thamChieu: turn.photos.thamChieu, loi: turn.photos.loi };
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
      traLoi: router.decision.kind === "agent_draft" ? "" : router.decision.reply,
      goiY: router.decision.kind === "agent_draft" ? router.decision.hint : "",
      ...(router.decision.kind === "human_handoff" ? { tuGui: router.decision.safeToAutoSend } : {})
    };
    steps.push({ loai: "quyet-dinh", ten: "Bộ định tuyến", chiTiet: `${router.decision.kind} (${router.decision.reason}) · ý định ${router.intent.intent} · ${router.pipeline.join(" › ")}` });

    const decision = router.decision;
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
        return this.deliver(turn, { reply: decision.reply, source: "kich-ban", action: "human_handoff", hanhDong: "send", handoff: decision.reason, reason: `Kịch bản "${decision.reason}" — gọi người phụ trách.` });
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
    // What the shop taught the AI comes first: "Tạm dừng hàng đối tác" narrows every finder call below.
    const knowledge = await this.knowledgeFor(binding, tools, conversationId, text);
    if (knowledge) steps.push({ loai: "doc", ten: "Kiến thức shop đã duyệt", chiTiet: `${knowledge.hoiDap.length} hỏi đáp, ${knowledge.quyTac.length} quy tắc, ${knowledge.cauMau.length} câu mẫu, ${knowledge.kienThuc.length} ghi chú fit${knowledge.spNgoai ? `, SP ngoài đang chốt ${knowledge.spNgoai.ma}` : ""}` });
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
        return this.deliver(turn, { reply: verdict.reply, source: "kich-ban", action: "human_handoff", hanhDong: "send", handoff: verdict.reason, reason: "Đã hỏi lại một lần mà vẫn chưa rõ mẫu — gọi người phụ trách." });
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
    const drafted = await this.runDraft(turn, agentRun?.toolCalls ?? [], notes);
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

    // 8. The engine, last in line, with the router's intent as its hint.
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
      memoryText: turn.contexts.renderMemory(turn.ctx.state, nowIso),
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
      frame: turn.ctx.frame, profile: turn.hoSo, site: binding.origin, tenShop: binding.shopName
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
  private composeNotes(turn: Turn, hint: string): string[] {
    const { binding } = turn.req;
    const identity = applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam).identity;
    const nowIso = this.deps.clock.now().toISOString();
    const memoryNote = FactNoteComposer.compose({
      site: binding.origin, customerPronoun: identity.customerPronoun,
      conversationSummary: turn.contexts.renderMemory(turn.ctx.state, nowIso),
      hasImage: turn.ctx.photos.length > 0,
      ...(turn.truth?.facts ?? {})
    }, loadNoteTexts(binding.packId));
    const frameNote = turn.ctx.frame !== null ? turn.contexts.describeFrame(turn.ctx.frame) : "";
    const focusNote = this.focusNote(turn);
    const truthLines = (turn.truth?.lines ?? []).join("\n");
    const photoNote = turn.photos?.note ?? "";
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
    const hintNote = hint !== "" ? `CAU HOI LAI MAU (dung khi thieu mau/size, viet lai cho hop): ${hint}` : "";
    return [memoryNote, truthLines, frameNote, focusNote, photoNote, analysisNote, hintNote].filter((part) => part !== "");
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
    const query = catalogQueryOf(router.entities, intent, a?.entities ?? {});
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
    const imageRecognised = photos !== null && (photos.chot !== null || photos.read.code !== "" || photos.read.model !== "");
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

    // (a) The stock: the landing's ladder when it opens one, else Xeon walks the finder rung by rung.
    if (wantsStock && named) {
      const code = query.productCode || photoCode || (query.productName === "" && query.productLine === "" ? carried?.code ?? "" : "");
      await this.lookupStock(turn, kit, { ...query, productCode: code });
    }

    // (b) Which product, and is it clear enough.
    const ledgerProducts = turn.ctx.state.ledger?.products ?? [];
    truth.resolution = wantsStock ? kit.resolver.resolve({
      query: { ...query, productCode: query.productCode || photoCode }, found: truth.found, focused: carried, ledgerProducts,
      strongEvidence: photoCode !== "" ? "image_auto_match" : undefined
    }) : null;
    // LLM#2: one candidate, no strong reason → ask the model which one, with the last lines in view.
    if (truth.resolution !== null && truth.resolution.needVerify) await this.verifyGuess(turn, carried);
    truth.uncertain = wantsStock ? this.applyGate(turn, kit, query, carried !== null || photoCode !== "" || focusHint !== null) : null;
    if (truth.uncertain?.action === "drop_anchor") {
      truth.query = { ...query, productCode: "" };
      truth.lines.push(`KHACH HOI LOAI HANG "${truth.uncertain.productType.label}", KHONG PHAI mau dang bam — tra kho theo loai hang nay, KHONG tra loi ve mau cu.`);
    }

    // (c) The focus, in Desk's trust order.
    truth.focus = this.resolveFocus(turn, carried, nowIso);

    // (d) The stock truth of the focus (or the single match), and the note blocks.
    const anchorCode = truth.focus.product?.code || truth.resolution?.selected[0]?.code || "";
    const requestedSize = query.size || (turn.ctx.frame?.answer === "size" ? turn.ctx.frame.size : "");
    if (anchorCode !== "" && truth.found.length > 0) {
      const size = requestedSize;
      truth.stock = buildStockFacts(truth.found, { code: anchorCode, requestedSize: size, otherColorsAsked: OTHER_COLORS_RE.test(normalize(turn.text)) }, cfg, {
        lines: kit.lines,
        filterLink: (q) => `${binding.origin}/?q=${encodeURIComponent([q.line, q.version].filter((x) => x !== "").join(" "))}${q.size !== "" ? `&size=${encodeURIComponent(q.size)}` : ""}#products`
      });
    }
    const selected = truth.resolution?.selected ?? [];
    truth.facts = {
      ...(selected.length > 0 ? { found: selected.map((c) => ({ code: c.code, name: c.name, price: c.price || undefined, variants: c.sizes.map((r) => `${r.size}${r.so_luong !== undefined ? ` (${r.so_luong})` : ""}`), partner: c.source === "partner" })) } : {}),
      ...turnFactsFromStock(truth.stock),
      ...(router.entities.sizeNote !== "" && router.entities.size !== "" ? { variantHint: { variant: router.entities.size, label: router.entities.sizeNote } } : {})
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
    if (hit !== undefined) return { code: hit.code, name: hit.name };
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
    if (!(intent === "product_advice" || a?.intent === "product_advice" || (turn.router?.entities.need ?? "") !== "")) return;
    const paceText = String(a?.needBrief["pace"] ?? "") || turn.text;
    const distanceText = String(a?.needBrief["distance"] ?? "") || turn.text;
    const minutes = parsePaceMinutes(paceText);
    const pb = paceBand(minutes);
    const db = distanceBand(distanceText);
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
    const rec = knowledge.recommend({ paceText, distanceText }, items.map((it) => it.ten), 3);
    if (rec.picks.length === 0) return;
    truth.facts.lineFamilies = rec.picks.map((pick) => {
      const line = knowledge.byId(pick.id);
      const own = items.filter((it) => knowledge.findByText(it.ten)?.id === pick.id);
      const examples = own.slice(0, 2).map((it) => `${it.ten} (${it.ma})${it.cac_size[0]?.gia ? ` — ${Number(it.cac_size[0].gia).toLocaleString("vi-VN")}đ` : ""}`);
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
      const data = await this.lookup(turn, "catalog.find", turn.ownStockOnly ? { ...step.find, chi_hang_san: true } : step.find, (d) => this.cutItems(this.itemsOf(d)));
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

  /** Desk `applyUncertainProductGate` with this shop's sentences (`hoiLai`, filled by the router's filler). */
  private applyGate(turn: Turn, kit: Stage3Kit, query: CatalogQuery, hasFocus: boolean): UncertainVerdict | null {
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
    const typeLinks = Object.fromEntries(Object.entries(cfg.types.labels).map(([kind, label]) => [kind, `${binding.origin}/?q=${encodeURIComponent(label)}#products`]));
    const turns = turn.ctx.turns.slice(0, -1);
    const lastPage = [...turns].reverse().find((t) => t.role === "shop");
    const lastCustomer = [...turns].reverse().find((t) => t.role === "customer");
    const now = this.deps.clock.now();
    const brand = normalize(String(turn.analysis?.entities["brand"] ?? "") || query.brand);
    const brandInCatalog = brand !== "" && truth.found.length > 0 ? truth.found.some((it) => kit.scorer.brandOf(it).includes(brand)) : undefined;
    return kit.gate.apply({
      message: turn.text, intent: router.intent.intent,
      entities: { productCode: query.productCode, productName: query.productName, brand: query.brand, productType: query.productType },
      analysis: turn.analysis !== null ? { productName: String(turn.analysis.entities["productName"] ?? "") || undefined, brand: String(turn.analysis.entities["brand"] ?? "") || undefined, productType: String(turn.analysis.entities["productType"] ?? "") || undefined } : undefined,
      resolution: truth.resolution, hasImage: turn.ctx.photos.length > 0, hasFocus,
      cascadeFound: truth.found.length > 0,
      continuation: router.intent.matched.some((tag) => tag.startsWith("frame_")),
      state: {
        askedBackBefore: (turn.ctx.state.askBackCount ?? 0) > 0 || turn.ctx.state.lastAskBackAt !== undefined,
        askBackCount: turn.ctx.state.askBackCount,
        hasRecentImageEvidence: hasRecentImageEvidence(turn.ctx.state, now),
        lastPageAt: lastPage?.at, lastCustomerAt: lastCustomer?.at, episodeLastAt: turn.ctx.state.episode?.lastAt
      },
      now: now.toISOString(),
      lexicon: binding.pack.lexicon,
      brandInCatalog, typeLinks, hoiLai
    });
  }

  /** Desk's focus chain: the page's card, the session test on an unrecognised photo, the catalog match, the carried focus, LLM#1's claim, the episode, the ledger. */
  /** The session: the thread's lines after the last gap of six hours or more. */
  private sessionLines(turn: Turn): TurnContext["turns"] {
    const lines = turn.ctx.turns;
    let start = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const gap = Date.parse(lines[i]!.at) - Date.parse(lines[i - 1]!.at);
      if (Number.isFinite(gap) && gap >= SESSION_GAP_MS) start = i;
    }
    return lines.slice(start);
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
      imageRecognised: photos !== null && (photos.chot !== null || photos.read.code !== "" || photos.read.model !== ""),
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
      ...(truth.portrait !== null ? { khach: { daMua: truth.portrait.orderCount, sizeHayMua: truth.portrait.usualSizes ?? [] } } : {})
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

    const turnInput: AgentTurnInput = {
      agent: profile, chung: binding.chung, hoSo: turn.hoSo, chinhSach: turn.shop?.chinhSach,
      nangLuc: systemCapabilities({ open, visionReady: this.visionReady(), hoSo: turn.hoSo, chaoAi: turn.chaoAi, guiKem: open.includes("order.formLink") || turn.ctx.theDaGui.length > 0 }),
      site: binding.origin, shopName: binding.shopName, history: turn.ctx.history,
      neverSay: applyShopProfile(binding.pack, turn.hoSo, binding.chung.cauCam).identity.neverSay,
      extraContext,
      ...this.provenAmounts(turn),
      deadlineMs: Math.max(AGENT_MIN_DEADLINE_MS, this.budgetLeft(turn) - 5000)
    };
    const toolCalls: RecordedToolCall[] = [];
    const usage = { shop: tenant, agent: turn.req.usageAgent ?? "bot_l2", channel: turn.channel, conversationId };
    const runTurn = () => {
      // A whole-turn retry starts over: the first attempt's calls must not end up in the record,
      // or a replay would answer from a tool result this turn never actually saw.
      toolCalls.length = 0;
      return withUsage(usage, () => agent.run({
        ...turnInput,
        tools: recordingToolBox(this.agentToolBox(binding, turn.tools, knowledge, turn.shop), toolCalls, this.deps.clock)
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
          price: Number(item.cac_size?.[0]?.gia) || 0, sizes: (item.cac_size ?? []).map((s) => String(s.size ?? ""))
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
      imageProducts: turn.photos?.chot?.ket === "tu_tin" ? [{ code: turn.photos.chot.ma, name: turn.photos.chot.ten }] : []
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
      intentHint: turn.router?.intent.intent
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
      return this.handOverToPerson(turn, "agent khong tra loi duoc, may luat khong hieu cau", "may-luat");
    }
    const engineReason = result.action === "handoff"
      ? String((result.gates ?? []).find((g) => g.action === "handoff" || g.action === "block")?.reason || "bot khong chac, chuyen nguoi that")
      : result.intentId ? `Máy luật nhận ý "${result.intentId}".` : "Máy luật chưa hiểu câu này.";
    // The engine's handoff is a DELIBERATE non-answer: a human beats a wrong reply. Logged, and the
    // merchant is told there is work waiting.
    if (result.action === "handoff") {
      this.deps.logger.info(`[bo-nao] chuyen nguoi that: ${tenant} / ${message.nguoi}`);
      if (turn.live) await this.notify(turn, engineReason);
      return this.outcome({ daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: result.reply }, { reply: "", source: "", action: "human_handoff", needsHuman: true, reason: engineReason, steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: result });
    }
    if (turn.live) await this.send(turn, result.reply);
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
  }): Promise<TurnOutcome> {
    const base = { reply: what.reply, source: what.source, action: what.action, needsHuman: what.handoff !== undefined, reason: what.reason, steps: turn.steps, analysis: turn.analysis, router: turn.router, engine: null };
    if (!turn.isLatest()) {
      this.deps.logger.info(`[agent] ${turn.req.conversationId}: khach nhan them trong luc soan — bo cau nay, luot sau tra loi ca chum`);
      return this.outcome(SUPERSEDED, { ...base, reply: "", source: "", action: "", needsHuman: false, reason: "Khách nhắn thêm trong lúc soạn." });
    }
    // Giai đoạn 7: what goes with the reply — cards, the order form, the measuring guide, the greeting.
    const plan = this.planExtras(turn, what.reply, what.toolCalls ?? [], what.action);
    const extras = await this.extrasOf(turn, plan);
    if (turn.live) {
      await this.send(turn, what.reply, extras);
      await this.rememberTurn(turn, what.reply, what.toolCalls ?? [], what.askBack === true);
      if (what.handoff !== undefined) await this.notify(turn, what.handoff);
      else if (plan.goiNguoi) await this.notify(turn, "khach chot don — shop chot qua nguoi phu trach");
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
    const polite = sentence.charAt(0).toUpperCase() === sentence.charAt(0) ? sentence : `Dạ ${sentence}`;
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

  private async send(turn: Turn, reply: string, extras: Record<string, unknown> = {}): Promise<void> {
    const { binding, conversationId, message } = turn.req;
    // A comment is answered UNDER that comment: its id is the message id the landing sent in.
    const underComment = turn.channel === COMMENT_CHANNEL && message.maTin ? { traLoiTin: String(message.maTin) } : {};
    const result = await binding.gateway.sendReply({ kenh: message.kenh, nguoi: message.nguoi, chu: reply, maHoiThoai: conversationId, ...underComment, ...extras });
    // What really went: the landing answers `daGui` at the top (contract) or inside `ketQua` (older builds); a queued Zalo send must answer it too.
    const inner = result["ketQua"] as { daGui?: typeof result.daGui; chaoAi?: boolean } | undefined;
    let daGui = result.daGui ?? inner?.daGui;
    // An older landing answers the greeting at the top only: fold it into `daGui` so the dossier reads one shape.
    const chaoAiTop = typeof result["chaoAi"] === "boolean" ? (result["chaoAi"] as boolean) : typeof inner?.chaoAi === "boolean" ? inner.chaoAi : undefined;
    if (daGui === undefined && chaoAiTop !== undefined) daGui = { the: [], boQua: [], chaoAi: chaoAiTop };
    if (turn.draft.guiKem !== undefined && daGui !== undefined) turn.draft.guiKem.daGui = daGui;
    else if (Object.keys(extras).length > 0) this.deps.logger.warn(`[gui-kem] ${conversationId}: landing khong tra daGui cho ${Object.keys(extras).join(", ")} — khong biet the/phieu/chao da di chua`);
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
    const sources: GateSources = {
      shopSaid: turn.ctx.history.filter((h) => h.who === "nguoi").map((h) => h.text).join("\n"),
      customerSaid: turn.ctx.history.filter((h) => h.who === "khach").map((h) => h.text).join("\n"),
      customerMessage: turn.text,
      policy: await this.policyOf(turn),
      hoSo: turn.hoSo,
      found,
      stockFacts: truth?.stock ?? null,
      lookups: {
        orderLooked: (truth?.lookups ?? []).some((l) => l.ten === "order.lookup" && l.loi === undefined),
        tracking: order?.tracking?.url && order.tracking.active ? { url: order.tracking.url, code: order.tracking.code, statusLabel: order.statusLabel ?? order.status } : null,
        exchange: order?.exchange ? { allowed: order.exchange.allowed } : null
      },
      // What the bot may recommend: the pipeline's candidates AND what the agent's own finder calls returned this turn.
      adviceCandidates: [
        ...(truth?.resolution?.selected ?? []).map((c) => ({ code: c.code, name: c.name, price: c.price || undefined, link: c.item.link })),
        ...found.filter((it) => !(truth?.resolution?.selected ?? []).some((c) => c.code === it.ma)).map((it) => ({ code: it.ma, name: it.ten, price: it.cac_size.find((r) => r.gia > 0)?.gia, link: it.link }))
      ],
      links: { ...(truth?.stock?.filterLink ? { filterLink: truth.stock.filterLink } : {}) },
      currentShoe: turn.analysis !== null ? String(turn.analysis.needBrief["currentShoe"] ?? "") || undefined : undefined,
      pronoun: identity.customerPronoun,
      uncertainProduct: truth?.uncertain !== null && truth?.uncertain !== undefined,
      moneyContext: { deposit: undefined },
      hasImages: turn.ctx.photos.length > 0,
      // The cards that will go with this reply, planned on the draft as written (re-planned on the repaired one at delivery).
      cardsSent: (turn.req.binding.gateway.tools.available().includes("order.formLink") || turn.ctx.theDaGui.length > 0) && this.planExtras(turn, reply, toolCalls).theSanPham.length > 0,
      closing: turn.router?.intent.intent === "place_order",
      site: binding.origin, tenShop: binding.shopName,
      sizeChart: loadEntityConfig(binding.packId).sizeChart
    };
    const out = new ReplyGate(loadReplyGateConfig(binding.packId)).run(reply, sources, { needsHuman });
    const mask = (text: string): string => text.replace(/\d{9,}/g, (d) => `${d.slice(0, 2)}***${d.slice(-2)}`);
    turn.draft.cong = { goc: mask(reply), sua: mask(out.reply), dauVet: out.trace, canNguoi: out.needsHuman, lyDo: out.handoffReason };
    if (out.trace.length > 0) {
      turn.steps.push({ loai: "chan", ten: "Cổng soát", chiTiet: `${out.trace.join(" › ")}${out.needsHuman ? ` — cần người (${out.handoffReason})` : ""}` });
      this.deps.logger.info(`[cong-soat] ${tenant}/${turn.req.conversationId}: ${out.trace.join(" › ")}`);
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
      sharedFilter: (codes) => this.sharedFilterOf(turn, found, codes)
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

  private async notify(turn: Turn, lyDo: string): Promise<void> {
    const { binding, conversationId, message } = turn.req;
    await binding.gateway.notifyHandoff({ kenh: message.kenh, nguoi: message.nguoi, maHoiThoai: conversationId, lyDo, tinCuoi: redactPII(turn.text) });
  }

  /** Writes the ledger, the episode and the photo label AFTER the reply went out. A memory that cannot be saved is logged, never fatal. */
  private async rememberTurn(turn: Turn, reply: string, toolCalls: readonly RecordedToolCall[], askBack: boolean): Promise<void> {
    try {
      const truth = turn.truth;
      await turn.memory.save(this.remember(turn.contexts, turn.ctx, {
        text: turn.text, reply, toolCalls, photos: turn.photos, analysis: turn.analysis, askBack,
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
        const price = Number(item.cac_size?.[0]?.gia);
        found.push({ code, name: String(item.ten ?? ""), ...(Number.isFinite(price) && price > 0 ? { price } : {}) });
      }
    }
    const inReply = (p: ProductRef): boolean => p.code !== undefined && p.code !== "" && turn.reply.toUpperCase().includes(p.code.toUpperCase());
    const replied = found.filter(inReply);
    const imageProducts: ProductRef[] = turn.photos?.chot?.ket === "tu_tin" ? [{ code: turn.photos.chot.ma, name: turn.photos.chot.ten }] : [];
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
      customerGoal: a !== null && a.customerGoal !== "" ? a.customerGoal : undefined
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
        match: turn.photos.chot?.ket === "tu_tin" ? { action: "auto_match", primary: imageProducts[0] }
          : turn.photos.chot?.ket === "hoi_lai" ? { action: "ask_choose", selected: turn.photos.chot.luaChon.map((c) => ({ code: c.ma, name: c.ten })) }
          : undefined,
        ocr: turn.photos.read.code !== "" || turn.photos.read.model !== "" ? { brand: turn.photos.read.brand, code: turn.photos.read.code, name: turn.photos.read.model } : undefined
      });
      const label = recognised !== null ? ledger.imageLabel(recognised) : "";
      for (const photo of ctx.photos) if (photo.maTin !== "" && label !== "") imageLabels[photo.maTin] = label;
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
      ...(turn.askBack === true ? { lastAskBackAt: turn.now, askBackCount: (ctx.state.askBackCount ?? 0) + 1 } : {})
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
        const r = await tools.call("catalog.find", ownStockOnly ? { ...args, chi_hang_san: true } : args);
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
      if (hoSo.banHang.coHangOrder === "co") {
        terms.push(`Hang order: ${hoSo.banHang.thoiGianOrder || "(thoi gian chua khai)"}; coc toi thieu ${hoSo.banHang.tiLeCoc !== null ? `${hoSo.banHang.tiLeCoc}%` : "(chua khai)"}.`);
        if (hoSo.banHang.doiTraHangOrder) terms.push(`Doi tra hang order: ${hoSo.banHang.doiTraHangOrder}`);
      } else if (hoSo.banHang.coHangOrder === "khong") terms.push("Shop khong ban hang order.");
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
    return r.data as unknown as ShopProfileBundle;
  }

  /** Whether a photo the customer sends is read this turn (a vision-capable model is configured). */
  visionReady(): boolean {
    return this.deps.vision !== null && this.deps.vision.ready();
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
