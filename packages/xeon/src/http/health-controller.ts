/**
 * @file `GET /health`: is Xeon alive, and how many merchants have a key.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import { PATHS } from "../protocol";
import type { Clock } from "../support/clock";
import { sendJson, type RequestContext, type RequestController } from "./http-utils";

export class HealthController implements RequestController {
  constructor(private readonly license: LicenseService | null, private readonly clock: Clock) {}

  async handle(_req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "GET" || ctx.path !== PATHS.health) return false;
    sendJson(res, 200, {
      ok: true,
      license: this.license !== null,
      soShop: this.license ? this.license.activeShopCount() : 0,
      luc: this.clock.now().toISOString()
    });
    return true;
  }
}
