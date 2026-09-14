/**
 * @file Gateway from the brain to ONE merchant's landing server.
 *
 * The engine never opens a connection; it receives PORTS. This class implements those ports over
 * the landing's HTTP API (decided 12/09/2026: data lives on the merchant's server). Swapping the
 * old TLS line for API calls did not touch a single line of the engine, which is the whole point
 * of the engine only knowing ports.
 *
 * One rule to keep: the brain does NOT retain merchant data. This gateway asks and forgets.
 * Conversation memory also lives on the landing (decided 14/09/2026); Xeon holds it only for the
 * duration of a turn.
 *
 * Behaviour (from the L5 iteration, 14/09/2026):
 *   - the tool list is READ FROM THE LANDING (`GET /api/bo-nao/cong-cu`) and refreshed every 5
 *     minutes; a module the merchant did not buy simply does not appear, so the bot never calls it;
 *   - `call` forwards the call context (conversation id + idempotency key) the engine provides;
 *   - `online()` reports offline for only 30 seconds after a failure, then lets the bot retry.
 */

import type { CatalogItemLite, LinkError, ToolInput, ToolName, ToolOutput } from "@sp/contract";
import type { CallCtx, CatalogPort, ConversationState, MemoryPort, ToolPort, ToolResult } from "@sp/brain";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

export const TOOL_LIST_TTL_MS = 5 * 60 * 1000;
export const OFFLINE_HOLD_MS = 30 * 1000;
/** Fallback list before the landing has ever answered, so the engine has something to start with. */
export const DEFAULT_TOOL_LIST: ToolName[] = ["catalog.search", "stock.lookup", "storefront.link"];

