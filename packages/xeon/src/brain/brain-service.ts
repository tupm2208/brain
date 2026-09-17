/**
 * @file BrainService: wires the engine to merchants and their landings.
 *
 * One Xeon serves MANY merchants. Which merchant is served, where its landing is, which ticket
 * to use: all of it comes from the LICENCE LEDGER (decided 14/09/2026). Adding a customer means
 * issuing a key on the admin page; no code or environment change.
 *
 * A legacy "shared token" mode remains for local trials: merchants declared by hand, one common
 * token, memory in RAM.
 */

import type { ConversationId, TenantId, ToolName } from "@sp/contract";
import { TurnEngine, loadPack, redactPII, stripDiacritics, type IndustryPack, type MemoryPort } from "@sp/brain";
import type { LicenseService } from "../license/license-service";
import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import { InMemoryConversationMemory } from "../gateway/conversation-memory";
import type { InboundMessageBody, InboundResult } from "../protocol";
import { SalesAgent, type AgentToolBox, type HistoryLine } from "../agent/sales-agent";
import { renderKnowledge, type TrainingKnowledge } from "../ai/knowledge";
import { withUsage } from "../ai/usage-context";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

/** The landing's channel for PUBLIC COMMENTS on a Fanpage post (wire value set by the landing's inbox). */
export const COMMENT_CHANNEL = "facebook-binh-luan";

/** A merchant declared by hand in legacy test mode. */
export interface LegacyShop {
  diaChi: string;
  ma: string;
  nganh?: string | undefined;
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
  /** Agent turns per merchant per hour; beyond it the rule engine answers (a runaway loop must not burn the budget). */
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
}

/** Text pointing at a picture ("đôi này", "như hình") — the photo is probably still on its way (Desk AI_IMAGE_REFERENCE_RE). */
export const IMAGE_REFERENCE_RE = /(đôi này|doi nay|mẫu này|mau nay|cái này|cai nay|đôi trên|doi tren|mẫu trên|mau tren|như hình|nhu hinh|như ảnh|nhu anh|giống này|giong nay|hình này|hinh nay|ảnh này|anh nay|đôi kia|doi kia|con này|còn này)/i;
/** An old message (replayed after a restart) has no photo on its way any more. */
const IMAGE_WAIT_FRESH_MS = 2 * 60 * 1000;
const SUPERSEDED: InboundResult = { daTraLoi: false, viSao: "gop_vao_tin_sau" };

/** Tools the agent cannot work without; a landing that does not open them keeps the rule engine. */
export const AGENT_TOOLS: ToolName[] = ["catalog.find", "conversation.recent"];
/** A human who wrote in the conversation this recently owns it: the bot does not talk over them (Desk: 5 minutes). */
export const HUMAN_YIELD_MS = 5 * 60 * 1000;
/** `tryAgent` ran the agent and it failed: the engine answers, but must not fall back to a bare greeting. */
const AGENT_FAILED = "agent_failed" as const;
/** Pause before running a whole agent turn again when the model could not be reached at all. */
export const AGENT_TURN_RETRY_MS = 5000;
/** Message authors on the landing that are NOT a human on duty. */
const BOT_AUTHORS = new Set(["bo-nao"]);

/** Everything the service holds for one merchant. */
export interface MerchantBinding {
  gateway: LandingGateway;
  pack: IndustryPack;
  origin: string;
  packId: string;
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
  /** Per conversation: number of the newest message seen, and the turn being answered right now. */
  private readonly burstSeq = new Map<string, number>();
  private readonly burstRuns = new Map<string, Promise<InboundResult>>();

  constructor(options: BrainServiceOptions = {}) {
    this.agent = options.agent ?? null;
    this.burstWaitMs = Math.max(0, options.burstWaitMs ?? 0);
    this.imageWaitMs = Math.max(0, options.imageWaitMs ?? 0);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.agentTurnsPerHour = options.agentTurnsPerHour ?? 120;
    this.license = options.license ?? null;
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetchImpl = options.fetch;
    this.logger = options.logger ?? { info: (m) => console.log(m), warn: (m) => console.warn(m) };
    this.clock = options.clock ?? { now: () => new Date() };

    if (this.license === null) {
      for (const [tenant, shop] of Object.entries(options.legacyShops ?? {})) {
        if (!shop?.diaChi) throw new Error(`Shop "${tenant}" thiếu địa chỉ server.`);
        this.merchants.set(tenant, {
          gateway: new LandingGateway({ origin: shop.diaChi, ticket: shop.ma, fetch: this.fetchImpl, logger: this.logger, clock: this.clock }),
          pack: loadPack(shop.nganh || "giay-chay"),
          origin: shop.diaChi, packId: shop.nganh || "giay-chay", mismatchReported: false
        });
      }
    }
  }

