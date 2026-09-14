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
 *   - store phone numbers, addresses or purchase history (memory is redacted before writing);
 *   - call Meta itself (replies go through the landing's inbox);
 *   - move money (no bot tool has a money effect).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import { PATHS, type InboundMessageBody, type InboundResult } from "../protocol";
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
}

export class InboundController implements RequestController {
  private readonly brain: InboundHandler;
  private readonly license: LicenseService | null;
  private readonly sharedToken: string;
  private readonly logger: Logger;

  constructor(options: InboundControllerOptions) {
    this.brain = options.brain;
    this.license = options.license;
    this.sharedToken = options.sharedToken ?? "";
    this.logger = options.logger;
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
    try {
      const message = { ...(body as unknown as InboundMessageBody), tenant };
      const result = await this.brain.handleInbound(message);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      this.logger.warn(`[bo-nao] xu ly tin hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
    }
    return true;
  }
}
