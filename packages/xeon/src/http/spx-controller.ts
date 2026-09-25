/**
 * @file `POST /spx/ky` — Xeon signs an SPX request for a landing (decided 25/09/2026).
 *
 * SPX has two layers of keys. The APP (App ID + App Secret) is the developer's: one app for every
 * merchant, like the Meta app. The ACCOUNT (User ID + Secret Key) is the merchant's own and rides
 * inside the request body. Whatever the merchant does not need to see never goes onto the merchant's
 * hosting, so the App Secret lives only here: the landing sends the exact body it is about to post,
 * Xeon returns `app-id` + `check-sign`, and the landing calls SPX itself.
 *
 * A signature is only useful together with a real SPX account in the body, so the door is guarded
 * by the landing's private inbox token (shop from the token) and a per-shop budget, nothing more.
 */

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export const SPX_SIGN_PATH = "/spx/ky";
/** Largest body a landing may ask to sign (a batch of 50 orders stays far below). */
export const SPX_SIGN_MAX_BYTES = 512 * 1024;
/** Signatures per shop per window — a batch of 50 plus a 200-parcel tracking sync fit many times over. */
export const SPX_SIGN_BUDGET = 3000;
export const SPX_SIGN_WINDOW_MS = 10 * 60 * 1000;

export interface SpxControllerOptions {
  license: LicenseService | null;
  appId: string;
  appSecret: string;
  clock: Clock;
  logger: Logger;
}

/** The `check-sign` header SPX expects: HMAC-SHA256 over `appId_timestamp_nonce_body`. Same as the landing's `signSpx`. */
export function signSpxBody(appId: string, appSecret: string, timestamp: number, nonce: number, body: string): string {
  return crypto.createHmac("sha256", appSecret).update(`${appId}_${timestamp}_${nonce}_${body}`, "utf8").digest("hex");
}

export class SpxController implements RequestController {
  /** Signatures handed out per shop in the current window — memory only. */
  private readonly spent = new Map<string, { since: number; count: number }>();

  constructor(private readonly options: SpxControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.path !== SPX_SIGN_PATH) return false;
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }
    const license = this.options.license;
    const shop = license ? license.tenantForInboxToken(bearerToken(req)) : null;
    if (!license || !shop) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    ctx.shop = shop;
    const body = await ctx.readJson(SPX_SIGN_MAX_BYTES);
    if (body === null) return true;

    if (!this.options.appId || !this.options.appSecret) {
      sendJson(res, 503, { ok: false, error: "spx_chua_cau_hinh_xeon", message: "Xeon chưa có App ID / App Secret SPX của nhà phát triển (SPX_APP_ID, SPX_APP_SECRET) — báo nhà cung cấp." });
      return true;
    }
    const timestamp = Number(body["timestamp"]);
    const nonce = Number(body["nonce"]);
    const text = body["body"];
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isSafeInteger(nonce) || nonce <= 0 || typeof text !== "string" || text === "") {
      sendJson(res, 400, { ok: false, error: "thieu_du_lieu_ky", message: "Cần timestamp, nonce (số nguyên dương) và body (chuỗi JSON sẽ gửi SPX)." });
      return true;
    }
    // A timestamp far from now is either a broken clock or a replay being prepared; SPX refuses both anyway.
    if (Math.abs(this.options.clock.now().getTime() / 1000 - timestamp) > 15 * 60) {
      sendJson(res, 400, { ok: false, error: "gio_lech", message: "Giờ của landing lệch quá 15 phút so với Xeon — chỉnh đồng hồ máy chủ." });
      return true;
    }
    if (!this.take(shop)) {
      sendJson(res, 429, { ok: false, error: "qua_nhieu", message: "Landing xin chữ ký SPX quá nhiều trong 10 phút — thử lại sau." });
      return true;
    }
    sendJson(res, 200, { ok: true, appId: this.options.appId, checkSign: signSpxBody(this.options.appId, this.options.appSecret, timestamp, nonce, text) }, { "Cache-Control": "no-store" });
    return true;
  }

  private take(shop: string): boolean {
    const now = this.options.clock.now().getTime();
    const current = this.spent.get(shop);
    if (current === undefined || now - current.since > SPX_SIGN_WINDOW_MS) {
      this.spent.set(shop, { since: now, count: 1 });
      return true;
    }
    if (current.count >= SPX_SIGN_BUDGET) {
      if (current.count === SPX_SIGN_BUDGET) this.options.logger.warn(`[spx] shop ${shop} het luot ky trong 10 phut`);
      current.count += 1;
      return false;
    }
    current.count += 1;
    return true;
  }
}
