/** @file Read/contribution door for the shared Product Library. Approval stays operator-only. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import { constantTimeEqual } from "../license/key-format";
import type { ProductLibrary } from "../product-library/product-library";
import type { ImageJob, ImageJobQueue } from "../product-library/image-job-queue";
import type { ImageBatchBook } from "../product-library/image-batch-book";
import type { ImageToolDispatcher } from "../product-library/image-tool-dispatcher";
import type { SharedImage, SharedImageBook } from "../product-library/shared-image-book";
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

/**
 * 02/10/2026 — ẢNH SHOP CHIA SẺ đi cho shop khác dưới dạng media của thư viện, nhưng CHỈ khi máy tìm
 * ảnh đã tìm (`scrapedAt`) mà không ra tấm nào: ảnh hãng/đại lý vẫn là nguồn chính, ảnh shop là lưới.
 */
const sharedMedia = (images: SharedImage[], base: string, at: string) => images.slice(0, 10).map((image, index) => {
  const url = `${base}/thu-vien-san-pham/asset/${image.assetName}`;
  return { id: image.id, role: index === 0 ? "primary" : "gallery", order: index, sourceUrl: url, storageUrl: url, assetUrl: url, confidence: 0.9, status: "verified", source: { url, provider: "anh-shop-chia-se", observedAt: image.reviewedAt ?? at } };
});

/** Một ảnh chia sẻ như màn duyệt cần thấy: ảnh gốc của shop cạnh bản sẽ đưa đi. */
const reviewView = (image: SharedImage, base: string) => ({
  id: image.id, shop: image.shop, ma: image.code, nguon: image.source, trangThai: image.state,
  anhGoc: image.originalUrl || image.sourceUrl, anhGocKhac: image.originalUrl && image.sourceUrl ? image.sourceUrl : "",
  anhChiaSe: image.assetName && base ? `${base}/thu-vien-san-pham/asset/${image.assetName}` : "",
  logo: image.logo ?? null, lyDoLoai: image.rejectReason ?? "", nguoiDuyet: image.reviewedBy ?? "", capNhat: image.updatedAt
});

export const PRODUCT_LIBRARY_PREFIX = "/thu-vien-san-pham/";
/** Đường nhận ảnh (base64) cần thân lớn; các đường khác giữ trần mặc định. */
const LARGE_BODY_ROUTES = new Set(["phuc-hoi-asset"]);
export class ProductLibraryController implements RequestController {
  constructor(private readonly options: {
    library: ProductLibrary; queue?: ImageJobQueue; dispatcher?: ImageToolDispatcher; batches?: ImageBatchBook; license: LicenseService | null; sharedToken?: string; logger: Logger;
    /** 02/10/2026: ảnh shop chia sẻ + những shop được duyệt (`XEON_SHOP_DUYET_ANH`). */
    shared?: SharedImageBook; reviewers?: readonly string[]; onShared?: () => void;
  }) {}

