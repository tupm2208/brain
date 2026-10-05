/**
 * @file `/nganh/mac-dinh-web` — the shop's INDUSTRY default wording for its website (02/10/2026).
 *
 * Same door as `/kho/*`: the landing carries its PRIVATE INBOX TOKEN, the shop comes from the token
 * and its industry from the licence — never from the body, so a shop cannot read another
 * industry's wording by naming it. Nothing is stored: the landing caches the answer and falls back
 * to the platform's neutral sentence when Xeon cannot be reached.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import type { WebDefaultsLibrary } from "../knowledge/web-defaults";
import { PATHS } from "../protocol";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface IndustryDefaultsControllerOptions {
  library: WebDefaultsLibrary;
  /** The industry of a merchant Xeon serves; `null` when it serves none (no key, locked, expired). */
  industryOf: (tenant: string) => string | null;
  license: LicenseService | null;
  sharedToken?: string | undefined;
  logger: Logger;
}

export class IndustryDefaultsController implements RequestController {
  constructor(private readonly options: IndustryDefaultsControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.path !== PATHS.industryWebDefaults) return false;
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }
    const token = bearerToken(req);
    if (!token) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    let tenant = this.options.license ? this.options.license.tenantForInboxToken(token) : null;
    const shared = this.options.sharedToken ?? "";
    const viaSharedToken = tenant === null && shared !== "" && constantTimeEqual(token, shared);
    if (tenant === null && !viaSharedToken) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    const body = await ctx.readJson();
    if (body === null) return true;
    if (viaSharedToken) tenant = String(body["tenant"] ?? "").trim().slice(0, 64);
    else if (body["tenant"] && String(body["tenant"]) !== tenant) { sendJson(res, 403, { ok: false, error: "tenant_khong_khop" }); return true; }
    const shop = String(tenant || "");
    if (!shop) { sendJson(res, 400, { ok: false, error: "thieu_tenant" }); return true; }
    try {
      const industry = this.options.industryOf(shop);
      if (industry === null) {
        sendJson(res, 403, { ok: false, error: "khong_phuc_vu_shop", message: "Xeon không phục vụ shop này (key khoá / hết hạn / chưa đăng ký)." });
        return true;
      }
      const found = this.options.library.forIndustry(industry);
      if (found.problems.length > 0) this.options.logger.warn(`[nganh] cau chu web cua nganh "${industry}" co cho sai:\n- ${found.problems.join("\n- ")}`);
      sendJson(res, 200, { ok: true, nganh: industry, noiDungWeb: found.noiDungWeb });
      return true;
    } catch (error) {
      this.options.logger.warn(`[nganh] ${ctx.path} hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
      return true;
    }
  }
}
