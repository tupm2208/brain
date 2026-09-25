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
import type { InboxSendBody, InboxSentExtras } from "@sp/contract";
import type { CallCtx, CatalogPort, ConversationState, MemoryPort, ToolPort, ToolResult } from "@sp/brain";
import { currentTrace, traceHeaders } from "../chan-doan/trace-context";
import type { ActivityLog } from "../support/activity-log";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

export const TOOL_LIST_TTL_MS = 5 * 60 * 1000;
export const OFFLINE_HOLD_MS = 30 * 1000;

/**
 * GỌI LẠI KHI ĐƯỜNG TRUYỀN TRỤC TRẶC (21/09/2026).
 *
 * Bộ não và landing của shop nói chuyện qua Internet — thật sự là qua Cloudflare, kể cả khi hai
 * bên tình cờ nằm chung một máy. Một cú nghẽn vài chục giây là chuyện của hạ tầng, không phải của
 * shop; nhưng HẬU QUẢ thì rơi đúng vào khách: hỏng lần hỏi danh sách công cụ là agent bị bỏ qua
 * (nó cần `catalog.find` + `conversation.recent`, hai thứ không có trong danh sách dự phòng), và
 * khách nhận một câu cụt lủn của máy luật thay vì câu tư vấn.
 *
 * Vì vậy: những lời gọi CHỈ ĐỌC được gọi lại. Cái gì có hiệu ứng ra ngoài — gửi tin cho khách —
 * thì KHÔNG, vì gửi lại một tin đã tới là khách đọc hai lần cùng một câu.
 */
export const RETRY_DELAYS_MS = [400, 1_200] as const;
/** Mã HTTP nghĩa là "chưa tới nơi hoặc chưa trả lời được", gọi lại thì hợp lý. */
export const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
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
  activityLog?: ActivityLog | undefined;
  /** Which merchant this gateway serves. Put on every logged call so the buffer shares out fairly. */
  shop?: string | undefined;
  /** Số lần gọi LẠI cho lời gọi chỉ đọc (mặc định 2 — tổng cộng 3 lần thử). */
  retries?: number | undefined;
  /** Chờ bao lâu giữa các lần; bài kiểm tra tiêm hàm ngủ giả để chạy tức thì. */
  retryDelaysMs?: readonly number[] | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

interface JsonReply {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  /** The request never reached the landing (network failure / timeout). */
  networkDown?: boolean;
}

/** Outbound reply to a customer, routed through the landing's inbox. */
/**
 * What the brain asks the landing to send: the text, and since Giai đoạn 7 (25/09/2026) the extras
 * the LANDING composes and sends — product cards, the order form, the measuring guide, the AI
 * greeting (`InboxSendBody` of the contract, spread here so a call site reads the wire names).
 */
export interface OutboundReply extends InboxSendBody {
  kenh?: string | undefined;
  nguoi: string;
  chu: string;
  /** Comment channel: the comment the reply goes under. */
  traLoiTin?: string | undefined;
  /** The conversation (`<kênh>:<người>`), so the landing finds the thread — and its Fanpage — directly. */
  maHoiThoai?: string | undefined;
}