  /** Knock on the image tool AFTER answering: a slow tunnel must not slow the landing down. */
  private nudge(enqueued: boolean): void {
    if (enqueued) void this.options.dispatcher?.sweep();
  }
  /**
   * Mỗi lần một shop hỏi là một lô; xong lô thì Xeon tự đẩy kết quả về landing của shop đó
   * (`image-batch-book.ts`, 30/09/2026). Mã dùng chung kiểu cũ không biết shop nào, nên không có lô.
   * `bao-asset-loi` cố ý KHÔNG mở lô: chính lượt đẩy về landing gọi nó khi ảnh tải hỏng, nên mở lô ở
   * đó là vòng đẩy → hỏng ảnh → bóc lại → đẩy mãi không dừng (agent phản biện bắt, 30/09).
   */
  private openBatch(tenant: string | null, jobs: ImageJob[]): void {
    for (const batch of this.options.batches?.open(tenant, jobs) ?? []) {
      this.options.logger.info(`[lo-anh] mo lo ${batch.id} cho shop "${batch.shop}": ${batch.viec.length} ma`);
    }
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
    const body = await ctx.readJson(LARGE_BODY_ROUTES.has(route) ? 21 * 1024 * 1024 : undefined); if (body === null) return true;
    const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]!.trim(); const host = String(req.headers.host ?? "").trim();
    const base = host ? `${proto}://${host}` : "";
    try {
      if (ctx.method === "POST" && (route === "chia-se-anh" || route === "rut-chia-se" || route.startsWith("duyet-anh/"))) return this.handleShared(res, route, body, tenant, base);
      if (ctx.method === "POST" && route === "tra-ma") { const code = String(body["ma"] ?? ""); const result = this.options.library.lookup(code); const job = result.product ? null : this.options.queue?.enqueue(code) ?? null; this.openBatch(tenant, job ? [job] : []); sendJson(res, 200, { ok: true, ...result, job }); this.nudge(job !== null); return true; }
      if (ctx.method === "POST" && route === "tra-nhieu") {
        const codes = (Array.isArray(body["ma"]) ? body["ma"] : []).map(String);
        const requested = body["truongThieu"] !== null && typeof body["truongThieu"] === "object" ? body["truongThieu"] as Record<string, unknown> : {};
        const forced = body["batBuoc"] !== null && typeof body["batBuoc"] === "object" ? body["batBuoc"] as Record<string, unknown> : {};
        // `hang` (24/09/2026): landing biết hãng của từng mã, bộ cào thì không. Thiếu nó là mất
        // cả nhánh chính hãng — xem ghi chú ở `ImageJob.brand`.
        const brands = body["hang"] !== null && typeof body["hang"] === "object" ? body["hang"] as Record<string, unknown> : {};
        // `ten` (30/09/2026): hãng trống hay "Chưa rõ" thì bộ cào đoán từ tên, như bản portable.
        const names = body["ten"] !== null && typeof body["ten"] === "object" ? body["ten"] as Record<string, unknown> : {};
        const results = this.options.library.lookupMany(codes);
        const pending: string[] = [];
        const jobs: ImageJob[] = [];
        for (const result of results) {
          const forcedFields = (Array.isArray(forced[result.code]) ? forced[result.code] as unknown[] : []).map(String);
          const fields = [...new Set([...stillMissing(result.product as unknown as Record<string, unknown> | null, requested[result.code] ?? []), ...forcedFields])];
          if (result.product && fields.length === 0) continue;
          if (forcedFields.length === 0 && recentlyScraped(result.product)) continue;
          const job = this.options.queue?.enqueue(result.code, { requestedFields: fields, brand: brands[result.code] ?? result.product?.brand, name: names[result.code] ?? result.product?.name });
          if (job) jobs.push(job);
          pending.push(result.code);
        }
        this.openBatch(tenant, jobs);
        const shared = this.options.shared;
        const at = new Date().toISOString();
        const ketQua = !shared || !base ? results : results.map((result) => {
          const product = result.product;
          if (!product || !product.scrapedAt || product.media.length > 0) return result;
          const images = shared.approvedFor(result.code, tenant);
          return images.length ? { ...result, product: { ...product, media: sharedMedia(images, base, at) } } : result;
        });
        sendJson(res, 200, { ok: true, ketQua, dangCho: pending }); this.nudge(pending.length > 0); return true;
      }
      if (ctx.method === "POST" && route === "bao-asset-loi") {
        const urls = Array.isArray(body["assetUrl"]) ? body["assetUrl"] : [body["assetUrl"]];
        const job = this.options.queue?.enqueue(String(body["ma"] ?? ""), { requestedFields: ["media"], brokenAssetUrls: urls }) ?? null;
        sendJson(res, 200, { ok: true, job }); this.nudge(job !== null); return true;
      }
      if (ctx.method === "POST" && route === "phuc-hoi-asset") {
        const encoded = String(body["imageBase64"] ?? "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
        const asset = this.options.library.recoverAsset(String(body["ma"] ?? ""), String(body["oldAssetUrl"] ?? ""), Buffer.from(encoded, "base64"), base);
        sendJson(res, 200, { ok: true, asset, assetUrl: `${base}${asset.path}` }); return true;
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

  /**
   * 02/10/2026 — ảnh shop chia sẻ. Chỉ shop thật (key Xeon cấp) mới gửi/rút được: mã dùng chung kiểu
   * cũ không biết shop nào, không thể là chủ ảnh. Duyệt: chỉ shop trong `XEON_SHOP_DUYET_ANH`.
   */
  private handleShared(res: ServerResponse, route: string, body: Record<string, unknown>, tenant: string | null, base: string): boolean {
    const shared = this.options.shared;
    if (!shared) { sendJson(res, 503, { ok: false, error: "chua_bat_chia_se_anh" }); return true; }
    if (tenant === null) { sendJson(res, 403, { ok: false, error: "can_key_shop", message: "Chia sẻ ảnh cần landing đã đăng ký bằng key shop." }); return true; }
    if (route === "chia-se-anh") {
      const result = shared.offer(tenant, Array.isArray(body["anh"]) ? body["anh"] : [], Array.isArray(body["goiY"]) ? body["goiY"] : []);
      if (result.added) this.options.logger.info(`[anh-chia-se] shop "${tenant}" gui ${result.added} anh moi (${result.known} da co)`);
      sendJson(res, 200, { ok: true, them: result.added, daCo: result.known });
      if (result.added) this.options.onShared?.();
      return true;
    }
    if (route === "rut-chia-se") {
      const count = shared.withdraw(tenant);
      if (count) this.options.logger.info(`[anh-chia-se] shop "${tenant}" rut ${count} anh`);
      sendJson(res, 200, { ok: true, daRut: count }); return true;
    }
    const reviewer = (this.options.reviewers ?? []).includes(tenant);
    if (route === "duyet-anh/danh-sach") {
      if (!reviewer) { sendJson(res, 200, { ok: true, duocDuyet: false, anh: [], tong: 0, dem: {} }); return true; }
      const page = shared.list({ state: String(body["trangThai"] ?? "cho-duyet"), shop: String(body["shop"] ?? ""), limit: Number(body["soLuong"] ?? 60), offset: Number(body["tu"] ?? 0) });
      sendJson(res, 200, { ok: true, duocDuyet: true, anh: page.images.map((image) => reviewView(image, base)), tong: page.total, dem: page.counts }); return true;
    }
    if (route === "duyet-anh/quyet") {
      if (!reviewer) { sendJson(res, 403, { ok: false, error: "khong_duoc_duyet_anh", message: "Duyệt ảnh chia sẻ do nơi cấp phần mềm làm." }); return true; }
      const ids = Array.isArray(body["ids"]) ? body["ids"] : [];
      const approve = body["duyet"] === true;
      const count = shared.decide(ids, approve, `shop:${tenant}`, String(body["lyDo"] ?? ""));
      this.options.logger.info(`[anh-chia-se] shop "${tenant}" ${approve ? "duyet" : "loai"} ${count} anh`);
      sendJson(res, 200, { ok: true, daDoi: count }); return true;
    }
    sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
  }
}
