/** @file Read/contribution door for the shared Product Library. Approval stays operator-only. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import { constantTimeEqual } from "../license/key-format";
import type { ProductLibrary } from "../product-library/product-library";
import type { ImageJobQueue } from "../product-library/image-job-queue";
import type { ImageToolDispatcher } from "../product-library/image-tool-dispatcher";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

const stillMissing = (product: Record<string, unknown> | null, requested: unknown): string[] => {
  const fields = (Array.isArray(requested) ? requested : []).map(String);
  if (!product) return fields;
  const has = (value: unknown) => String(value ?? "").trim() !== "";
  const dimensions = product["physicalDimensions"] as Record<string, unknown> | undefined;
  const media = Array.isArray(product["media"]) ? product["media"] : [];
  return fields.filter((field) => {
    if (field === "productLine") return !has(product["line"]);
    if (field === "physicalDimensions") return !dimensions || !["length", "width", "height"].some((key) => has(dimensions[key]));
    if (field === "gallery") return media.length < 4;
    if (field === "seo") { const seo = product["seo"] as Record<string, unknown> | undefined; return !seo || (!has(seo["title"]) && !has(seo["description"])); }
    return !has(product[field]);
  });
};

/**
 * 24/09/2026 — TRÍ NHỚ "đã tìm, không thấy".
 *
 * Gộp trùng của hàng đợi chỉ che được việc đang sống: mã đã cào xong mà không ra ảnh thì lần bấm
 * sau lại thành một việc mới tinh, cào lại từ đầu, lại không thấy. Sáng 24/09 có 508 mã như thế,
 * và 462 mã đã bị cào đi cào lại từ hai đến năm lượt.
 *
 * Bảy ngày là khoảng nghỉ: nguồn hàng có thêm ảnh thì trong tuần sau sẽ được hỏi lại, còn trong
 * tuần này thì thôi. Người bấm "Tìm lại" trên một trường cụ thể vẫn được chạy ngay — ép tay bao
 * giờ cũng thắng trí nhớ.
 */
const RESCRAPE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const recentlyScraped = (product: { scrapedAt?: string } | null | undefined): boolean => {
  const at = Date.parse(product?.scrapedAt ?? "");
  return Number.isFinite(at) && Date.now() - at < RESCRAPE_AFTER_MS;
};

export const PRODUCT_LIBRARY_PREFIX = "/thu-vien-san-pham/";
export class ProductLibraryController implements RequestController {
  constructor(private readonly options: { library: ProductLibrary; queue?: ImageJobQueue; dispatcher?: ImageToolDispatcher; license: LicenseService | null; sharedToken?: string; logger: Logger }) {}

