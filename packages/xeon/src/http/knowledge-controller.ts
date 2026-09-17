/**
 * @file `/kien-thuc/*` — industry knowledge for a merchant's landing (Đ9): sample profiles, the
 * research queue, line knowledge (which line, what fits a pace × distance), reference classification.
 *
 * AUTHENTICATION IS THE SAME AS `/noi-dung/*`: the landing's PRIVATE INBOX TOKEN, the shop derived
 * from the token, the industry from the shop's licence — never from the body. Shop A cannot read or
 * overwrite shop B's profiles, and a pharmacy cannot ask for the shoe pack by typing its name.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KnowledgeResult, KnowledgeDesk } from "../knowledge/knowledge-desk";
import type { CustomerNeed } from "../knowledge/line-dna";
import type { Profile } from "../knowledge/sample-profiles";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export const KNOWLEDGE_PREFIX = "/kien-thuc/";

export interface KnowledgeControllerOptions {
  desk: KnowledgeDesk;
  license: LicenseService | null;
  sharedToken?: string | undefined;
  logger: Logger;
}

const text = (v: unknown, n = 4000): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Profile => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Profile) : {});
const strings = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v : []).map((x) => text(x, len)).filter(Boolean).slice(0, n);

/** Catalogue items as the landing sends them: only the fields matching needs. */
function products(v: unknown): Profile[] {
  return (Array.isArray(v) ? v : []).slice(0, 20000).map((x) => {
    const o = asObject(x);
    return { ma: text(o["ma"], 80), ten: text(o["ten"], 300), hang: text(o["hang"], 80), dong: text(o["dong"], 160), loai: text(o["loai"], 80), nguon: text(o["nguon"], 40) };
  }).filter((p) => p.ma !== "" || p.ten !== "");
}

function need(v: unknown): CustomerNeed {
  const o = asObject(v);
  const out: CustomerNeed = {};
  if (text(o["pace"])) out.paceText = text(o["pace"], 200);
  if (text(o["cuLy"])) out.distanceText = text(o["cuLy"], 200);
  if (text(o["dai"])) out.paceBand = text(o["dai"], 20);
  if (text(o["nhomCuLy"])) out.distanceBand = text(o["nhomCuLy"], 20);
  if (text(o["trinhDo"])) out.level = text(o["trinhDo"], 20);
  if (Number(o["tamGia"]) > 0) out.budgetTier = Number(o["tamGia"]);
  if (text(o["mon"])) out.sport = text(o["mon"], 40);
  return out;
}

export class KnowledgeController implements RequestController {
  constructor(private readonly options: KnowledgeControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!ctx.path.startsWith(KNOWLEDGE_PREFIX)) return false;
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
    const industry = (this.options.license?.industryOf(shop) || "") || "giay-chay";
    const desk = this.options.desk;
    const route = ctx.path.slice(KNOWLEDGE_PREFIX.length);

    try {
      switch (route) {
        case "goi": return this.reply(res, desk.packInfo(industry));
        case "mau": return this.reply(res, desk.overview(shop, industry, { q: text(body["q"], 120), doDay: text(body["doDay"], 20) || "all" }));
        case "mau/doc": return this.reply(res, desk.get(shop, industry, text(body["id"], 120)));
        case "mau/ghi": return this.reply(res, desk.save(shop, industry, asObject(body["mau"])));
        case "mau/xoa": return this.reply(res, desk.remove(shop, industry, strings(body["ids"], 2000, 120)));
        case "mau/gop": return this.reply(res, desk.merge(shop, industry, strings(body["ids"], 200, 120), text(body["giu"], 120)));
        case "mau/gop-trung": return this.reply(res, desk.consolidate(shop, industry));
        case "mau/gop-kho": return this.reply(res, desk.mergeCatalog(shop, industry, products(body["sanPham"])));
        case "mau/mac-dinh": return this.reply(res, desk.reset(shop, industry));
        case "mau/xuat-ban": return this.reply(res, desk.publish(shop, industry, products(body["sanPham"])));
        case "mau/tu-san-pham": return this.reply(res, desk.fromProduct(shop, industry, asObject(body["sanPham"])));
        case "mau/phan-tich": {
          const draft = asObject(body["mau"]);
          return this.reply(res, desk.parse(shop, industry, text(body["id"], 120), text(body["noiDung"], 200_000), Object.keys(draft).length ? draft : null));
        }
        case "nghien-cuu": return this.reply(res, desk.overview(shop, industry, { q: "", doDay: "none" }));
        case "nghien-cuu/tao": return this.reply(res, desk.createJobs(shop, industry, strings(body["ids"], 200, 120), text(body["prompt"], 20000)));
        case "nghien-cuu/chay": {
          const r = await desk.runJobs(shop, industry, Number(body["toiDa"]) || 3);
          if (r.ok) this.options.logger.info(`[kien-thuc] shop "${shop}" nghien cuu: ${r.xong} xong, ${r.loi} loi, con ${r.conCho}`);
          return this.reply(res, r);
        }
        case "dong/goi-y": return this.reply(res, desk.recommend(industry, need(body["nhuCau"]), strings(body["conHang"], 5000, 300), Number(body["soDong"]) || 3));
        case "dong/tim": return this.reply(res, desk.findLine(industry, text(body["chu"], 500), strings(body["conHang"], 5000, 300)));
        case "cham-dong": return this.reply(res, desk.classify(industry, products(body["sanPham"])));
        default: sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
      }
    } catch (error) {
      this.options.logger.warn(`[kien-thuc] ${ctx.path} hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
      return true;
    }
  }

  private reply(res: ServerResponse, result: KnowledgeResult<object>): boolean {
    if (result.ok) sendJson(res, 200, result);
    else sendJson(res, result.status, { ok: false, error: result.error, message: result.message });
    return true;
  }
}
