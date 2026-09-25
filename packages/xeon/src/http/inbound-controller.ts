/**
 * @file `POST /tin-den`: a customer message forwarded by a merchant's landing.
 *
 * Path of one message:
 *   customer messages the Fanpage -> Meta -> the landing's inbox (signature checked) -> POST /tin-den
 *   -> the engine answers (asking the landing for live data) -> POST <landing>/api/hop-thu/gui
 *
 * ONE SERVER SERVES MANY MERCHANTS. The landing authenticates with its PRIVATE INBOX TOKEN
 * (issued at registration); the merchant is derived from the token, NEVER read from the body.
 * Reading it from the body would let merchant A impersonate merchant B and read B's conversations.
 *
 * Three things the brain never does:
 *   - carry phone numbers, addresses or purchase history in CONVERSATION MEMORY (redacted before
 *     writing). Since 21/09/2026 the TURN DOSSIER does keep some of it, on a deadline, so a bug can
 *     be reproduced — a deliberate operational step, off unless `XEON_HO_SO_THU_MUC` is set;
 *   - call Meta itself (replies go through the landing's inbox);
 *   - move money (no bot tool has a money effect).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import { PATHS, type InboundMessageBody, type InboundResult } from "../protocol";
import type { ActivityLog } from "../support/activity-log";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

/** The part of `BrainService` this controller needs. */
export interface InboundHandler {
  handleInbound(message: InboundMessageBody & { tenant: string }): Promise<InboundResult>;
}

export interface InboundControllerOptions {
  brain: InboundHandler;
  license: LicenseService | null;
  /** LEGACY, trials only: one shared token for every merchant; the tenant is then read from the body. */
  sharedToken?: string | undefined;
  logger: Logger;
  activityLog?: ActivityLog | undefined;
}

export class InboundController implements RequestController {
  private readonly brain: InboundHandler;
  private readonly license: LicenseService | null;
  private readonly sharedToken: string;
  private readonly logger: Logger;
  private readonly activityLog: ActivityLog | undefined;

  constructor(options: InboundControllerOptions) {
    this.brain = options.brain;
    this.license = options.license;
    this.sharedToken = options.sharedToken ?? "";
    this.logger = options.logger;
    this.activityLog = options.activityLog;
    if (this.sharedToken) this.logger.warn("[bo-nao] MA_NHAN_TIN dung chung dang bat — chi de chay thu; ban that dung ma nhan tin rieng tung shop.");
  }

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "POST" || ctx.path !== PATHS.inbound) return false;
    const token = bearerToken(req);
    if (!token) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }

    // Which merchant: derived from the private inbox token. The shared token is legacy only.
    let tenant = this.license ? this.license.tenantForInboxToken(token) : null;
    const viaSharedToken = tenant === null && this.sharedToken !== "" && constantTimeEqual(token, this.sharedToken);
    if (tenant === null && !viaSharedToken) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }

    const body = await ctx.readJson();
    if (body === null) return true;
    if (viaSharedToken) tenant = String(body["tenant"] || "");
    else if (body["tenant"] && String(body["tenant"]) !== tenant) {
      this.logger.warn(`[bo-nao] landing cua "${tenant}" gui tin ghi tenant "${String(body["tenant"])}" — bo tin`);
      sendJson(res, 403, { ok: false, error: "tenant_khong_khop" });
      return true;
    }
    if (!tenant || !body["nguoi"] || typeof body["chu"] !== "string") {
      sendJson(res, 400, { ok: false, error: "thieu_tenant_nguoi_hoac_chu" });
      return true;
    }
    // Tell the activity log whose request this is: the shared buffer is shared FAIRLY, and it can
    // only do that once it knows which merchant an entry belongs to.
    ctx.shop = tenant;
    try {
      const message = { ...(body as unknown as InboundMessageBody), tenant };
      const start = Date.now();
      const result = await this.brain.handleInbound(message);
      this.activityLog?.add({
        huong: "in", loai: "tin-den", method: "POST", duong: "/tin-den",
        shop: tenant, status: 200, ms: Date.now() - start,
        tomTat: result.daTraLoi ? `trả lời (${result.hanhDong})` : `không trả lời (${result.viSao})`,
        chiTiet: { kenh: message.kenh ?? "facebook", nguoi: message.nguoi, chu: message.chu?.slice(0, 200) },
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      this.logger.warn(`[bo-nao] xu ly tin hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      this.activityLog?.add({
        huong: "in", loai: "tin-den", method: "POST", duong: "/tin-den",
        shop: tenant, status: 500,
        tomTat: `lỗi: ${error instanceof Error ? error.message : String(error)}`,
      });
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
    }
    return true;
  }
}
