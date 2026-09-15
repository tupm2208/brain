/**
 * @file `POST /viet-bai`: a merchant's landing asks the brain to draft a Facebook post.
 *
 * Path of one draft:
 *   the owner presses "Nhờ bộ não viết" in OMI -> the landing builds a BRIEF from the post, the
 *   real catalogue and its own rules -> POST /viet-bai -> the draft comes back -> THE LANDING
 *   JUDGES IT with those same rules and shows the verdict next to the text.
 *
 * AUTHENTICATION IS THE SAME AS `/tin-den` and for the same reason: the landing carries its
 * PRIVATE INBOX TOKEN and the merchant is derived from the token, never read from the body.
 * Reading it from the body would let merchant A spend merchant B's quota.
 *
 * WHAT THIS DOOR DOES NOT DO: it does not judge. Xeon has no copy of the shop's rules and should
 * not grow one — the landing owns them, sends them in the brief, and checks the answer. A draft
 * that breaks a rule comes back anyway, and the screen shows why.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { buildPrompt, DRAFT_SCHEMA, readDraft } from "../content/content-writer";
import type { WriteBriefBody, WriteResult } from "../content/brief";
import type { TextModelPort } from "../content/text-model";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import { PATHS } from "../protocol";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface WriteControllerOptions {
  model: TextModelPort;
  license: LicenseService | null;
  /** LEGACY, trials only: one shared token for every merchant. */
  sharedToken?: string | undefined;
  logger: Logger;
}

/** The most products one brief may carry: an album is six images, so more is a mistake upstream. */
const MAX_ITEMS = 12;

export class WriteController implements RequestController {
  private readonly model: TextModelPort;
  private readonly license: LicenseService | null;
  private readonly sharedToken: string;
  private readonly logger: Logger;

  constructor(options: WriteControllerOptions) {
    this.model = options.model;
    this.license = options.license;
    this.sharedToken = options.sharedToken ?? "";
    this.logger = options.logger;
  }

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "POST" || ctx.path !== PATHS.write) return false;

    const token = bearerToken(req);
    if (!token) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    let tenant = this.license ? this.license.tenantForInboxToken(token) : null;
    const viaSharedToken = tenant === null && this.sharedToken !== "" && constantTimeEqual(token, this.sharedToken);
    if (tenant === null && !viaSharedToken) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }

    const body = await ctx.readJson();
    if (body === null) return true;
    if (viaSharedToken) tenant = String(body["tenant"] || "");
    else if (body["tenant"] && String(body["tenant"]) !== tenant) {
      this.logger.warn(`[bo-nao] landing cua "${tenant}" xin viet bai ghi tenant "${String(body["tenant"])}" — bo yeu cau`);
      sendJson(res, 403, { ok: false, error: "tenant_khong_khop" });
      return true;
    }

    // Told plainly rather than answered with an empty draft: the shop can act on "no key on Xeon",
    // and cannot act on a blank caption.
    if (!this.model.ready()) {
      sendJson(res, 503, { ok: false, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình viết bài." });
      return true;
    }

    const brief = body as unknown as WriteBriefBody;
    const items = Array.isArray(brief.mon) ? brief.mon : [];
    if (items.length > MAX_ITEMS) {
      sendJson(res, 400, { ok: false, error: "qua_nhieu_mon", tran: MAX_ITEMS });
      return true;
    }

    const prompt = buildPrompt({ ...brief, mon: items });
    const outcome = await this.model.complete({ system: prompt.system, user: prompt.user, schema: DRAFT_SCHEMA as unknown as Record<string, unknown> });
    if (!outcome.ok) {
      sendJson(res, 502, { ok: false, error: "mo_hinh_tu_choi", message: outcome.viSao });
      return true;
    }

    const draft = readDraft(outcome.text);
    if (draft === null) {
      this.logger.warn("[bo-nao] mo hinh tra ve thu khong doc duoc thanh bai");
      sendJson(res, 502, { ok: false, error: "ban_nhap_khong_doc_duoc", message: "Mô hình trả về thứ không đọc được thành bài." });
      return true;
    }

    this.logger.info(`[bo-nao] viet bai cho shop "${tenant}": ${draft.caption.length} ky tu`);
    const result: WriteResult = { ok: true, ban: draft, model: outcome.model };
    sendJson(res, 200, result);
    return true;
  }
}
