/**
 * @file `/noi-dung/*` — critique, optimise and trend research for a merchant's landing (Đ8).
 *
 * AUTHENTICATION IS THE SAME AS `/viet-bai`: the landing carries its PRIVATE INBOX TOKEN and the
 * shop is derived from the token, never read from the body — otherwise shop A could spend shop B's
 * model budget. Nothing here stores or sends anything: the landing keeps the verdicts.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BriefItem, WritingStyle } from "../content/brief";
import type { ContentDeskResult, ContentDeskService, ReviewOutcome, ReviewPost, TrendLine } from "../content/content-desk";
import type { ProfileField, ProfileTranslator } from "../content/profile-translator";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import { PATHS } from "../protocol";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface ContentControllerOptions {
  desk: ContentDeskService;
  /** 22/09: lời chủ shop kể → các ô của hồ sơ content. */
  translator: ProfileTranslator;
  license: LicenseService | null;
  sharedToken?: string | undefined;
  logger: Logger;
}

const PATHS_OWNED = new Set<string>([PATHS.contentReview, PATHS.contentOptimize, PATHS.contentTrends, PATHS.contentProfile]);
const text = (v: unknown, n = 4000): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function items(v: unknown): BriefItem[] {
  return (Array.isArray(v) ? v : []).slice(0, 12).map((m) => {
    const o = asObject(m);
    return { ma: text(o["ma"], 80), ten: text(o["ten"], 200), hang: text(o["hang"], 80), size: (Array.isArray(o["size"]) ? o["size"] : []).map((s) => text(s, 20)).filter(Boolean).slice(0, 30) };
  }).filter((m) => m.ma !== "");
}

function post(v: unknown): ReviewPost {
  const o = asObject(v);
  return {
    ma: text(o["ma"], 120), gio: text(o["gio"], 10), trang: text(o["trang"], 120), dangBai: text(o["dangBai"], 60), huongDan: text(o["huongDan"], 800), chuDe: text(o["chuDe"], 600),
    goc: text(o["goc"], 300), caption: text(o["caption"], 9000), chuAnh: text(o["chuAnh"], 300), comment: text(o["comment"], 2000), mon: items(o["mon"])
  };
}

function style(v: unknown): WritingStyle | undefined {
  const o = asObject(v);
  if (Object.keys(o).length === 0) return undefined;
  return { ten: text(o["ten"], 120), moTa: text(o["moTa"], 600), luatViet: text(o["luatViet"], 3000), cauTruc: text(o["cauTruc"], 2000), baiMau: text(o["baiMau"], 4000) };
}

/** Bảng ô của hồ sơ, đúng như landing mô tả. Xeon không giữ bản sao nào của bảng này. */
function fields(v: unknown): ProfileField[] {
  return (Array.isArray(v) ? v : []).slice(0, 80).map((f) => {
    const o = asObject(f);
    const min = Number(o["toiThieu"]);
    const max = Number(o["toiDa"]);
    return {
      duong: text(o["duong"], 80), nhan: text(o["nhan"], 160), kieu: text(o["kieu"], 20),
      giaiThich: text(o["giaiThich"], 400), viDu: text(o["viDu"], 200),
      ...(Number.isFinite(min) ? { toiThieu: min } : {}), ...(Number.isFinite(max) ? { toiDa: max } : {})
    };
  }).filter((f) => f.duong !== "");
}

function choices(v: unknown): { id: string; ten: string; moTa?: string | undefined }[] {
  return (Array.isArray(v) ? v : []).slice(0, 30).map((m) => {
    const o = asObject(m);
    return { id: text(o["id"], 60), ten: text(o["ten"], 160), moTa: text(o["moTa"], 300) };
  }).filter((m) => m.id !== "");
}

const strings = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v : []).map((x) => text(x, len)).filter(Boolean).slice(0, n);

export class ContentController implements RequestController {
  constructor(private readonly options: ContentControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!PATHS_OWNED.has(ctx.path)) return false;
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }

    const token = bearerToken(req);
    if (!token) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    let tenant = this.options.license ? this.options.license.tenantForInboxToken(token) : null;
    const shared = this.options.sharedToken ?? "";
    const viaSharedToken = tenant === null && shared !== "" && constantTimeEqual(token, shared);
    if (tenant === null && !viaSharedToken) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }

    const body = await ctx.readJson();
    if (body === null) return true;
    if (viaSharedToken) tenant = text(body["tenant"], 64);
    else if (body["tenant"] && String(body["tenant"]) !== tenant) { sendJson(res, 403, { ok: false, error: "tenant_khong_khop" }); return true; }
    const shop = String(tenant || "");
    if (!shop) { sendJson(res, 400, { ok: false, error: "thieu_tenant" }); return true; }

    try {
      if (ctx.path === PATHS.contentReview) {
        return this.reply(res, await this.options.desk.review({ tenant: shop, bai: post(body["bai"]), loiLuat: strings(body["loiLuat"], 30, 300), phongCach: style(body["phongCach"]), kienThuc: text(body["kienThuc"], 6000), diemDat: Number(body["diemDat"]) || undefined }));
      }
      if (ctx.path === PATHS.contentProfile) {
        const result = await this.options.translator.understand({
          tenant: shop, loKe: text(body["loKe"], 4000), bangMau: fields(body["bangMau"]),
          hoSoHienTai: asObject(body["hoSoHienTai"]), mau: choices(body["mau"]), mucTieu: choices(body["mucTieu"])
        });
        if (result.ok) this.options.logger.info(`[noi-dung] shop "${shop}" ke ve cach lam content: ${Object.keys(result.hoSo).length} nhom o duoc dien`);
        return this.reply(res, result);
      }
      if (ctx.path === PATHS.contentOptimize) {
        const review = asObject(body["phanBien"]);
        return this.reply(res, await this.options.desk.optimize({
          tenant: shop, bai: post(body["bai"]), loiLuat: strings(body["loiLuat"], 30, 300), phongCach: style(body["phongCach"]),
          phanBien: Object.keys(review).length === 0 ? null : (review as unknown as ReviewOutcome)
        }));
      }
      const lines: TrendLine[] = (Array.isArray(body["dong"]) ? body["dong"] : []).slice(0, 60).map((l) => {
        const o = asObject(l);
        return { key: text(o["key"], 160), hang: text(o["hang"], 80), dong: text(o["dong"], 160), tenMau: strings(o["tenMau"], 4, 160), soMa: Number(o["soMa"]) || 0, tongTon: Number(o["tongTon"]) || 0, giamToiDa: Number(o["giamToiDa"]) || 0 };
      });
      const result = await this.options.desk.trends({ tenant: shop, dong: lines, boiCanh: text(body["boiCanh"], 200), veShop: text(body["veShop"], 600) });
      if (result.ok) this.options.logger.info(`[noi-dung] shop "${shop}" nghien cuu xu huong: ${result.dong.length} dong`);
      return this.reply(res, result);
    } catch (error) {
      this.options.logger.warn(`[noi-dung] ${ctx.path} hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
      return true;
    }
  }

  private reply(res: ServerResponse, result: ContentDeskResult<object>): boolean {
    if (result.ok) sendJson(res, 200, result);
    else sendJson(res, result.status, { ok: false, error: result.error, message: result.message });
    return true;
  }
}
