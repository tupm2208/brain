/**
 * @file Meta's webhook for EVERY merchant, and the door where a landing connects its Fanpages.
 *
 *   GET  /meta/webhook   Meta confirms the address (`hub.verify_token`)
 *   POST /meta/webhook   Meta delivers messages and comments: signature checked with the app secret,
 *                        entries split by page id, each merchant's share handed to its landing
 *   GET  /meta/trang     a landing lists the pages routed to it          (Bearer: private inbox token)
 *   POST /meta/trang     a landing connects pages — Meta must confirm each token belongs to that page
 *   POST /meta/trang/ngat          a landing disconnects pages (Đ6): unsubscribed at Meta when a token rides along
 *   POST /meta/dang-nhap           a landing starts Facebook Login through the developer app (Đ6)
 *   GET  /meta/dang-nhap/xong      Meta sends the person back here with a one-time code
 *   GET  /meta/dang-nhap/ket-qua   the landing collects the pages (with their tokens) ONCE
 *
 * Decided 15/09/2026: ONE developer app for every merchant. Meta allows one webhook address per
 * app, so the address is Xeon's, the app secret lives only here, and a merchant never creates an
 * app. The landing keeps its inbox, threads and page tokens exactly as before; it only stops being
 * the address Meta calls.
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import type { MetaForwarder } from "../meta/meta-forwarder";
import type { MetaGraphClient } from "../meta/graph-client";
import { splitByPage, verifyMetaSignature, type PagePacket } from "../meta/meta-packet";
import { PATHS, type PageClaimOutcome } from "../protocol";
import type { ActivityLog } from "../support/activity-log";
import type { Logger } from "../support/logger";
import { bearerToken, readRawBody, sendJson, type RequestContext, type RequestController } from "./http-utils";

/** Pages a landing may connect in one call. */
export const PAGE_CLAIM_MAX = 50;

export interface MetaControllerOptions {
  license: LicenseService;
  forwarder: MetaForwarder;
  graph: MetaGraphClient;
  appSecret: string;
  verifyToken: string;
  /** App ID of the developer app — Facebook Login (Đ6). Empty = login refuses with 503. */
  appId?: string | undefined;
  /** Public address of Xeon: Meta redirects back to `<xeonAddress>/meta/dang-nhap/xong`. */
  xeonAddress?: string | undefined;
  logger: Logger;
  activityLog?: ActivityLog | undefined;
}

/** How long a Facebook Login session waits for the person and then for the landing to collect it. */
export const LOGIN_SESSION_TTL_MS = 15 * 60 * 1000;
/** Permissions the inbox needs: list pages, read and answer messages and comments, subscribe the page. */
export const LOGIN_SCOPES: readonly string[] = ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement", "pages_manage_engagement"];

interface LoginSession {
  shop: string;
  createdAt: number;
  pages: { ma: string; ten: string; token: string }[] | null;
  error: string;
}

export class MetaController implements RequestController {
  /** Facebook Login sessions by `state` — memory only: a restart just means "log in again". */
  private readonly logins = new Map<string, LoginSession>();

  /** Unknown pages are logged once each — Meta may send the same stranger page all day. */
  private readonly unknownPagesLogged = new Set<string>();

