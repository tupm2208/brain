/**
 * @file Meta's webhook for EVERY merchant, and the door where a landing connects its Fanpages.
 *
 *   GET  /meta/webhook   Meta confirms the address (`hub.verify_token`)
 *   POST /meta/webhook   Meta delivers messages and comments: signature checked with the app secret,
 *                        entries split by page id, each merchant's share handed to its landing
 *   GET  /meta/trang     a landing lists the pages routed to it          (Bearer: private inbox token)
 *   POST /meta/trang     a landing connects pages — Meta must confirm each token belongs to that page
 *
 * Decided 15/09/2026: ONE developer app for every merchant. Meta allows one webhook address per
 * app, so the address is Xeon's, the app secret lives only here, and a merchant never creates an
 * app. The landing keeps its inbox, threads and page tokens exactly as before; it only stops being
 * the address Meta calls.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import type { MetaForwarder } from "../meta/meta-forwarder";
import type { MetaGraphClient } from "../meta/graph-client";
import { splitByPage, verifyMetaSignature, type PagePacket } from "../meta/meta-packet";
import { PATHS, type PageClaimOutcome } from "../protocol";
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
  logger: Logger;
}

export class MetaController implements RequestController {
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
    // Always 200 once the packet is split: a non-2xx makes Meta re-deliver every merchant's entries.
    sendJson(res, 200, { ok: true, soShop: byShop.size, chuaChuyen: results.filter((r) => !r.ok).length, trangLa: strangers });
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
