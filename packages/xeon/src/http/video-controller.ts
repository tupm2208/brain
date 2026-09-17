/**
 * @file `POST /video/ve` — a landing asks Xeon for a Video Studio ticket on behalf of its OMI (Đ9).
 *
 * Same door as `/noi-dung/*`: the landing's private inbox token, shop from the token. The reply is
 * the address OMI opens in its own window; the ticket inside it lives five minutes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { issueStudioTicket } from "../video/studio-ticket";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export const VIDEO_TICKET_PATH = "/video/ve";

export interface VideoControllerOptions {
  license: LicenseService | null;
  /** Public address of the Video Studio service (`XEON_VIDEO_DIA_CHI`). Empty = not running. */
  studioAddress: string;
  clock: Clock;
  logger: Logger;
}

export class VideoController implements RequestController {
  constructor(private readonly options: VideoControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.path !== VIDEO_TICKET_PATH) return false;
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }
    const license = this.options.license;
    const shop = license ? license.tenantForInboxToken(bearerToken(req)) : null;
    if (!license || !shop) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    if (await ctx.readJson() === null) return true;
    const address = this.options.studioAddress.replace(/\/+$/, "");
    if (!address) {
      sendJson(res, 503, { ok: false, error: "video_chua_bat", message: "Video Studio chưa bật trên Xeon (thiếu XEON_VIDEO_DIA_CHI) — báo nhà cung cấp." });
      return true;
    }
    const { keyId } = license.publicKey();
    const ticket = issueStudioTicket({ shop, now: this.options.clock.now(), keyId, sign: (t) => license.signDetached(t) });
    this.options.logger.info(`[video] shop "${shop}" xin ve Video Studio`);
    sendJson(res, 200, { ok: true, diaChi: `${address}/video-studio/?ve=${encodeURIComponent(ticket.ve)}`, hetLuc: new Date(ticket.hetLuc).toISOString() });
    return true;
  }
}