  constructor(private readonly options: MetaControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.path === PATHS.metaWebhook) {
      if (ctx.method === "GET") { this.confirmAddress(req, res); return true; }
      if (ctx.method === "POST") { await this.receive(req, res); return true; }
      return false;
    }
    if (ctx.path === PATHS.metaPages) {
      if (ctx.method === "GET") { this.listPages(req, res); return true; }
      if (ctx.method === "POST") { await this.connectPages(req, res, ctx); return true; }
    }
    if (ctx.path === PATHS.metaPagesDisconnect && ctx.method === "POST") { await this.disconnectPages(req, res, ctx); return true; }
    if (ctx.path === PATHS.metaLogin && ctx.method === "POST") { this.startLogin(req, res); return true; }
    if (ctx.path === PATHS.metaLoginDone && ctx.method === "GET") { await this.finishLogin(req, res); return true; }
    if (ctx.path === PATHS.metaLoginResult && ctx.method === "GET") { this.collectLogin(req, res); return true; }
    return false;
  }

  /** Meta checks the address once, when the webhook is registered. No token configured = refuse (fail closed). */
  private confirmAddress(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(String(req.url || "/"), "http://xeon.local");
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const matches = url.searchParams.get("hub.mode") === "subscribe" && this.options.verifyToken !== "" && constantTimeEqual(token, this.options.verifyToken);
    if (!matches) { sendJson(res, 403, { ok: false, error: "verify_token_khong_khop" }); return; }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(url.searchParams.get("hub.challenge") ?? "");
  }

  private async receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.options.appSecret) { sendJson(res, 503, { ok: false, error: "meta_chua_cau_hinh" }); return; }
    let raw: Buffer;
    try { raw = await readRawBody(req); } catch { sendJson(res, 413, { ok: false, error: "goi_qua_lon" }); return; }

    if (!verifyMetaSignature(raw, String(req.headers["x-hub-signature-256"] ?? ""), this.options.appSecret)) {
      this.options.logger.warn("[meta] chu ky khong khop — bo goi");
      sendJson(res, 401, { ok: false, error: "chu_ky_sai" });
      return;
    }
    let payload: unknown = null;
    try { payload = JSON.parse(raw.toString("utf8")); } catch { payload = null; }
    const byPage = splitByPage(payload);
    if (byPage === null) { sendJson(res, 400, { ok: false, error: "khong_phai_goi_trang" }); return; }

    // Waiting packets ride on this call — queued BEFORE today's deliveries, so a packet kept a moment
    // ago is not retried in the same breath.
    void this.options.forwarder.retryPending().catch((error: unknown) => {
      this.options.logger.warn(`[meta] chuyen bu hong: ${error instanceof Error ? error.message : String(error)}`);
    });

    const byShop = new Map<string, PagePacket>();
    let strangers = 0;
    for (const [pageId, packet] of byPage) {
      const shop = this.options.license.shopForPage(pageId);
      if (!shop) { strangers += packet.entry.length; this.noteUnknownPage(pageId); continue; }
      const merged = byShop.get(shop) ?? { object: "page" as const, entry: [] };
      merged.entry.push(...packet.entry);
      byShop.set(shop, merged);
    }
    const results = await Promise.all([...byShop].map(([shop, packet]) => this.options.forwarder.deliver(shop, packet)));
    const chuaChuyen = results.filter((r) => !r.ok).length;
    // Always 200 once the packet is split: a non-2xx makes Meta re-deliver every merchant's entries.
    sendJson(res, 200, { ok: true, soShop: byShop.size, chuaChuyen, trangLa: strangers });

    // Activity log: one entry per webhook call with the summary of what happened.
    this.options.activityLog?.add({
      huong: "in", loai: "meta-webhook", method: "POST", duong: "/meta/webhook",
      status: 200,
      tomTat: `${byPage.size} trang, ${byShop.size} shop, ${strangers} lạ, ${chuaChuyen} chưa chuyển`,
      chiTiet: { soTrang: byPage.size, soShop: byShop.size, trangLa: strangers, chuaChuyen, shops: [...byShop.keys()] },
    });
  }

  private listPages(req: IncomingMessage, res: ServerResponse): void {
    const shop = this.shopOfLanding(req, res);
    if (shop === null) return;
    sendJson(res, 200, { ok: true, trang: this.options.license.pagesOf(shop) });
  }

  private async connectPages(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
    const shop = this.shopOfLanding(req, res);
    if (shop === null) return;
    const body = await ctx.readJson();
    if (body === null) return;
    const list = Array.isArray(body["trang"]) ? (body["trang"] as unknown[]) : [];
    if (list.length === 0 || list.length > PAGE_CLAIM_MAX) {
      sendJson(res, 400, { ok: false, error: "can_danh_sach_trang", message: `Gửi từ 1 đến ${PAGE_CLAIM_MAX} trang, mỗi trang { ma, ten, token }.` });
      return;
    }
    const subscribe = body["dangKyNhanTin"] === true;
    const outcomes: PageClaimOutcome[] = [];
    const confirmed: { ma: string; ten: string }[] = [];

    for (const raw of list) {
      const item = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const ma = String(item["ma"] ?? "").trim();
      const token = String(item["token"] ?? "").trim();
      if (!ma || !token) { outcomes.push({ ma, ok: false, viSao: "thieu_ma_hoac_token" }); continue; }
      const owner = this.options.license.shopForPage(ma);
      if (owner !== null && owner !== shop) { outcomes.push({ ma, ok: false, viSao: "trang_thuoc_shop_khac" }); continue; }

      const page = await this.options.graph.pageOfToken(token);
      if (!page.ok) { outcomes.push({ ma, ok: false, viSao: "khong_hoi_duoc_meta", chiTiet: page.message }); continue; }
      if (page.value.id !== ma) { outcomes.push({ ma, ok: false, viSao: "token_khong_dung_trang" }); continue; }

      const ten = page.value.name || String(item["ten"] ?? "");
      let subscribed = false;
      let subscribeError = "";
      if (subscribe) {
        const s = await this.options.graph.subscribePage(ma, token);
        subscribed = s.ok;
        if (!s.ok) subscribeError = s.message;
      }
      confirmed.push({ ma, ten });
      outcomes.push({ ma, ok: true, ten, daDangKyNhanTin: subscribed, ...(subscribeError ? { loiDangKy: subscribeError } : {}) });
    }

    if (confirmed.length > 0) {
      const saved = await this.options.license.connectPages(shop, confirmed);
      for (const s of saved) {
        if (s.ok) continue;
        const index = outcomes.findIndex((o) => o.ma === s.ma);
        if (index >= 0) outcomes[index] = { ma: s.ma, ok: false, viSao: s.viSao ?? "trang_thuoc_shop_khac" };
      }
    }
    sendJson(res, 200, { ok: true, ketQua: outcomes });
  }

  private async disconnectPages(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
    const shop = this.shopOfLanding(req, res);
    if (shop === null) return;
    const body = await ctx.readJson();
    if (body === null) return;
    const list = (Array.isArray(body["trang"]) ? (body["trang"] as unknown[]) : []).slice(0, PAGE_CLAIM_MAX)
      .map((x) => (typeof x === "string" ? { ma: x } : (x ?? {})) as Record<string, unknown>)
      .map((x) => ({ ma: String(x["ma"] ?? "").trim(), token: String(x["token"] ?? "").trim() }))
      .filter((x) => x.ma !== "");
    if (list.length === 0) { sendJson(res, 400, { ok: false, error: "can_danh_sach_trang", message: "Chọn ít nhất một trang để ngắt." }); return; }
    const owned = new Set(this.options.license.pagesOf(shop).map((p) => p.ma));
    const huyDangKy: { ma: string; ok: boolean; loi?: string }[] = [];
    for (const page of list) {
      // Only a page THIS shop owns is unsubscribed — naming another shop's page changes nothing.
      if (!page.token || !owned.has(page.ma)) continue;
      const r = await this.options.graph.unsubscribePage(page.ma, page.token);
      huyDangKy.push(r.ok ? { ma: page.ma, ok: true } : { ma: page.ma, ok: false, loi: r.message });
    }
    const daNgat = await this.options.license.disconnectPages(shop, list.map((p) => p.ma));
    sendJson(res, 200, { ok: true, daNgat, huyDangKy });
  }

  /** Starts Facebook Login for the landing's shop: returns the dialog address the person opens. */
  private startLogin(req: IncomingMessage, res: ServerResponse): void {
    const shop = this.shopOfLanding(req, res);
    if (shop === null) return;
    const appId = String(this.options.appId ?? "");
    const base = String(this.options.xeonAddress ?? "").replace(/\/+$/, "");
    if (!appId || !this.options.appSecret || !base) {
      sendJson(res, 503, { ok: false, error: "dang_nhap_chua_cau_hinh", message: "Xeon chưa có FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / XEON_DIA_CHI — nhập Page Token thủ công." });
      return;
    }
    this.sweepLogins();
    const state = crypto.randomBytes(24).toString("base64url");
    this.logins.set(state, { shop, createdAt: Date.now(), pages: null, error: "" });
    const redirect = `${base}${PATHS.metaLoginDone}`;
    const url = `https://www.facebook.com/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(LOGIN_SCOPES.join(","))}&response_type=code`;
    sendJson(res, 200, { ok: true, url, maPhien: state, hetSauGiay: Math.round(LOGIN_SESSION_TTL_MS / 1000) });
  }

  /** Meta's redirect: exchange the code, read the pages, keep them for the landing to collect. */
  private async finishLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(String(req.url || "/"), "http://xeon.local");
    const session = this.logins.get(url.searchParams.get("state") ?? "");
    const page = (title: string, text: string, status = 200) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family:sans-serif;padding:32px"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></body>`);
    };
    if (!session || Date.now() - session.createdAt > LOGIN_SESSION_TTL_MS) { page("Phiên kết nối đã hết", "Quay lại OMI và bấm Kết nối page lần nữa.", 400); return; }
    const code = url.searchParams.get("code") ?? "";
    if (!code) {
      session.error = url.searchParams.get("error_description") ?? "Người dùng không cấp quyền.";
      page("Chưa kết nối", session.error, 400);
      return;
    }
    const token = await this.options.graph.exchangeCode({
      appId: String(this.options.appId ?? ""), appSecret: this.options.appSecret,
      redirectUri: `${String(this.options.xeonAddress ?? "").replace(/\/+$/, "")}${PATHS.metaLoginDone}`, code
    });
    if (!token.ok) { session.error = token.message; page("Chưa kết nối", `Meta không đổi được mã: ${token.message}`, 502); return; }
    const pages = await this.options.graph.pagesOfUser(token.value);
    if (!pages.ok) { session.error = pages.message; page("Chưa kết nối", `Không đọc được danh sách trang: ${pages.message}`, 502); return; }
    session.pages = pages.value.map((p) => ({ ma: p.id, ten: p.name, token: p.token }));
    page("Đã cấp quyền", `Đọc được ${session.pages.length} trang. Quay lại OMI và bấm "Hoàn tất kết nối".`);
  }

  /** The landing collects the pages of ITS login session — once; the tokens are then forgotten. */
  private collectLogin(req: IncomingMessage, res: ServerResponse): void {
    const shop = this.shopOfLanding(req, res);
    if (shop === null) return;
    const state = new URL(String(req.url || "/"), "http://xeon.local").searchParams.get("maPhien") ?? "";
    const session = this.logins.get(state);
    if (!session || session.shop !== shop || Date.now() - session.createdAt > LOGIN_SESSION_TTL_MS) {
      sendJson(res, 404, { ok: false, error: "khong_thay_phien", message: "Phiên kết nối không còn — bấm Kết nối page lần nữa." });
      return;
    }
    if (session.pages === null) { sendJson(res, 200, { ok: true, xong: false, loi: session.error }); return; }
    this.logins.delete(state);
    sendJson(res, 200, { ok: true, xong: true, trang: session.pages });
  }

  private sweepLogins(): void {
    const now = Date.now();
    for (const [state, session] of this.logins) if (now - session.createdAt > LOGIN_SESSION_TTL_MS) this.logins.delete(state);
  }

  /** The merchant a landing speaks for — from its private inbox token, never from the body. */
  private shopOfLanding(req: IncomingMessage, res: ServerResponse): string | null {
    const shop = this.options.license.tenantForInboxToken(bearerToken(req));
    if (shop === null) sendJson(res, 401, { ok: false, error: "thieu_ma" });
    return shop;
  }

  private noteUnknownPage(pageId: string): void {
    if (this.unknownPagesLogged.has(pageId)) return;
    this.unknownPagesLogged.add(pageId);
    this.options.logger.warn(`[meta] trang ${pageId} chua shop nao ket noi — bo cac tin cua trang nay`);
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, (c) => map[c] ?? c);
}