  /** The binding for a merchant, for diagnostics and tests. */
  merchant(tenant: string): MerchantBinding | undefined {
    return this.merchants.get(tenant);
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
    const wait = this.waitFor(message);
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
  private waitFor(message: InboundMessageBody): number {
    if (this.burstWaitMs === 0) return 0;
    const sentAt = Date.parse(String(message.luc ?? ""));
    const fresh = !Number.isFinite(sentAt) || this.clock.now().getTime() - sentAt < IMAGE_WAIT_FRESH_MS;
    const pictures = Number(message.soAnh || 0) > 0 || IMAGE_REFERENCE_RE.test(String(message.chu || ""));
    return this.burstWaitMs + (pictures && fresh ? this.imageWaitMs : 0);
  }

  /** Answers one message (the latest of its burst). `isLatest` is re-checked right before anything is sent. */
  private async answer(tenant: string, binding: MerchantBinding, message: InboundMessageBody & { tenant: string }, conversationId: string, isLatest: () => boolean): Promise<InboundResult> {
    const byAgent = await this.tryAgent(tenant, binding, message, conversationId, isLatest);
    if (byAgent !== null && byAgent !== AGENT_FAILED) return byAgent;

    const engine = new TurnEngine(binding.pack, {
      tools: binding.gateway.tools,
      catalog: binding.gateway.catalog,
      // Licensed mode: memory on the merchant's own landing. Legacy mode: RAM.
      memory: this.license !== null ? binding.gateway.memory : this.memory,
      clock: this.clock
    });
    const result = await engine.handle({
      tenant: tenant as TenantId,
      conversationId: conversationId as ConversationId,
      text: String(message.chu || ""),
      imageCount: Number(message.soAnh || 0),
      at: String(message.luc || this.clock.now().toISOString())
    });

    // The agent tried and could not answer, and the engine did not understand either (no intent):
    // its fallback is the bare greeting "Dạ em nghe bác ạ." — mid-conversation that reads as the
    // bot ignoring the customer (16/09/2026, "cho tôi đôi khác xem"). Hand over instead, and say so.
    // The customer wrote again while the engine worked: the newer turn answers.
    if (!isLatest()) return SUPERSEDED;
    // Also when the engine hands over: its handoff is SILENT (a notice to the shop only), which after
    // a failed agent turn means the customer hears nothing at all (16/09/2026, "size 35 màu hồng").
    if (byAgent === AGENT_FAILED && (result.intentId === null || result.action === "handoff")) {
      const identity = binding.pack.identity;
      const sentence = String(binding.pack.templates["handoff"] ?? "")
        .split("{shop}").join(identity.selfPronoun).split("{khach}").join(identity.customerPronoun);
      const polite = sentence.charAt(0).toUpperCase() === sentence.charAt(0) ? sentence : `Dạ ${sentence}`;
      await binding.gateway.sendReply({ kenh: message.kenh, nguoi: message.nguoi, chu: polite, maHoiThoai: conversationId });
      await binding.gateway.notifyHandoff({
        kenh: message.kenh, nguoi: message.nguoi, maHoiThoai: conversationId,
        lyDo: "agent khong tra loi duoc, may luat khong hieu cau", tinCuoi: redactPII(String(message.chu || ""))
      });
      return { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: polite };
    }

    // The engine has three outcomes. "handoff" is a DELIBERATE non-answer: a human beats a wrong
    // reply. It is still logged and the merchant is told there is work waiting.
    if (result.action === "handoff") {
      this.logger.info(`[bo-nao] chuyen nguoi that: ${tenant} / ${message.nguoi}`);
      await binding.gateway.notifyHandoff({
        kenh: message.kenh, nguoi: message.nguoi,
        maHoiThoai: conversationId,
        // Reason from the gate that blocked (`gates[].reason`); a generic one otherwise.
        lyDo: String((result.gates ?? []).find((g) => g.action === "handoff" || g.action === "block")?.reason || "bot khong chac, chuyen nguoi that"),
        tinCuoi: redactPII(String(message.chu || ""))
      });
      return { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: result.reply };
    }

    // A comment is answered UNDER that comment: its id is the message id the landing sent in.
    const underComment = message.kenh === COMMENT_CHANNEL && message.maTin ? { traLoiTin: String(message.maTin) } : {};
    await binding.gateway.sendReply({ kenh: message.kenh, nguoi: message.nguoi, chu: result.reply, maHoiThoai: conversationId, ...underComment });
    return {
      daTraLoi: true,
      hanhDong: result.action,
      // The log must not carry the customer's exact words; phone numbers are redacted first.
      traLoi: redactPII(result.reply)
    };
  }

  // ---------------------------------------------------------------- the AI agent

  /**
   * Sales Desk's level-2 agent, first in line (Desk ran it on every message: AI_LEVEL2_MODE=always).
   * Returns `null` whenever the rule engine should answer instead: agent off, pack without an agent,
   * landing without the tools, a comment, a complaint / money message, quota spent, or the agent
   * failed or wrote something the review blocked.
   */
  private async tryAgent(tenant: string, binding: MerchantBinding, message: InboundMessageBody & { tenant: string }, conversationId: string, isLatest: () => boolean = () => true): Promise<InboundResult | typeof AGENT_FAILED | null> {
    const profile = binding.pack.agent;
    if (this.agent === null || !this.agent.ready() || profile === undefined) return null;
    if (message.kenh === COMMENT_CHANNEL) return null;
    const open = binding.gateway.tools.available();
    if (!AGENT_TOOLS.every((t) => open.includes(t))) return null;
    const text = String(message.chu || "");
    if (SalesAgent.mustHuman(binding.pack, text)) return null;

    const recent = await binding.gateway.tools.call("conversation.recent", { conversationId: conversationId as ConversationId, limit: 25 });
    if (!recent.ok) return null;
    const now = this.clock.now().getTime();
    const lines = recent.data.tin;
    // A human on duty answered moments ago: they own the conversation, the bot keeps quiet.
    if (lines.some((m) => m.chieu === "di" && !BOT_AUTHORS.has(m.boi) && now - Date.parse(m.luc) < HUMAN_YIELD_MS)) {
      this.logger.info(`[agent] ${conversationId}: nguoi truc vua tra loi — bot im`);
      return { daTraLoi: false, viSao: "nguoi_dang_truc" };
    }
    if (!this.takeAgentTurn(tenant, now)) return null;

    const history: HistoryLine[] = lines.map((m) => ({
      who: m.chieu === "den" ? "khach" : BOT_AUTHORS.has(m.boi) ? "bot" : "nguoi",
      text: m.chu,
      images: m.chieu === "den" ? m.soAnh : 0
    }));
    const last = history.at(-1);
    if (!last || last.who !== "khach" || last.text !== text) history.push({ who: "khach", text, images: Number(message.soAnh || 0) });

    const agent = this.agent;
    const knowledge = await this.knowledgeFor(binding, conversationId, text);
    const runTurn = () => withUsage({ shop: tenant, agent: "bot_l2", channel: message.kenh ?? "facebook", conversationId }, () => agent.run({
      agent: profile, site: binding.origin, history, neverSay: binding.pack.identity.neverSay,
      extraContext: renderKnowledge(knowledge),
      tools: this.agentToolBox(binding, profile.fallbackPolicy, knowledge)
    }));
    let outcome = await runTurn();
    // The gateway was down for the whole turn (every call retried and failed): wait, then run the
    // whole turn once more — a customer must not get "em nhờ nhân viên" because of a 20-second blip.
    if (!outcome.ok && outcome.modelDown && isLatest()) {
      this.logger.warn(`[agent] ${conversationId}: mo hinh khong tra loi (${outcome.viSao}) — cho ${AGENT_TURN_RETRY_MS / 1000}s roi chay lai ca luot`);
      await this.sleep(AGENT_TURN_RETRY_MS);
      if (!isLatest()) return SUPERSEDED;
      outcome = await runTurn();
    }
    if (!outcome.ok) {
      this.logger.warn(`[agent] ${conversationId}: khong dung duoc (${outcome.viSao}) — may luat tra loi`);
      return AGENT_FAILED;
    }

    // Desk rule: a customer message that arrived while the agent was writing makes this reply stale.
    if (!isLatest()) {
      this.logger.info(`[agent] ${conversationId}: khach nhan them trong luc soan — bo cau nay, luot sau tra loi ca chum`);
      return SUPERSEDED;
    }
    await binding.gateway.sendReply({ kenh: message.kenh, nguoi: message.nguoi, chu: outcome.reply, maHoiThoai: conversationId });
    if (new RegExp(profile.handoffReplyPattern).test(stripDiacritics(outcome.reply).toLowerCase())) {
      await binding.gateway.notifyHandoff({
        kenh: message.kenh, nguoi: message.nguoi, maHoiThoai: conversationId,
        lyDo: "agent goi nguoi phu trach", tinCuoi: redactPII(text)
      });
    }
    const used = outcome.trace.map((t) => t.tool ?? t.error).filter(Boolean).join(", ") || "khong goi cong cu";
    this.logger.info(`[agent] ${conversationId}: tra loi sau ${outcome.steps} buoc (${used})`);
    return { daTraLoi: true, hanhDong: "agent", traLoi: redactPII(outcome.reply) };
  }

  /**
   * The tools the agent may call on this merchant's landing. Đ7: a shop that paused partner goods
   * ("Tạm dừng hàng đối tác") gets in-stock-only answers, whatever the model asked for.
   */
  agentToolBox(binding: MerchantBinding, fallbackPolicy: string, knowledge: TrainingKnowledge | null): AgentToolBox {
    const tools = binding.gateway.tools;
    const open = tools.available();
    const ownStockOnly = knowledge?.cauHinh.tatHangDoiTac === true;
    return {
      findStock: async (args) => {
        const r = await tools.call("catalog.find", ownStockOnly ? { ...args, chi_hang_san: true } : args);
        return r.ok ? r.data.ketQua : `LOI tra kho: ${r.error.message}`;
      },
      policy: async () => this.policyText(binding, fallbackPolicy),
      bankAccount: async () => {
        if (!open.includes("shop.bankAccount")) return { loi: "shop chua mo thong tin tai khoan" };
        const r = await tools.call("shop.bankAccount", {});
        return r.ok ? r.data : { loi: r.error.message };
      }
    };
  }

  /** What the shop taught the AI (Đ7), or `null` when the landing does not open the tool or fails. */
  async knowledgeFor(binding: MerchantBinding, conversationId: string, text: string): Promise<TrainingKnowledge | null> {
    if (!binding.gateway.tools.available().includes("training.knowledge")) return null;
    const r = await binding.gateway.tools.call("training.knowledge", { q: text.slice(0, 300), conversationId });
    return r.ok ? r.data : null;
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

  /** The shop's policy from the landing (returns, shipping, warranty); the pack's text when the shop filled in none. */
  async policyText(binding: MerchantBinding, fallback: string): Promise<string> {
    const tools = binding.gateway.tools;
    const parts: string[] = [];
    if (tools.available().includes("policy.get")) {
      for (const [topic, title] of [["doi-tra", "DOI TRA"], ["ship", "SHIP"], ["bao-hanh", "BAO HANH"]] as const) {
        const r = await tools.call("policy.get", { topic });
        if (r.ok && r.data.found) parts.push(`## ${title}\n${r.data.text}`);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : fallback;
  }

  /** Counts one agent turn against the hourly quota; false when it is spent. */
  private takeAgentTurn(tenant: string, now: number): boolean {
    const stamps = (this.agentStamps.get(tenant) ?? []).filter((t) => now - t < 3600 * 1000);
    if (stamps.length >= this.agentTurnsPerHour) {
      this.agentStamps.set(tenant, stamps);
      this.logger.warn(`[agent] shop "${tenant}" het quota ${this.agentTurnsPerHour} luot/gio — may luat tra loi`);
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
      origin: eligibility.diaChi, packId: eligibility.nganh, mismatchReported: false,
      gateway: new LandingGateway({ origin: eligibility.diaChi, ticket: () => tickets.ticket(), fetch: this.fetchImpl, logger: this.logger, clock: this.clock }),
      pack: loadPack(eligibility.nganh || "giay-chay")
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
