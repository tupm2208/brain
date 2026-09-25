/**
 * @file BrainService: wires the engine to merchants and their landings.
 *
 * One Xeon serves MANY merchants. Which merchant is served, where its landing is, which ticket
 * to use: all of it comes from the LICENCE LEDGER (decided 14/09/2026). Adding a customer means
 * issuing a key on the admin page; no code or environment change.
 *
 * A legacy "shared token" mode remains for local trials: merchants declared by hand, one common
 * token, memory in RAM.
 *
 * What this class does: finds the merchant, gathers a burst of messages into one turn, keeps the
 * agent quota and the dossier. What it does NOT do since 25/09/2026: decide the answer — that is
 * the `TurnPipeline` (`turn-pipeline.ts`), one road for the live door and the AI desk alike.
 */

import type { ToolOutput } from "@sp/contract";
import { loadCommonAgent, loadPack, type CommonAgent, type IndustryPack, type MemoryPort, type ToolPort } from "@sp/brain";
import type { LicenseService } from "../license/license-service";
import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import { InMemoryConversationMemory } from "../gateway/conversation-memory";
import type { InboundMessageBody, InboundResult } from "../protocol";
import type { SalesAgent, AgentToolBox } from "../agent/sales-agent";
import type { ChatModelPort } from "../agent/chat-model";
import type { TrainingKnowledge } from "../ai/knowledge";
import type { ContextAnalyzer } from "./context-analyzer";
import type { DraftWriter } from "./draft-writer";
import type { CatalogVerifier } from "./catalog-verifier";
import type { GatewayBreaker } from "../agent/gateway-breaker";
import { ImageFetcher, ImageIntake, type ImageFetch, type PhotoReading } from "./image-intake";
import { SUPERSEDED, TurnPipeline, type DossierDraft } from "./turn-pipeline";
import { currentTrace } from "../chan-doan/trace-context";
import { DOSSIER_VERSION, nullDossierStore, type DossierStore, type TurnDossier, type TurnOutcomeKind } from "../chan-doan/turn-dossier";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

/** A merchant declared by hand in legacy test mode. */
export interface LegacyShop {
  diaChi: string;
  ma: string;
  nganh?: string | undefined;
  shopName?: string | undefined;
}

export interface BrainServiceOptions {
  /** Licensed mode. When present, `legacyShops` is ignored. */
  license?: LicenseService | null | undefined;
  /** Legacy test mode: { [tenant]: { diaChi, ma, nganh } }. */
  legacyShops?: Record<string, LegacyShop> | undefined;
  /** Memory used in legacy mode; licensed mode keeps memory on the landing. */
  memory?: MemoryPort | undefined;
  fetch?: FetchLike | undefined;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
  /** The AI sales agent. Absent or not ready = the rule engine answers alone. */
  agent?: SalesAgent | undefined;
  /** LLM#1 (25/09/2026): reads the conversation before the router. Absent = the router runs on rules alone. */
  analyzer?: ContextAnalyzer | null | undefined;
  /** LLM#3 (25/09/2026): the one-shot draft when the agent cannot answer. Absent = the rule engine takes that turn. */
  writer?: DraftWriter | null | undefined;
  /**
   * The model that READS a photo the customer sent (Đ7, 21/09/2026). Absent = the bot answers
   * without seeing the picture, exactly as before.
   */
  vision?: ChatModelPort | undefined;
  /** Downloads the customer's photos for the vision model (GĐ5). Absent = the address is sent as is (tests, older setups). */
  imageFetch?: ImageFetch | null | undefined;
  /** LLM#2 (25/09/2026): confirms a weak catalog guess before the agent quotes it. Absent = the guess is flagged, not confirmed. */
  verifier?: CatalogVerifier | null | undefined;
  /** The gateway breaker (25/09/2026). Absent = every turn tries the models. */
  breaker?: GatewayBreaker | null | undefined;
  /** Agent turns per merchant per hour; beyond it LLM#3 / the rule engine answer (a runaway loop must not burn the budget). */
  agentTurnsPerHour?: number | undefined;
  /**
   * Burst gathering (Sales Desk `scheduleServerAIRouter`): wait this long after a customer message
   * and answer only the LAST message of a burst, with the whole burst in view. 0 = answer each
   * message at once (tests, legacy). Production: 6000.
   */
  burstWaitMs?: number | undefined;
  /** Extra wait when the message carries or points at a picture — Meta delivers photos seconds after the text (Desk: 7000). */
  imageWaitMs?: number | undefined;
  /** Test seam for the waits. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /**
   * Where the TURN DOSSIER goes (21/09/2026). Absent = nothing is kept, which is the default: a
   * merchant who has not turned it on pays neither disk nor privacy for it.
   */
  dossier?: DossierStore | undefined;
}