/** What the landing answered: Meta's fields, and `daGui` — which extras really went. */
export type OutboundResult = Record<string, unknown> & { daGui?: InboxSentExtras | undefined };

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
  private readonly shop: string | undefined;
  private readonly ticket: () => string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly activityLog: ActivityLog | undefined;
  private readonly retries: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;

  private failedAt = 0;
  private toolList: ToolName[] = [...DEFAULT_TOOL_LIST];
  private toolListAt = 0;
  private toolListKnown = false;

  constructor(options: LandingGatewayOptions) {
    if (!options.origin) throw new Error("LandingGateway needs `origin`.");
    this.origin = options.origin.replace(/\/+$/, "");
    this.shop = options.shop;
    this.ticket = typeof options.ticket === "function" ? options.ticket : (() => options.ticket as string);
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    // 30 s: the agent's stock finder reads the whole catalogue on its first call after a landing
    // start (5k items took over 10 s on 16/09/2026 and the call was aborted mid-answer).
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.logger = options.logger ?? { info: () => undefined, warn: () => undefined };
    this.clock = options.clock ?? { now: () => new Date() };
    this.activityLog = options.activityLog;
    this.retries = Math.max(0, options.retries ?? RETRY_DELAYS_MS.length);
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));

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
        const r = await this.requestJson(`/api/bo-nao/tri-nho/${encodeURIComponent(String(conversationId))}`, { chiDoc: true });
        return r.ok && r.body["trangThai"] ? (r.body["trangThai"] as ConversationState) : null;
      },
      save: async (state) => {
        // PUT đặt LẠI cả trạng thái theo mã hội thoại: gọi hai lần cũng ra đúng một kết quả.
        const r = await this.requestJson(`/api/bo-nao/tri-nho/${encodeURIComponent(String(state.conversationId))}`, { method: "PUT", body: { trangThai: state }, chiDoc: true });
        if (!r.ok) this.logger.warn(`[noi] khong ghi duoc tri nho ${state.conversationId}: ${String(r.body["error"] ?? r.status)}`);
      }
    };
  }

  /** Whether the landing is considered reachable. Offline lasts `OFFLINE_HOLD_MS` after a failure. */
  isOnline(): boolean {
    return this.failedAt === 0 || this.nowMs() - this.failedAt > OFFLINE_HOLD_MS;
  }

  /** Whether the tool list should be refreshed before the next turn. */
  /** Danh sách công cụ đã hỏi được landing lần nào chưa (false = đang dùng bản lui). */
  toolListConfirmed(): boolean {
    return this.toolListKnown;
  }

  toolListStale(): boolean {
    return !this.toolListKnown || this.nowMs() - this.toolListAt > TOOL_LIST_TTL_MS;
  }

  /** Asks the landing which tools are open. On failure the previous list is kept. */
  async refreshToolList(): Promise<ToolName[]> {
    const r = await this.requestJson("/api/bo-nao/cong-cu", { chiDoc: true });
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
  async sendReply(reply: OutboundReply): Promise<OutboundResult> {
    const body: Record<string, unknown> = { kenh: reply.kenh ?? "facebook", nguoi: reply.nguoi, chu: reply.chu };
    // A comment reply goes UNDER that comment; without its id the landing refuses (15/09/2026).
    if (reply.traLoiTin) body["traLoiTin"] = reply.traLoiTin;
    if (reply.maHoiThoai) body["maHoiThoai"] = reply.maHoiThoai;
    // Giai đoạn 7: the extras, only when asked for — a body without them behaves exactly as before.
    if (reply.anhUrl) body["anhUrl"] = reply.anhUrl;
    if (reply.theSanPham && reply.theSanPham.length > 0) body["theSanPham"] = reply.theSanPham;
    if (reply.linkLoc) body["linkLoc"] = reply.linkLoc;
    if (reply.phieuDatHang) body["phieuDatHang"] = reply.phieuDatHang;
    if (reply.anhHuongDan) body["anhHuongDan"] = reply.anhHuongDan;
    if (reply.chaoAi === true) body["chaoAi"] = true;
    // KHÔNG gọi lại: landing chưa có khoá chống trùng cho việc gửi, mà gửi lại một tin đã tới là
    // khách đọc hai lần cùng một câu. Hỏng thì ném lỗi để lượt đó được ghi là hỏng.
    const r = await this.requestJson("/api/hop-thu/gui", { method: "POST", body });
    if (!r.ok) throw new Error(String(r.body["message"] ?? r.body["error"] ?? `HTTP ${r.status}`));
    return r.body;
  }

  /**
   * Hands one Meta packet (entries of this merchant's pages only) to the landing's inbox. The landing
   * files it exactly as if Meta had called it, trusting Xeon's service ticket instead of Meta's signature.
   */
  async forwardMetaPacket(packet: unknown): Promise<{ ok: true } | { ok: false; viSao: string }> {
    // Gói Meta CHUYỂN LẠI ĐƯỢC: landing bỏ qua tin đã có trong hội thoại theo `maTin`
    // (hop-thu/module.ts `acceptPagePacket`), nên gói tới hai lần cũng chỉ vào sổ một lần — còn
    // gói KHÔNG tới là mất hẳn một câu của khách.
    const r = await this.requestJson("/api/hop-thu/meta-tu-xeon", { method: "POST", body: { goi: packet }, chiDoc: true });
    if (r.ok) return { ok: true };
    return { ok: false, viSao: r.networkDown ? "landing_khong_tra_loi" : String(r.body["error"] ?? `HTTP ${r.status}`) };
  }

  /** Tells the merchant a conversation needs a human. Never throws; failures are logged. */
  async notifyHandoff(notice: HandoffNotice): Promise<boolean> {
    // Landing THAY dòng cũ của cùng hội thoại chứ không nối thêm, nên báo lại không sinh hai dòng.
    const r = await this.requestJson("/api/hop-thu/can-nguoi", { method: "POST", body: notice, chiDoc: true });
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
    // `chiDoc`: cả 16 công cụ trong sổ của landing đều là TRA CỨU (cong-bo-nao/tool-handlers.ts:
    // search / lookup / track / get / recent / count…). Không cái nào tạo đơn hay trừ tồn, nên gọi
    // lại lần hai không đổi gì bên kia. Thêm một công cụ có ghi thì phải xét lại chỗ này.
    const r = await this.requestJson("/api/bo-nao/cong-cu", { method: "POST", body: { ten: tool, input, nguCanh: ctx }, chiDoc: true });
    if (r.networkDown) return { ok: false, error: { code: "omi_offline", message: "Không hỏi được máy chủ của shop." } };
    if (!r.ok) return { ok: false, error: { code: "tool_unknown", message: String(r.body["message"] ?? r.body["error"] ?? `HTTP ${r.status}`) } };
    return { ok: true, data: r.body["data"] };
  }

  /**
   * Gọi landing. `chiDoc` = lời gọi không đổi gì bên kia, nên hỏng vì đường truyền thì GỌI LẠI.
   *
   * Không gọi lại khi landing đã trả lời tử tế (kể cả trả lời "không" — 400/401/404): gọi lại chỉ
   * lặp lại đúng câu trả lời đó. Chỉ gọi lại khi CHƯA CÓ câu trả lời (mạng hỏng, quá hạn) hoặc khi
   * mã trả về nói rằng hạ tầng chưa chuyển được lời gọi tới nơi (`RETRY_STATUSES`).
   */
  private async requestJson(path: string, options: { method?: string; body?: unknown; chiDoc?: boolean } = {}): Promise<JsonReply> {
    const lanToiDa = options.chiDoc === true ? this.retries + 1 : 1;
    let reply: JsonReply = { ok: false, status: 0, body: {}, networkDown: true };
    for (let lan = 1; lan <= lanToiDa; lan += 1) {
      reply = await this.requestOnce(path, options);
      const nenGoiLai = reply.networkDown === true || RETRY_STATUSES.has(reply.status);
      if (!nenGoiLai || lan === lanToiDa) break;
      const cho = this.retryDelaysMs[Math.min(lan - 1, this.retryDelaysMs.length - 1)] ?? 0;
      this.logger.warn(`[noi] ${options.method ?? "GET"} ${path} hong lan ${lan}/${lanToiDa} (${reply.networkDown ? "mang" : `HTTP ${reply.status}`}) — cho ${cho}ms roi goi lai`);
      await this.sleep(cho);
    }
    return reply;
  }

  private async requestOnce(path: string, options: { method?: string; body?: unknown } = {}): Promise<JsonReply> {
    const method = options.method ?? "GET";
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    const start = Date.now();
    try {
      const response = await this.fetchImpl(`${this.origin}${path}`, {
        method,
        signal: abort.signal,
        // MÃ VẾT goes out with the call so the landing logs its half under the same id.
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.ticket()}`, ...traceHeaders() },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const parsed = await response.json().catch(() => ({}));
      const body = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
      this.failedAt = 0;
      const reply: JsonReply = { ok: response.ok && body["ok"] === true, status: response.status, body };
      this.activityLog?.add({
        huong: "out", loai: "goi-landing", method, duong: path,
        ...(this.shop !== undefined ? { shop: this.shop } : {}), ...(currentTrace() !== null ? { vet: currentTrace()! } : {}),
        status: response.status, ms: Date.now() - start,
        tomTat: reply.ok ? "ok" : String(body["error"] ?? `HTTP ${response.status}`),
      });
      return reply;
    } catch (error) {
      // Network failure: restricted mode for 30 seconds. SILENCE ABOUT NUMBERS BEATS A WRONG NUMBER.
      this.failedAt = this.nowMs();
      this.logger.warn(`[noi] ${method} ${path} that bai: ${error instanceof Error ? error.message : String(error)}`);
      this.activityLog?.add({
        huong: "out", loai: "goi-landing", method, duong: path,
        status: 0, ms: Date.now() - start,
        tomTat: `lỗi mạng: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { ok: false, status: 0, body: {}, networkDown: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