  /** Knock on the image tool AFTER answering: a slow tunnel must not slow the landing down. */
  private nudge(enqueued: boolean): void {
    if (enqueued) void this.options.dispatcher?.sweep();
  }
  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!ctx.path.startsWith(PRODUCT_LIBRARY_PREFIX)) return false;
    const route = ctx.path.slice(PRODUCT_LIBRARY_PREFIX.length);
    if (ctx.method === "GET" && route.startsWith("asset/")) {
      const asset = this.options.library.readAsset(route.slice("asset/".length));
      if (!asset) { sendJson(res, 404, { ok: false, error: "khong_thay" }); return true; }
      res.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.data.length, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" }); res.end(asset.data); return true;
    }
    const token = bearerToken(req); const tenant = this.options.license?.tenantForInboxToken(token) ?? null;
    const shared = this.options.sharedToken ?? ""; if (!token || (tenant === null && !(shared && constantTimeEqual(token, shared)))) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    const body = await ctx.readJson(route === "phuc-hoi-asset" ? 21 * 1024 * 1024 : undefined); if (body === null) return true;
    try {
      if (ctx.method === "POST" && route === "tra-ma") { const code = String(body["ma"] ?? ""); const result = this.options.library.lookup(code); const job = result.product ? null : this.options.queue?.enqueue(code) ?? null; sendJson(res, 200, { ok: true, ...result, job }); this.nudge(job !== null); return true; }
      if (ctx.method === "POST" && route === "tra-nhieu") {
        const codes = (Array.isArray(body["ma"]) ? body["ma"] : []).map(String);
        const requested = body["truongThieu"] !== null && typeof body["truongThieu"] === "object" ? body["truongThieu"] as Record<string, unknown> : {};
        const forced = body["batBuoc"] !== null && typeof body["batBuoc"] === "object" ? body["batBuoc"] as Record<string, unknown> : {};
        // `hang` (24/09/2026): landing biết hãng của từng mã, bộ cào thì không. Thiếu nó là mất
        // cả nhánh chính hãng — xem ghi chú ở `ImageJob.brand`.
        const brands = body["hang"] !== null && typeof body["hang"] === "object" ? body["hang"] as Record<string, unknown> : {};
        const results = this.options.library.lookupMany(codes);
        const pending: string[] = [];
        for (const result of results) {
          const forcedFields = (Array.isArray(forced[result.code]) ? forced[result.code] as unknown[] : []).map(String);
          const fields = [...new Set([...stillMissing(result.product as unknown as Record<string, unknown> | null, requested[result.code] ?? []), ...forcedFields])];
          if (result.product && fields.length === 0) continue;
          if (forcedFields.length === 0 && recentlyScraped(result.product)) continue;
          this.options.queue?.enqueue(result.code, { requestedFields: fields, brand: brands[result.code] ?? result.product?.brand });
          pending.push(result.code);
        }
        sendJson(res, 200, { ok: true, ketQua: results, dangCho: pending }); this.nudge(pending.length > 0); return true;
      }
      if (ctx.method === "POST" && route === "bao-asset-loi") {
        const urls = Array.isArray(body["assetUrl"]) ? body["assetUrl"] : [body["assetUrl"]];
        const job = this.options.queue?.enqueue(String(body["ma"] ?? ""), { requestedFields: ["media"], brokenAssetUrls: urls }) ?? null;
        sendJson(res, 200, { ok: true, job }); this.nudge(job !== null); return true;
      }
      if (ctx.method === "POST" && route === "phuc-hoi-asset") {
        const encoded = String(body["imageBase64"] ?? "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
        const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]!.trim(); const host = String(req.headers.host ?? "").trim();
        const asset = this.options.library.recoverAsset(String(body["ma"] ?? ""), String(body["oldAssetUrl"] ?? ""), Buffer.from(encoded, "base64"), host ? `${proto}://${host}` : "");
        sendJson(res, 200, { ok: true, asset, assetUrl: `${host ? `${proto}://${host}` : ""}${asset.path}` }); return true;
      }
      if (ctx.method === "POST" && route === "tien-trinh") {
        // 24/09/2026: việc lọc theo mã phải do hàng đợi làm, TRƯỚC khi nó cắt 1.000 việc mới nhất.
        // Lọc ở đây là lọc trên phần đã bị cắt: mã cũ không bao giờ có mặt, màn hình chờ nó vĩnh viễn.
        const wanted = (Array.isArray(body["ma"]) ? body["ma"] : []).map((value) => String(value).trim()).filter(Boolean);
        const jobs = this.options.queue?.list(wanted.length ? wanted : undefined) ?? [];
        sendJson(res, 200, { ok: true, jobs, control: this.options.queue?.control() }); return true;
      }
      if (ctx.method === "POST" && route === "dieu-khien") {
        const command = String(body["lenh"] ?? "");
        if (command === "chay-lai-loi") { sendJson(res, 200, { ok: true, ...(this.options.queue?.retryFailed() ?? { retried: 0 }) }); return true; }
        const paused = command !== "tiep-tuc"; sendJson(res, 200, { ok: true, control: this.options.queue?.setPaused(paused) }); return true;
      }
      if (ctx.method === "POST" && route === "de-xuat") { const product = this.options.library.propose(body["sanPham"]); this.options.logger.info(`[product-library] nhan de xuat ${product.code}`); sendJson(res, 202, { ok: true, product }); return true; }
      sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
    } catch (error) { sendJson(res, 400, { ok: false, error: "du_lieu_khong_hop_le", message: error instanceof Error ? error.message : String(error) }); return true; }
  }
}