/** An old message (replayed after a restart) has no photo on its way any more. */
const IMAGE_WAIT_FRESH_MS = 2 * 60 * 1000;

/**
 * How the turn ended, read off the reply the inbound door returns. `null` means the turn threw,
 * which counts as broken — and a broken turn is kept four times as long.
 */
function outcomeKind(result: InboundResult | null): TurnOutcomeKind {
  if (result === null) return "hong";
  if (result.daTraLoi) return "da-tra-loi";
  if (result.viSao === "chuyen_nguoi_that") return "chuyen-nguoi-that";
  // Deliberate silence: a human was answering, or a newer message in the burst took over.
  if (result.viSao === "nguoi_dang_truc" || result.viSao === "gop_vao_tin_sau") return "im";
  return "hong";
}

/** What the landing says is the shop's (tier 3): the profile, the policy texts, the warehouses' policies. */
export type ShopProfileBundle = ToolOutput<"shop.profile">;

/** Everything the service holds for one merchant. */
export interface MerchantBinding {
  gateway: LandingGateway;
  pack: IndustryPack;
  /** Tier 1, the same for every merchant; kept here so a turn has all three tiers in one place. */
  chung: CommonAgent;
  origin: string;
  packId: string;
  shopName?: string | undefined;
  /** Tool-list mismatch with the pack has been reported once. */
  mismatchReported: boolean;
}

export class BrainService {
  private readonly license: LicenseService | null;
  private readonly memory: MemoryPort;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly merchants = new Map<string, MerchantBinding>();
  private readonly agent: SalesAgent | null;
  private readonly agentTurnsPerHour: number;
  private readonly agentStamps = new Map<string, number[]>();
  private readonly burstWaitMs: number;
  private readonly imageWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly dossier: DossierStore;
  private readonly pipeline: TurnPipeline;
  /** Per conversation: number of the newest message seen, and the turn being answered right now. */
  private readonly burstSeq = new Map<string, number>();
  private readonly burstRuns = new Map<string, Promise<InboundResult>>();

  constructor(options: BrainServiceOptions = {}) {
    this.agent = options.agent ?? null;
    this.burstWaitMs = Math.max(0, options.burstWaitMs ?? 0);
    this.imageWaitMs = Math.max(0, options.imageWaitMs ?? 0);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.dossier = options.dossier ?? nullDossierStore;
    this.agentTurnsPerHour = options.agentTurnsPerHour ?? 120;
    this.license = options.license ?? null;
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetchImpl = options.fetch;
    this.logger = options.logger ?? { info: (m) => console.log(m), warn: (m) => console.warn(m) };
    this.clock = options.clock ?? { now: () => new Date() };
    this.pipeline = new TurnPipeline({
      agent: this.agent,
      analyzer: options.analyzer ?? null,
      writer: options.writer ?? null,
      vision: options.vision ?? null,
      intake: new ImageIntake({
        vision: options.vision ?? null, logger: this.logger, clock: this.clock,
        fetcher: options.imageFetch ? new ImageFetcher({ fetch: options.imageFetch, sleep: this.sleep }) : null
      }),
      verifier: options.verifier ?? null,
      breaker: options.breaker ?? null,
      clock: this.clock,
      logger: this.logger,
      sleep: this.sleep,
      takeAgentTurn: (tenant, now) => this.takeAgentTurn(tenant, now),
      // Licensed mode: memory on the merchant's own landing. Legacy mode: RAM.
      memoryFor: (binding) => (this.license !== null ? binding.gateway.memory : this.memory),
      refreshTools: (tenant, binding) => this.refreshTools(tenant, binding)
    });

    if (this.license === null) {
      for (const [tenant, shop] of Object.entries(options.legacyShops ?? {})) {
        if (!shop?.diaChi) throw new Error(`Shop "${tenant}" thiếu địa chỉ server.`);
        this.merchants.set(tenant, {
          gateway: new LandingGateway({ origin: shop.diaChi, ticket: shop.ma, fetch: this.fetchImpl, logger: this.logger, clock: this.clock, shop: tenant }),
          pack: shop.nganh ? loadPack(shop.nganh) : (() => { throw new Error(`Shop "${tenant}" thiếu ngành hàng.`); })(),
          chung: loadCommonAgent(),
          origin: shop.diaChi, packId: shop.nganh || "", shopName: shop.shopName, mismatchReported: false
        });
      }
    }
  }