/** Subset of `fetch` the gateway needs; tests inject a fake. */
export type FetchLike = (url: string, init: {
  method: string;
  signal: AbortSignal;
  headers: Record<string, string>;
  body: string | undefined;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface LandingGatewayOptions {
  /** Origin of the merchant server, for example "https://toprun.site". */
  origin: string;
  /** Service ticket, or a function returning a fresh one when the current one nears expiry. */
  ticket: string | (() => string);
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
}

interface JsonReply {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  /** The request never reached the landing (network failure / timeout). */
  networkDown?: boolean;
}

/** Outbound reply to a customer, routed through the landing's inbox. */
export interface OutboundReply {
  kenh?: string | undefined;
  nguoi: string;
  chu: string;
}

/** Notification that the bot handed a conversation to a human. */
export interface HandoffNotice {
  kenh?: string | undefined;
  nguoi: string;
  maHoiThoai: string;
  lyDo: string;
  tinCuoi: string;
}

export class LandingGateway {
  readonly tools: ToolPort;
  readonly catalog: CatalogPort;
  readonly memory: MemoryPort;

  private readonly origin: string;
  private readonly ticket: () => string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly clock: Clock;

  private failedAt = 0;
  private toolList: ToolName[] = [...DEFAULT_TOOL_LIST];
  private toolListAt = 0;
  private toolListKnown = false;

  constructor(options: LandingGatewayOptions) {
    if (!options.origin) throw new Error("LandingGateway needs `origin`.");
    this.origin = options.origin.replace(/\/+$/, "");
    this.ticket = typeof options.ticket === "function" ? options.ticket : (() => options.ticket as string);
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger ?? { info: () => undefined, warn: () => undefined };
    this.clock = options.clock ?? { now: () => new Date() };

    this.tools = {
      available: () => [...this.toolList],
      online: () => this.isOnline(),
      call: <K extends ToolName>(tool: K, input: ToolInput<K>, ctx?: CallCtx | undefined) => this.callTool(tool, input, ctx)
    };

    // The engine keeps no catalog in memory any more; every turn asks the merchant server.
    // Slightly slower, but Xeon holds nothing.
    this.catalog = {
      search: async (_tenant, query, limit) => {
        const r = await this.invokeTool("catalog.search", { q: query, limit });
        return r.ok ? ((r.data as { items?: CatalogItemLite[] }).items ?? []) : [];
      },
      size: async () => {
        if (!this.toolList.includes("catalog.count" as ToolName)) return 0;
        const r = await this.invokeTool("catalog.count" as ToolName, {});
        return r.ok ? Number((r.data as { total?: unknown }).total) || 0 : 0;
      }
    };

    // Conversation memory lives on the landing: read before the turn, write after.
    this.memory = {
      load: async (_tenant, conversationId) => {
        const r = await this.requestJson(`/api/bo-nao/tri-nho/${encodeURIComponent(String(conversationId))}`);
        return r.ok && r.body["trangThai"] ? (r.body["trangThai"] as ConversationState) : null;
      },
      save: async (state) => {
        const r = await this.requestJson(`/api/bo-nao/tri-nho/${encodeURIComponent(String(state.conversationId))}`, { method: "PUT", body: { trangThai: state } });
        if (!r.ok) this.logger.warn(`[noi] khong ghi duoc tri nho ${state.conversationId}: ${String(r.body["error"] ?? r.status)}`);
      }
    };
  }

  /** Whether the landing is considered reachable. Offline lasts `OFFLINE_HOLD_MS` after a failure. */
  isOnline(): boolean {
    return this.failedAt === 0 || this.nowMs() - this.failedAt > OFFLINE_HOLD_MS;
  }

  /** Whether the tool list should be refreshed before the next turn. */
  toolListStale(): boolean {
    return !this.toolListKnown || this.nowMs() - this.toolListAt > TOOL_LIST_TTL_MS;
  }

  /** Asks the landing which tools are open. On failure the previous list is kept. */
  async refreshToolList(): Promise<ToolName[]> {
    const r = await this.requestJson("/api/bo-nao/cong-cu");
    const list = r.body["congCu"];
    if (r.ok && Array.isArray(list)) {
      this.toolList = list.map(String) as ToolName[];
      this.toolListAt = this.nowMs();
      this.toolListKnown = true;
    } else if (!this.toolListKnown) {
      this.logger.warn(`[noi] chua hoi duoc danh sach cong cu cua ${this.origin} — tam dung ban lui ${DEFAULT_TOOL_LIST.join(", ")}`);
    }
    return [...this.toolList];
  }

  /** Sends a reply to the customer through the landing's inbox; never calls Meta directly. */
  async sendReply(reply: OutboundReply): Promise<Record<string, unknown>> {
    const r = await this.requestJson("/api/hop-thu/gui", { method: "POST", body: { kenh: reply.kenh ?? "facebook", nguoi: reply.nguoi, chu: reply.chu } });
    if (!r.ok) throw new Error(String(r.body["message"] ?? r.body["error"] ?? `HTTP ${r.status}`));
    return r.body;
  }

  /** Tells the merchant a conversation needs a human. Never throws; failures are logged. */
  async notifyHandoff(notice: HandoffNotice): Promise<boolean> {
    const r = await this.requestJson("/api/hop-thu/can-nguoi", { method: "POST", body: notice });
    if (!r.ok) this.logger.warn(`[noi] khong bao duoc "can nguoi" cho ${notice.maHoiThoai}: ${String(r.body["error"] ?? r.status)}`);
    return r.ok;
  }

  get landingOrigin(): string {
    return this.origin;
  }

  // ---------------------------------------------------------------- internals

  private nowMs(): number {
    return this.clock.now().getTime();
  }

  private async callTool<K extends ToolName>(tool: K, input: ToolInput<K>, ctx?: CallCtx | undefined): Promise<ToolResult<K>> {
    const r = await this.invokeTool(tool, input, ctx);
    return r.ok ? { ok: true, tool, data: r.data as ToolOutput<K> } : { ok: false, tool, error: r.error };
  }

  private async invokeTool(tool: ToolName, input: unknown, ctx?: CallCtx | undefined): Promise<{ ok: true; data: unknown } | { ok: false; error: LinkError }> {
    const r = await this.requestJson("/api/bo-nao/cong-cu", { method: "POST", body: { ten: tool, input, nguCanh: ctx } });
    if (r.networkDown) return { ok: false, error: { code: "omi_offline", message: "Không hỏi được máy chủ của shop." } };
    if (!r.ok) return { ok: false, error: { code: "tool_unknown", message: String(r.body["message"] ?? r.body["error"] ?? `HTTP ${r.status}`) } };
    return { ok: true, data: r.body["data"] };
  }

  private async requestJson(path: string, options: { method?: string; body?: unknown } = {}): Promise<JsonReply> {
    const method = options.method ?? "GET";
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.origin}${path}`, {
        method,
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.ticket()}` },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const parsed = await response.json().catch(() => ({}));
      const body = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
      this.failedAt = 0;
      return { ok: response.ok && body["ok"] === true, status: response.status, body };
    } catch (error) {
      // Network failure: restricted mode for 30 seconds. SILENCE ABOUT NUMBERS BEATS A WRONG NUMBER.
      this.failedAt = this.nowMs();
      this.logger.warn(`[noi] ${method} ${path} that bai: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, status: 0, body: {}, networkDown: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
