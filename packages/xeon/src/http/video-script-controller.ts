/**
 * @file `POST /video/kich-ban`: a landing asks Xeon to write a video script (Đ9, 21/09/2026).
 *
 * WHICH MERCHANT comes from the PRIVATE INBOX TOKEN, exactly as `/tin-den` does it — never read
 * from the body. The shop's name and trade come from the licence ledger for the same reason: a
 * landing that could name its own shop could put another shop's name in the script.
 *
 * Xeon KEEPS NOTHING here. The post and its stock figures arrive in the request, are shown to the
 * model, and go out of memory with the reply — the merchant's data stays on the merchant's server,
 * which is the whole arrangement (decided 12/09/2026).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KnowledgePackRegistry } from "../knowledge/industry-packs";
import type { LicenseService } from "../license/license-service";
import type { Logger } from "../support/logger";
import type { VideoScriptDesk } from "../video/script-desk";
import type { ScriptPost, ScriptProduct } from "../video/script-prompt";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export const VIDEO_SCRIPT_PATH = "/video/kich-ban";
/** A post plus its stock lines. Generous, but not a door to post a book through. */
export const MAX_SCRIPT_BODY_BYTES = 256 * 1024;

export interface VideoScriptControllerOptions {
  desk: VideoScriptDesk;
  license: LicenseService | null;
  logger: Logger;
  /** Where the trade's words come from. Absent = every trade reads as "hàng". */
  packs?: KnowledgePackRegistry | undefined;
}

const asObject = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The post as the landing sent it, kept to the fields the prompt reads. */
function postFrom(raw: Record<string, unknown>): ScriptPost {
  const dropped = Array.isArray(raw["maBo"]) ? raw["maBo"] : [];
  return {
    main: String(raw["main"] ?? ""),
    sub: String(raw["sub"] ?? ""),
    caption: String(raw["caption"] ?? ""),
    comment: String(raw["comment"] ?? ""),
    codes: (Array.isArray(raw["codes"]) ? raw["codes"] : []).map(String).filter(Boolean),
    maBo: dropped.map((m) => {
      const o = asObject(m);
      return { code: String(o["code"] ?? ""), name: String(o["name"] ?? ""), lyDo: String(o["lyDo"] ?? "") };
    }).filter((m) => m.code !== "")
  };
}

function productsFrom(raw: unknown): Record<string, ScriptProduct> {
  const out: Record<string, ScriptProduct> = {};
  for (const [code, value] of Object.entries(asObject(raw))) {
    const p = asObject(value);
    const sizes = Array.isArray(p["sizes"]) ? p["sizes"] : [];
    out[code] = {
      code,
      name: String(p["name"] ?? ""),
      salePrice: (p["salePrice"] as string | number | undefined) ?? "",
      sizes: sizes.map((s) => {
        const o = asObject(s);
        return { size: String(o["size"] ?? ""), qty: Number(o["qty"]) || 0 };
      })
    };
  }
  return out;
}

export class VideoScriptController implements RequestController {
  constructor(private readonly options: VideoScriptControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "POST" || ctx.path !== VIDEO_SCRIPT_PATH) return false;

    const { desk, license } = this.options;
    const token = bearerToken(req);
    const shop = token && license ? license.tenantForInboxToken(token) : null;
    if (shop === null) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    ctx.shop = shop;

    if (!desk.ready()) {
      // Say which side is not configured: a shop reading "không viết được" cannot tell.
      sendJson(res, 503, { ok: false, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình cổng AI (XEON_AI_CHAT_URL + XEON_AI_CHAT_KEY) nên chưa viết được kịch bản video." });
      return true;
    }

    const body = await ctx.readJson(MAX_SCRIPT_BODY_BYTES);
    if (body === null) return true;

    // Name and trade from the ledger, never from the body.
    const known = license?.serviceEligibility(shop) ?? null;
    const post = postFrom(asObject(body["baiGoc"] ?? body));
    if ((post.codes ?? []).length === 0) {
      sendJson(res, 400, { ok: false, error: "bai_khong_co_ma", message: "Bài gửi lên không có mã hàng nào — không dựng được video." });
      return true;
    }

    const written = await desk.write({
      shop,
      tenShop: known !== null && known.ok ? known.tenShop : shop,
      nganh: nganhWords(known !== null && known.ok ? known.nganh : "", this.options.packs),
      bai: post,
      sanPham: productsFrom(body["sanPham"]),
      maViec: String(body["maViec"] ?? "")
    });

    if (!written.ok) {
      this.options.logger.warn(`[video] "${shop}" khong viet duoc kich ban (${written.viSao})`);
      sendJson(res, 502, { ok: false, error: written.viSao, vong: written.vong, loi: written.loi });
      return true;
    }
    this.options.logger.info(`[video] "${shop}" co kich ban sau ${written.vong} vong (${written.model})`);
    // `daLam` tells the landing which pipeline steps are now done, so the job packet stays honest.
    sendJson(res, 200, { ok: true, kichBan: written.kichBan, daLam: ["kich-ban"], vong: written.vong, canhBao: written.canhBao });
    return true;
  }
}

/**
 * The pack id as words a prompt can use, taken from the industry's own `kien-thuc.json`.
 *
 * It used to be a table of two ids written here, so a new industry read as "hàng" until somebody
 * edited this file — and one of the two ids ("duoc-pham") was not even an industry that exists.
 * Unknown trade = "hàng", which still reads fine in the sentence.
 */
export function nganhWords(packId: string, packs?: KnowledgePackRegistry | undefined): string {
  if (packId === "" || packs === undefined) return "hàng";
  return packs.get(packId).tradeWords || "hàng";
}
