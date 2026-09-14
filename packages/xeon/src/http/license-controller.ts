/**
 * @file `/license/*`: the doors the console and the landing installer use.
 *
 *   POST /license/kiem              console at start / every 6 hours: { key, maMay, tenMay } -> machine ticket
 *   POST /license/truc              console every 5 minutes: { key, maMay } -> { truc }
 *   POST /license/roi               console "leave this machine": { key, maMay }
 *   POST /license/landing-dang-ky   landing installer: { key, diaChi } -> public key + inbox token
 *   GET  /license/khoa-cong         Xeon's public signing key
 *
 * Every door is rate limited per address: 60 calls per 15 minutes is plenty for real machines.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import { PATHS } from "../protocol";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { sendJson, type RequestContext, type RequestController } from "./http-utils";
import { SlidingWindowRateLimiter } from "./rate-limiter";

export const LICENSE_RATE_LIMIT = { limit: 60, windowMs: 15 * 60 * 1000 };

export class LicenseController implements RequestController {
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(
    private readonly license: LicenseService | null,
    private readonly logger: Logger,
    clock: Clock
  ) {
    this.limiter = new SlidingWindowRateLimiter({ ...LICENSE_RATE_LIMIT, clock });
  }

  async handle(_req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!ctx.path.startsWith(PATHS.licensePrefix)) return false;
    if (this.license === null) { sendJson(res, 503, { ok: false, error: "license_chua_bat" }); return true; }
    if (!this.limiter.allow(ctx.ip)) { sendJson(res, 429, { ok: false, error: "qua_nhieu" }); return true; }

    if (ctx.method === "GET" && ctx.path === PATHS.licensePublicKey) {
      sendJson(res, 200, { ok: true, ...this.license.publicKey() });
      return true;
    }
    if (ctx.method !== "POST") { sendJson(res, 404, { ok: false, error: "khong_thay" }); return true; }
    const body = await ctx.readJson();
    if (body === null) return true;

    try {
      switch (ctx.path) {
        case PATHS.licenseCheck: {
          const result = await this.license.checkMachine({ key: body["key"], maMay: body["maMay"], tenMay: body["tenMay"] });
          sendJson(res, result.ok ? 200 : 403, result);
          return true;
        }
        case PATHS.licenseDuty: {
          const result = this.license.isOnDuty({ key: body["key"], maMay: body["maMay"] });
          sendJson(res, result.ok ? 200 : 403, result);
          return true;
        }
        case PATHS.licenseLeave: {
          const result = await this.license.leaveMachine({ key: body["key"], maMay: body["maMay"] });
          sendJson(res, result.ok ? 200 : 403, result);
          return true;
        }
        case PATHS.licenseLandingRegister: {
          const result = await this.license.registerLanding({ key: body["key"], diaChi: body["diaChi"] });
          sendJson(res, result.ok ? 200 : 403, result);
          return true;
        }
        default:
          sendJson(res, 404, { ok: false, error: "khong_thay" });
          return true;
      }
    } catch (error) {
      this.logger.warn(`[bo-nao] license ${ctx.path} hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
      return true;
    }
  }
}