  /** The binding for a merchant, for diagnostics and tests. */
  merchant(tenant: string): MerchantBinding | undefined {
    return this.merchants.get(tenant);
  }

  /** The one road a turn takes; the AI desk drives it in "khong-gui" mode. */
  turnPipeline(): TurnPipeline {
    return this.pipeline;
  }

  /** Handles one inbound message end to end and returns what the landing should know. */
  async handleInbound(message: InboundMessageBody & { tenant: string }): Promise<InboundResult> {
    const tenant = String(message.tenant || "");
    const binding = this.bindingFor(tenant);
    if (binding === null) return { daTraLoi: false, viSao: "khong_phuc_vu_shop" };
    // Đ7: the landing says how this conversation is answered. Only "auto" may send by itself; a
    // landing that sends nothing (older builds) means auto, as before.
    const mode = String(message.cheDo ?? "auto");
    if (mode === "suggest" || mode === "off") return { daTraLoi: false, viSao: "che_do_khong_tu_gui" };
    if (binding.gateway.toolListStale()) await this.refreshTools(tenant, binding);

    const conversationId = String(message.maHoiThoai || `${message.kenh || "facebook"}:${message.nguoi}`);

    // BURST GATHERING (Sales Desk): customers type "shop ơi" / "còn đôi này không" / "size 42" as
    // three messages. Each message waits; a newer one in the same conversation takes over, and only
    // the last is answered — the agent reads the whole burst from the thread.
    const seq = (this.burstSeq.get(conversationId) ?? 0) + 1;
    this.burstSeq.set(conversationId, seq);
    const isLatest = () => this.burstSeq.get(conversationId) === seq;
    const wait = this.waitFor(message, binding);
    if (wait > 0) await this.sleep(wait);
    if (!isLatest()) return SUPERSEDED;
    // One turn at a time per conversation: the previous turn finishes (and drops its reply, since it
    // is no longer the latest) before this one reads the thread.
    const previous = this.burstRuns.get(conversationId);
    if (previous) await previous.catch(() => undefined);
    if (!isLatest()) return SUPERSEDED;

    const run = this.answer(tenant, binding, message, conversationId, isLatest);
    this.burstRuns.set(conversationId, run);
    try {
      return await run;
    } finally {
      if (this.burstRuns.get(conversationId) === run) this.burstRuns.delete(conversationId);
      if (isLatest()) this.burstSeq.delete(conversationId);
    }
  }

  /** How long a message waits for the rest of its burst. */
  private waitFor(message: InboundMessageBody, binding: MerchantBinding | null): number {
    if (this.burstWaitMs === 0) return 0;
    const sentAt = Date.parse(String(message.luc ?? ""));
    const fresh = !Number.isFinite(sentAt) || this.clock.now().getTime() - sentAt < IMAGE_WAIT_FRESH_MS;
    const patterns = binding?.pack.imageReferencePatterns ?? ["(như hình|nhu hinh|như ảnh|nhu anh|đôi này|doi nay|mẫu này|mau nay|cái này|cai nay|đôi trên|doi tren|mẫu trên|mau tren|giống này|giong nay|hình này|hinh nay|ảnh này|anh nay|đôi kia|doi kia|con này|còn này)"];
    const imgRe = new RegExp(patterns.join("|"), "i");
    const pictures = Number(message.soAnh || 0) > 0 || imgRe.test(String(message.chu || ""));
    return this.burstWaitMs + (pictures && fresh ? this.imageWaitMs : 0);
  }

