/**
 * @file THE VIDEO STUDIO SERVICE — a separate process on Xeon (Đ9).
 *
 * Sales Desk's "Video Studio" screen was an iframe onto a tool (`toprun-video-studio`, port 4180)
 * behind Desk's reverse proxy (`video_studio_proxy.js`): the tool turns a Content post into a 9:16
 * video with voice-over, beat-synced music and transitions. On the platform the tool stays a tool;
 * this service is the door in front of it:
 *
 *   GET /video-studio/?ve=VS1…   verify the ticket with Xeon's PUBLIC key, burn it (one use), set a
 *                                signed session cookie, redirect to /video-studio/
 *   GET|POST /video-studio/…     with a valid session: forwarded to the tool (prefix stripped, the
 *                                shop in `X-Omi-Shop`); tool down = a page that says so
 *   GET /health                  liveness
 *
 * No session, no ticket → 401 page. The tool itself never sees a licence, a key or a machine ticket.
 */

import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { verifyStudioTicket } from "./studio-ticket";

export const STUDIO_PREFIX = "/video-studio";
export const STUDIO_SESSION_COOKIE = "vs_phien";
export const STUDIO_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Forwards one request to the tool. Injected so tests run without a socket. */
export type StudioForward = (input: { method: string; path: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;

export interface StudioServiceOptions {
  publicKeyForKeyId: (keyId: string) => string | null;
  clock: Clock;
  logger: Logger;
  /** Address of the tool (`http://127.0.0.1:4180`). Empty = skeleton mode: the page says the tool is not installed. */
  upstream: string;
  forward?: StudioForward | undefined;
  /** Session signing secret; random per start when absent (sessions then end with the process). */
  sessionSecret?: string | undefined;
  https?: boolean | undefined;
}

const SKIP_HEADERS = new Set(["host", "connection", "cookie", "content-length", "authorization"]);
const page = (title: string, body: string): string =>
  `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

function httpForward(upstream: string): StudioForward {
  return (input) => new Promise((resolve, reject) => {
    const target = new URL(input.path, upstream);
    const request = http.request(target, { method: input.method, headers: input.headers, timeout: 60_000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (c: Buffer) => chunks.push(c));
      response.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers)) if (v !== undefined && !["connection", "transfer-encoding"].includes(k)) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
        resolve({ status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks) });
      });
    });
    request.on("timeout", () => request.destroy(new Error("tool khong tra loi")));
    request.on("error", reject);
    request.end(input.body);
  });
}

export class VideoStudioService {
  private readonly secret: string;
  private readonly used = new Map<string, number>();
  private readonly forward: StudioForward | null;

  constructor(private readonly options: StudioServiceOptions) {
    this.secret = options.sessionSecret || crypto.randomBytes(32).toString("hex");
    this.forward = options.forward ?? (options.upstream ? httpForward(options.upstream) : null);
  }

  private sign(value: string): string {
    return crypto.createHmac("sha256", this.secret).update(value).digest("base64url");
  }

  /** `shop|expiresAt|signature`, or null. */
  sessionShop(req: IncomingMessage): string | null {
    const raw = String(req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(`${STUDIO_SESSION_COOKIE}=`));
    if (!raw) return null;
    const [shop, exp, sig] = decodeURIComponent(raw.slice(STUDIO_SESSION_COOKIE.length + 1)).split("|");
    if (!shop || !exp || !sig) return null;
    const expected = this.sign(`${shop}|${exp}`);
    if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    return Number(exp) > this.options.clock.now().getTime() ? shop : null;
  }

  private send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
    res.end(html);
  }

  async handle(req: IncomingMessage, res: ServerResponse, body: Buffer = Buffer.alloc(0)): Promise<void> {
    const url = new URL(String(req.url || "/"), "http://studio.local");
    if (url.pathname === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, congCu: this.forward !== null })); return; }
    if (url.pathname !== STUDIO_PREFIX && !url.pathname.startsWith(`${STUDIO_PREFIX}/`)) { this.send(res, 404, page("Không có trang này", "Video Studio nằm ở /video-studio/.")); return; }

    const now = this.options.clock.now().getTime();
    const ticket = url.searchParams.get("ve");
    if (ticket) {
      for (const [nonce, until] of this.used) if (until < now) this.used.delete(nonce);
      const check = verifyStudioTicket(ticket, { publicKeyForKeyId: this.options.publicKeyForKeyId, now: this.options.clock.now() });
      if (!check.ok) { this.options.logger.warn(`[video-studio] ve bi tu choi: ${check.viSao}`); this.send(res, 401, page("Vé không dùng được", `Vé mở Video Studio không hợp lệ (${check.viSao}). Bấm lại nút Video Studio trong OMI.`)); return; }
      if (this.used.has(check.body.nonce)) { this.send(res, 401, page("Vé đã dùng", "Mỗi vé chỉ mở được một lần. Bấm lại nút Video Studio trong OMI.")); return; }
      this.used.set(check.body.nonce, check.body.hetLuc);
      const exp = String(now + STUDIO_SESSION_TTL_MS);
      const cookie = `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(`${check.body.shop}|${exp}|${this.sign(`${check.body.shop}|${exp}`)}`)}; Path=${STUDIO_PREFIX}; HttpOnly; SameSite=Lax${this.options.https ? "; Secure" : ""}; Max-Age=${Math.floor(STUDIO_SESSION_TTL_MS / 1000)}`;
      this.options.logger.info(`[video-studio] shop "${check.body.shop}" mo Video Studio`);
      res.writeHead(302, { Location: `${STUDIO_PREFIX}/`, "Set-Cookie": cookie, "Cache-Control": "no-store" });
      res.end();
      return;
    }

    const shop = this.sessionShop(req);
    if (!shop) { this.send(res, 401, page("Cần mở từ OMI", "Video Studio chỉ mở được bằng nút Video Studio trong OMI (vé ngắn hạn do Xeon ký).")); return; }
    if (this.forward === null) {
      this.send(res, 200, page("Video Studio", `Shop "${shop}" đã vào được Video Studio, nhưng công cụ dựng video chưa cài trên Xeon (thiếu XEON_VIDEO_CONG_CU). Báo nhà cung cấp.`));
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !SKIP_HEADERS.has(k)) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
    headers["x-omi-shop"] = shop;
    const rest = url.pathname.slice(STUDIO_PREFIX.length) || "/";
    try {
      const answer = await this.forward({ method: req.method || "GET", path: `${rest}${url.search}`, headers, body });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    } catch (e) {
      this.options.logger.warn(`[video-studio] cong cu khong tra loi: ${e instanceof Error ? e.message : String(e)}`);
      this.send(res, 502, page("Công cụ video chưa chạy", "Công cụ dựng video trên Xeon chưa bật hoặc đang khởi động. Thử lại sau ít phút."));
    }
  }

  server(): http.Server {
    return http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => { size += c.length; if (size > 50 * 1024 * 1024) { req.destroy(); return; } chunks.push(c); });
      req.on("end", () => { void this.handle(req, res, Buffer.concat(chunks)); });
    });
  }
}
