/**
 * @file `GET /health`: is Xeon alive, how many merchants have a key, and anything else the
 * composition root wants visible (the Meta webhook's state).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import { PATHS } from "../protocol";
import type { Clock } from "../support/clock";
import { sendJson, type RequestContext, type RequestController } from "./http-utils";

export class HealthController implements RequestController {
  constructor(
    private readonly license: LicenseService | null,
    private readonly clock: Clock,
    /** Extra fields merged into the reply. Never secrets: `/health` is public. */
    private readonly extra: () => Record<string, unknown> = () => ({})
  ) {}

  async handle(_req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "GET" || ctx.path !== PATHS.health) return false;
    sendJson(res, 200, {
      ok: true,
      license: this.license !== null,
      soShop: this.license ? this.license.activeShopCount() : 0,
      ...this.extra(),
      luc: this.clock.now().toISOString()
    });
    return true;
  }
}