  /**
   * Answers one message and KEEPS THE DOSSIER (21/09/2026). The dossier is written in `finally`,
   * so a turn that threw is recorded too — that is the turn someone will come asking about.
   */
  private async answer(tenant: string, binding: MerchantBinding, message: InboundMessageBody & { tenant: string }, conversationId: string, isLatest: () => boolean): Promise<InboundResult> {
    const startedMs = this.clock.now().getTime();
    const draft: DossierDraft = { duongDi: "may-luat" };
    let result: InboundResult | null = null;
    try {
      result = await this.answerTurn(tenant, binding, message, conversationId, isLatest, draft);
      return result;
    } finally {
      await this.keepDossier(tenant, binding, message, conversationId, draft, result, this.clock.now().getTime() - startedMs);
    }
  }

  /** Answers one message (the latest of its burst): the pipeline, in "gui" mode. */
  private async answerTurn(tenant: string, binding: MerchantBinding, message: InboundMessageBody & { tenant: string }, conversationId: string, isLatest: () => boolean, draft: DossierDraft): Promise<InboundResult> {
    const outcome = await this.pipeline.run({ tenant, binding, conversationId, message, mode: "gui", isLatest, draft, usageAgent: "bot_l2" });
    return outcome.result;
  }

  /** Assembles the dossier and hands it to the store. Never throws: bookkeeping owes the customer nothing. */
  private async keepDossier(
    tenant: string, binding: MerchantBinding, message: InboundMessageBody & { tenant: string },
    conversationId: string, draft: DossierDraft, result: InboundResult | null, msTong: number
  ): Promise<void> {
    if (this.dossier === nullDossierStore) return;
    try {
      const dossier: TurnDossier = {
        version: DOSSIER_VERSION,
        stt: 0,
        luc: this.clock.now().toISOString(),
        shop: tenant,
        maHoiThoai: conversationId,
        nguoi: String(message.nguoi ?? ""),
        kenh: String(message.kenh ?? "facebook"),
        duongDi: draft.duongDi,
        ketCuc: outcomeKind(result),
        msTong,
        ban: binding.packId,
        ...(currentTrace() !== null ? { maVet: currentTrace()! } : {}),
        tinKhach: { chu: String(message.chu ?? ""), soAnh: Number(message.soAnh || 0), luc: String(message.luc ?? "") },
        phanTich: draft.phanTich === null || draft.phanTich === undefined ? draft.phanTich : { ...draft.phanTich, ms: draft.phanTichMs },
        phanTichMs: draft.phanTichMs,
        router: draft.router,
        traCuu: draft.traCuu,
        suThat: draft.suThat,
        agent: draft.agent,
        nhap: draft.nhap,
        mayLuat: draft.mayLuat,
        ghiChu: draft.ghiChu,
        cong: draft.cong,
        guiKem: draft.guiKem,
        anh: draft.anh,
        ...(draft.cauDaoMo === true ? { cauDaoMo: true } : {})
      };
      if (result !== null && !result.daTraLoi && result.viSao !== undefined) dossier.viSao = result.viSao;
      await this.dossier.write(dossier);
    } catch (error) {
      this.logger.warn(`[ho-so] khong dung duoc ho so luot ${tenant}/${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---------------------------------------------------------------- for the AI desk (Đ7)

  /** WHAT THE CUSTOMER'S PHOTO SHOWS, as one line for a model's context (see `ImageIntake`). */
  async readCustomerPhotos(tenant: string, binding: MerchantBinding, message: { anh?: string[] | undefined; kenh?: string | undefined }, conversationId: string): Promise<string | null> {
    return (await this.readPhotos(tenant, binding, message, conversationId))?.note ?? null;
  }

  /** `readCustomerPhotos` with the pieces kept apart. */
  async readPhotos(tenant: string, binding: MerchantBinding, message: { anh?: string[] | undefined; kenh?: string | undefined }, conversationId: string): Promise<PhotoReading | null> {
    return this.pipeline.readPhotos(tenant, binding, message, conversationId);
  }

  /** The tools the agent may call on this merchant's landing (see `TurnPipeline.agentToolBox`). */
  agentToolBox(binding: MerchantBinding, knowledge: TrainingKnowledge | null, shop: ShopProfileBundle | null = null, tools: ToolPort = binding.gateway.tools): AgentToolBox {
    return this.pipeline.agentToolBox(binding, tools, knowledge, shop);
  }

  /** What the shop taught the AI (Đ7), or `null` when the landing does not open the tool or fails. */
  async knowledgeFor(binding: MerchantBinding, conversationId: string, text: string): Promise<TrainingKnowledge | null> {
    return this.pipeline.knowledgeFor(binding, binding.gateway.tools, conversationId, text);
  }

  /** Whether a photo the customer sends is read this turn (a vision-capable model is configured). */
  visionReady(): boolean {
    return this.pipeline.visionReady();
  }

  /** The agent, when one is configured and ready. */
  readyAgent(): SalesAgent | null {
    return this.agent !== null && this.agent.ready() ? this.agent : null;
  }

  /** The binding for a merchant with a fresh tool list — for the AI desk (Đ7). `null` = not served. */
  async bindingForTenant(tenant: string): Promise<MerchantBinding | null> {
    const binding = this.bindingFor(tenant);
    if (binding !== null && binding.gateway.toolListStale()) await this.refreshTools(tenant, binding);
    return binding;
  }

  /** The shop's policy from the landing, in words (see `TurnPipeline.policyText`). */
  async policyText(binding: MerchantBinding, shop: ShopProfileBundle | null): Promise<string> {
    return this.pipeline.policyText(binding, binding.gateway.tools, shop);
  }

  /** Tier 3 from the landing, or `null` when the landing does not open `shop.profile` (an older build). */
  async shopProfileFor(binding: MerchantBinding): Promise<ShopProfileBundle | null> {
    return this.pipeline.shopProfileFor(binding);
  }

  /** Counts one agent turn against the hourly quota; false when it is spent. */
  private takeAgentTurn(tenant: string, now: number): boolean {
    const stamps = (this.agentStamps.get(tenant) ?? []).filter((t) => now - t < 3600 * 1000);
    if (stamps.length >= this.agentTurnsPerHour) {
      this.agentStamps.set(tenant, stamps);
      this.logger.warn(`[agent] shop "${tenant}" het quota ${this.agentTurnsPerHour} luot/gio — soan nhap / may luat tra loi`);
      return false;
    }
    stamps.push(now);
    this.agentStamps.set(tenant, stamps);
    return true;
  }

  // ---------------------------------------------------------------- internals

  /** Finds (or builds) the binding for a merchant. Licensed mode consults the ledger every message. */
  private bindingFor(tenant: string): MerchantBinding | null {
    if (this.license === null) return this.merchants.get(tenant) ?? null;
    const eligibility = this.license.serviceEligibility(tenant);
    if (!eligibility.ok) {
      this.logger.warn(`[bo-nao] khong phuc vu shop "${tenant}": ${eligibility.viSao}`);
      return null;
    }
    const existing = this.merchants.get(tenant);
    if (existing && existing.origin === eligibility.diaChi && existing.packId === eligibility.nganh) return existing;
    const tickets = new ServiceTicketProvider(this.license, tenant, this.clock);
    const binding: MerchantBinding = {
      origin: eligibility.diaChi, packId: eligibility.nganh, shopName: eligibility.tenShop, mismatchReported: false,
      gateway: new LandingGateway({ origin: eligibility.diaChi, ticket: () => tickets.ticket(), fetch: this.fetchImpl, logger: this.logger, clock: this.clock, shop: tenant }),
      pack: eligibility.nganh ? loadPack(eligibility.nganh) : (() => { throw new Error(`Shop "${tenant}" thiếu ngành hàng.`); })(),
      chung: loadCommonAgent()
    };
    this.merchants.set(tenant, binding);
    return binding;
  }

  /**
   * Refreshes the tool list from the landing. On the first successful read, tools the pack wants
   * but the landing does not open are reported once; earlier this mismatch was silent and every
   * policy question fell into "ask back".
   */
  private async refreshTools(tenant: string, binding: MerchantBinding): Promise<void> {
    const open = await binding.gateway.refreshToolList();
    if (binding.mismatchReported) return;
    binding.mismatchReported = true;
    const missing = (binding.pack.allowedTools ?? []).filter((t) => !open.includes(t));
    if (missing.length > 0) {
      this.logger.warn(`[bo-nao] shop "${tenant}": bo luat "${binding.pack.id}" muon dung ${missing.join(", ")} nhung landing khong mo — phan do bot se khong tra loi`);
    }
  }
}
