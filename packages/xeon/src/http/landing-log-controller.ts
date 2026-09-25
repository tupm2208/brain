/**
 * @file `POST /nhat-ky/gom`: a landing pushes its own log lines up to Xeon (21/09/2026).
 *
 * WHY UP AND NOT DOWN. The landing runs on the shop's cPanel hosting with no terminal, and when it
 * dies there is nothing left to ask. Pushing means the last thing it said is already here.
 *
 * WHICH MERCHANT is derived from the PRIVATE INBOX TOKEN, exactly as `/tin-den` does it — never
 * read from the body. Reading it from the body would let one shop write into another's log, which
 * is the one thing that would make the whole record untrustworthy.
 *
 * This door is not the log VIEWER. `/nhat-ky` is public and shows Xeon's own ring buffer; what
 * arrives here goes to files, read with the `chan-doan` tool.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import type { LandingLogLine, LandingLogStore } from "../chan-doan/landing-log-store";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export const LANDING_LOG_PATH = "/nhat-ky/gom";
/** A batch body past this is refused outright, before parsing. */
export const MAX_LOG_BODY_BYTES = 512 * 1024;

export interface LandingLogControllerOptions {
  store: LandingLogStore | null;
  license: LicenseService | null;
  logger: Logger;
}

export class LandingLogController implements RequestController {
  constructor(private readonly options: LandingLogControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "POST" || ctx.path !== LANDING_LOG_PATH) return false;

    const { store, license } = this.options;
    if (store === null) {
      // Say it plainly: a landing pushing into the void should be able to tell.
      sendJson(res, 503, { ok: false, error: "chua_bat", message: "Xeon chưa bật kho nhật ký landing (XEON_NHAT_KY_THU_MUC)." });
      return true;
    }

    const token = bearerToken(req);
    const shop = token && license ? license.tenantForInboxToken(token) : null;
    if (shop === null) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    ctx.shop = shop;

    const body = await ctx.readJson(MAX_LOG_BODY_BYTES);
    if (body === null) return true;
    const lines = Array.isArray(body["muc"]) ? (body["muc"] as LandingLogLine[]) : [];
    if (lines.length === 0) { sendJson(res, 400, { ok: false, error: "thieu_muc" }); return true; }

    const daBo = Number(body["daBo"]) || 0;
    const result = await store.accept(shop, lines, { daBo });
    // The landing is told what was refused so its own log can say so, instead of losing lines silently.
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }
}
