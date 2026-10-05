/** @file Read/contribution door for the shared Product Library. Approval stays operator-only. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenseService } from "../license/license-service";
import { constantTimeEqual } from "../license/key-format";
import type { LibraryMedia, LibraryProduct, ProductLibrary } from "../product-library/product-library";
import { DOWNGRADE_AFTER_CODES, imageKey, type ImageCase, type ImageReportBook, type ImageToReport } from "../product-library/image-report-book";
import { hostOf, type ImageSourceDirectory } from "../knowledge/image-sources";
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
    /** 04/10/2026: ảnh bị báo sai + bậc trang nguồn. `dailyReportLimit` = lời báo có tác dụng mọi shop / shop / ngày. */
    reports?: ImageReportBook; sources?: ImageSourceDirectory; dailyReportLimit?: number; onReportsChanged?: () => void;
  }) {}

  /** Ảnh của một sản phẩm mà shop `tenant` còn được nhận (bỏ ảnh tạm ẩn / chặn / trang bị chặn). */
  private visible(product: LibraryProduct, tenant: string | null): LibraryProduct {
    const reports = this.options.reports;
    if (!reports || product.media.length === 0) return product;
    const media = product.media.filter((m) => reports.verdict({ code: product.code, brand: product.brand, url: m.sourceUrl || m.assetUrl, pageUrl: m.source.url, tenant, fresh: false }) === "giu");
    return media.length === product.media.length ? product : { ...product, media };
  }

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
      if (ctx.method === "POST" && (route === "bao-sai" || route === "rut-bao" || route === "y-kien" || route.startsWith("anh-bao-sai/") || route.startsWith("nguon-anh/"))) return this.handleReports(res, route, body, tenant);
      if (ctx.method === "POST" && route === "tra-ma") { const code = String(body["ma"] ?? ""); const found = this.options.library.lookup(code); const result = { ...found, product: found.product ? this.visible(found.product, tenant) : null }; const job = result.product ? null : this.options.queue?.enqueue(code) ?? null; this.openBatch(tenant, job ? [job] : []); sendJson(res, 200, { ok: true, ...result, job }); this.nudge(job !== null); return true; }
      if (ctx.method === "POST" && route === "tra-nhieu") {
        const codes = (Array.isArray(body["ma"]) ? body["ma"] : []).map(String);
        const requested = body["truongThieu"] !== null && typeof body["truongThieu"] === "object" ? body["truongThieu"] as Record<string, unknown> : {};
        const forced = body["batBuoc"] !== null && typeof body["batBuoc"] === "object" ? body["batBuoc"] as Record<string, unknown> : {};
        // `hang` (24/09/2026): landing biết hãng của từng mã, bộ cào thì không. Thiếu nó là mất
        // cả nhánh chính hãng — xem ghi chú ở `ImageJob.brand`.
        const brands = body["hang"] !== null && typeof body["hang"] === "object" ? body["hang"] as Record<string, unknown> : {};
        // `ten` (30/09/2026): hãng trống hay "Chưa rõ" thì bộ cào đoán từ tên, như bản portable.
        const names = body["ten"] !== null && typeof body["ten"] === "object" ? body["ten"] as Record<string, unknown> : {};
        // 04/10/2026: ảnh bị báo sai không tới shop nào, và mã còn ít ảnh vì thế thì được tìm thêm.
        const results = this.options.library.lookupMany(codes).map((result) => ({ ...result, product: result.product ? this.visible(result.product, tenant) : null }));
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
   * 04/10/2026 — ẢNH BÁO SAI. Báo / rút / ý kiến / luồng cho landing / nguồn từng ảnh: shop thật (key
   * Xeon cấp). Danh sách duyệt, quyết, bảng uy tín: chỉ shop trong `XEON_SHOP_DUYET_ANH`.
   */
  private handleReports(res: ServerResponse, route: string, body: Record<string, unknown>, tenant: string | null): boolean {
    const reports = this.options.reports;
    if (!reports) { sendJson(res, 503, { ok: false, error: "chua_bat_bao_anh_sai" }); return true; }
    if (tenant === null) { sendJson(res, 403, { ok: false, error: "can_key_shop", message: "Báo ảnh sai cần landing đã đăng ký bằng key shop." }); return true; }
    const limit = this.options.dailyReportLimit ?? 30;
    const urls = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).map((x) => String(x ?? "").trim()).filter((x) => /^https?:\/\//i.test(x) || x.startsWith("//")).slice(0, 20);
    if (route === "bao-sai") {
      const code = String(body["ma"] ?? "").trim();
      const images = this.resolveImages(code, urls(body["anh"]), String(body["hang"] ?? ""));
      if (images.length === 0) { sendJson(res, 400, { ok: false, error: "thieu_anh", message: "Chưa có ảnh nào để báo." }); return true; }
      const outcome = reports.report({ shop: tenant, code, images, lyDo: String(body["lyDo"] ?? ""), ghiChu: String(body["ghiChu"] ?? "") }, limit);
      this.options.logger.info(`[bao-anh-sai] shop "${tenant}" bao ${outcome.length} anh cua ${code} (${String(body["lyDo"] ?? "")})`);
      sendJson(res, 200, { ok: true, baoCao: outcome, conLaiHomNay: reports.remainingToday(tenant, limit), tranNgay: limit });
      this.options.onReportsChanged?.();
      return true;
    }
    if (route === "rut-bao") {
      const keys = urls(body["anh"]).map((url) => this.keyOf(String(body["ma"] ?? ""), url));
      const count = reports.withdraw(tenant, keys);
      sendJson(res, 200, { ok: true, daRut: count });
      if (count) this.options.onReportsChanged?.();
      return true;
    }
    if (route === "y-kien") { sendJson(res, 200, { ok: true, daGhi: reports.object(tenant, String(body["id"] ?? "")) }); return true; }
    if (route === "anh-bao-sai/trang-thai") {
      const counts = body["apDung"] !== null && typeof body["apDung"] === "object" ? body["apDung"] as Record<string, unknown> : {};
      reports.ack(tenant, counts);
      sendJson(res, 200, { ok: true, ds: reports.feedFor(tenant), conLaiHomNay: reports.remainingToday(tenant, limit), tranNgay: limit });
      return true;
    }
    if (route === "nguon-anh/cua-ma") {
      const rows = (Array.isArray(body["ds"]) ? body["ds"] : []).slice(0, 300).map((raw) => {
        const o = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
        return this.sourcesOf(String(o["ma"] ?? ""), urls(o["anh"]), String(o["hang"] ?? ""), tenant);
      });
      sendJson(res, 200, { ok: true, ds: rows }); return true;
    }
    const reviewer = (this.options.reviewers ?? []).includes(tenant);
    if (route === "anh-bao-sai/danh-sach") {
      if (!reviewer) { sendJson(res, 200, { ok: true, duocDuyet: false, ds: [], tong: 0, dem: {} }); return true; }
      const page = reports.list({ state: String(body["trangThai"] ?? "cho-duyet"), limit: Number(body["soLuong"] ?? 30), offset: Number(body["tu"] ?? 0) });
      sendJson(res, 200, { ok: true, duocDuyet: true, ds: page.cases.map((entry) => this.caseView(entry)), tong: page.total, dem: page.counts }); return true;
    }
    if (route === "anh-bao-sai/quyet") {
      if (!reviewer) { sendJson(res, 403, { ok: false, error: "khong_duoc_duyet_anh", message: "Duyệt ảnh báo sai do nơi cấp phần mềm làm." }); return true; }
      const standard = body["chuan"] === true;
      const { entry, source } = reports.decide(String(body["id"] ?? ""), standard, `shop:${tenant}`);
      this.options.logger.info(`[bao-anh-sai] shop "${tenant}" quyet ${entry.ma} (${entry.key}): ${standard ? "anh chuan, tra lai" : "sai, chan han"}${source ? ` — nguon ${source.host}${source.chan ? " BI CHAN" : ` ${source.maSai.length} ma sai`}` : ""}`);
      sendJson(res, 200, { ok: true, ca: this.caseView(entry) });
      this.options.onReportsChanged?.();
      return true;
    }
    if (route === "nguon-anh/danh-sach") {
      if (!reviewer) { sendJson(res, 200, { ok: true, duocDuyet: false, ds: [] }); return true; }
      sendJson(res, 200, { ok: true, duocDuyet: true, ds: this.sourceTable(), nguongHaBac: DOWNGRADE_AFTER_CODES }); return true;
    }
    sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
  }

  private mediaKeys(media: LibraryMedia): string[] {
    return [media.sourceUrl, media.assetUrl, media.storageUrl].map((u) => imageKey(u)).filter(Boolean);
  }

  /** Danh tính tấm ảnh shop đang giữ: theo ảnh nguồn của tấm đó trong thư viện, không thì theo chính địa chỉ. */
  private keyOf(code: string, url: string): string {
    const k = imageKey(url);
    const media = this.options.library.lookup(code).product?.media.find((m) => this.mediaKeys(m).includes(k));
    return imageKey(media?.sourceUrl || url);
  }

  private resolveImages(code: string, assets: string[], brandHint: string): ImageToReport[] {
    const product = this.options.library.lookup(code).product;
    const out: ImageToReport[] = [];
    for (const asset of assets) {
      const k = imageKey(asset);
      if (!k) continue;
      const media = product?.media.find((m) => this.mediaKeys(m).includes(k));
      const key = imageKey(media?.sourceUrl || asset);
      const same = this.options.library.productsWithMedia((m) => this.mediaKeys(m).includes(key));
      const trang = media?.source.url ?? "";
      out.push({
        key, anh: media?.assetUrl || asset, trang, host: hostOf(trang), hang: product?.brand || brandHint,
        assets: [...new Set([asset, ...same.flatMap((x) => x.media.flatMap((m) => [m.assetUrl, m.storageUrl, m.sourceUrl]))].filter(Boolean))],
        maCung: same.map((x) => x.product.code)
      });
    }
    return out;
  }

  /** Nguồn từng ảnh shop đang giữ (nhãn trên trang sản phẩm, danh sách "máy nghi"). */
  private sourcesOf(code: string, assets: string[], brandHint: string, tenant: string): Record<string, unknown> {
    const reports = this.options.reports!;
    const product = this.options.library.lookup(code).product;
    const brand = product?.brand || brandHint;
    const feed = reports.feedFor(tenant);
    const anh = assets.map((url) => {
      const k = imageKey(url);
      const media = product?.media.find((m) => this.mediaKeys(m).includes(k));
      const trang = media?.source.url ?? "";
      const host = hostOf(trang);
      const base = trang && this.options.sources ? this.options.sources.baseTier(trang) : null;
      const entry = reports.byKey(imageKey(media?.sourceUrl || url));
      const state = entry ? feed.find((f) => f.id === entry.id)?.trangThai : undefined;
      return {
        url, trang, host, nguon: media?.source.provider ?? "",
        bac: media?.source.provider === "anh-shop-chia-se" ? "shop-chia-se" : base ? reports.effectiveTier(host, brand, base) : "",
        trangThai: state && state !== "tra-lai" ? state : "", ca: entry?.id ?? ""
      };
    });
    return { ma: code, hang: brand, thuVienCoHang: Boolean(product?.brand), anh };
  }

  private caseView(entry: ImageCase): Record<string, unknown> {
    const reports = this.options.reports!;
    const product = this.options.library.lookup(entry.ma).product;
    const base = entry.trang && this.options.sources ? this.options.sources.baseTier(entry.trang) : "khac";
    const source = reports.sources().find((r) => r.host === entry.host && r.hang === entry.hang.toLowerCase());
    const others = product ? this.visible(product, null).media.filter((m) => !this.mediaKeys(m).includes(entry.key)).slice(0, 8).map((m) => m.assetUrl) : [];
    return {
      id: entry.id, ma: entry.ma, ten: product?.name ?? "", hang: entry.hang, maCung: entry.maCung, anh: entry.anh, trang: entry.trang, host: entry.host,
      bac: base, bacThat: entry.host ? reports.effectiveTier(entry.host, entry.hang, base) : base,
      nguoiBao: entry.nguoiBao, phanDoi: entry.phanDoi,
      soShopDangAn: Object.values(entry.apDung).filter((n) => n > 0).length, soAnhDangAn: Object.values(entry.apDung).reduce((a, n) => a + n, 0),
      trangThai: entry.trangThai, taoLuc: entry.taoLuc, quyetLuc: entry.quyetLuc ?? "", nguoiQuyet: entry.nguoiQuyet ?? "",
      anhKhac: others, thuVienCoHang: Boolean(product?.brand),
      nguon: { maSai: source?.maSai.length ?? 0, chan: source?.chan ?? false, nguong: DOWNGRADE_AFTER_CODES }
    };
  }

  /** Bảng uy tín: trang có trong thư viện (số ảnh, số mã) gộp với sổ (mã sai, bị chặn). */
  private sourceTable(): Record<string, unknown>[] {
    const reports = this.options.reports!;
    const rows = new Map<string, { host: string; hang: string; soAnh: number; ma: Set<string>; trang: string }>();
    for (const { product, media } of this.options.library.productsWithMedia(() => true)) {
      for (const m of media) {
        const host = hostOf(m.source.url);
        if (!host || m.source.provider === "anh-shop-chia-se") continue;
        const hang = product.brand.trim().toLowerCase();
        const key = `${host}|${hang}`;
        const row = rows.get(key) ?? { host, hang, soAnh: 0, ma: new Set<string>(), trang: m.source.url };
        row.soAnh += 1; row.ma.add(product.code); rows.set(key, row);
      }
    }
    const records = reports.sources();
    for (const r of records) if (!rows.has(`${r.host}|${r.hang}`)) rows.set(`${r.host}|${r.hang}`, { host: r.host, hang: r.hang, soAnh: 0, ma: new Set(), trang: `https://${r.host}/` });
    return [...rows.values()].map((row) => {
      const record = records.find((r) => r.host === row.host && r.hang === row.hang);
      const base = this.options.sources ? this.options.sources.baseTier(row.trang) : "khac";
      return { host: row.host, hang: row.hang, soAnh: row.soAnh, soMa: row.ma.size, bac: base, bacThat: reports.effectiveTier(row.host, row.hang, base), maSai: record?.maSai.length ?? 0, chan: record?.chan ?? false, chanVi: record?.chanVi ?? "" };
    }).sort((a, b) => Number(b.chan) - Number(a.chan) || b.maSai - a.maSai || b.soAnh - a.soAnh).slice(0, 300);
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
