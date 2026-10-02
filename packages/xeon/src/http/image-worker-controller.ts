/** @file Private HTTP protocol for Image Tool workers. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { ImageJobQueue } from "../product-library/image-job-queue";
import type { ProductLibrary } from "../product-library/product-library";
import type { SharedImageBook } from "../product-library/shared-image-book";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

/** `logo-xong` mang một ảnh (base64, tối đa 15 MB) — các đường khác giữ trần mặc định. */
const LOGO_RESULT_BYTES = 21 * 1024 * 1024;

export class ImageWorkerController implements RequestController {
  /**
   * `onSettled`: một việc vừa xong hoặc vừa lỗi — sổ lô ảnh xem lô nào đã đủ để đẩy về landing (30/09/2026).
   * `shared` (02/10/2026): ảnh shop chia sẻ — máy chủ ảnh xin lô gỡ logo (`logo-nhan`) và trả từng ảnh (`logo-xong`).
   */
  constructor(private readonly options: { queue: ImageJobQueue; library: ProductLibrary; key: string; onSettled?: () => void; shared?: SharedImageBook }) {}
  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!ctx.path.startsWith("/image-worker/")) return false;
    if (!this.options.key) { sendJson(res, 503, { ok: false, error: "worker_chua_bat" }); return true; }
    if (!constantTimeEqual(bearerToken(req), this.options.key)) { sendJson(res, 401, { ok: false, error: "sai_ma_worker" }); return true; }
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }
    const body = await ctx.readJson(ctx.path === "/image-worker/logo-xong" ? LOGO_RESULT_BYTES : undefined); if (body === null) return true; const worker = String(body["worker"] ?? "").slice(0, 100);
    try {
      if (ctx.path === "/image-worker/nhan") { sendJson(res, 200, { ok: true, job: this.options.queue.claim(worker) }); return true; }
      if (ctx.path === "/image-worker/gia-han") { sendJson(res, 200, { ok: true, job: this.options.queue.renew(String(body["id"] ?? ""), worker) }); return true; }
      if (ctx.path === "/image-worker/hoan-tat") {
        const owned = this.options.queue.assertOwned(String(body["id"] ?? ""), worker); const raw = body["sanPham"] as Record<string, unknown> | null;
        const returnedCode = String(raw?.["code"] ?? "").trim().toUpperCase().replace(/[^A-Z0-9._/-]/g, ""); if (returnedCode !== owned.code) throw new Error("Mã kết quả không khớp job.");
        const product = this.options.library.mergeWorkerResult(raw, owned.brokenAssetUrls ?? []); const job = this.options.queue.finish(owned.id, worker); sendJson(res, 200, { ok: true, job, product }); this.options.onSettled?.(); return true;
      }
      if (ctx.path === "/image-worker/loi") { sendJson(res, 200, { ok: true, job: this.options.queue.fail(String(body["id"] ?? ""), worker, String(body["loi"] ?? "")) }); this.options.onSettled?.(); return true; }
      if (ctx.path === "/image-worker/logo-nhan") { sendJson(res, 200, { ok: true, lo: this.options.shared?.claimBatch(worker) ?? null }); return true; }
      if (ctx.path === "/image-worker/logo-xong") {
        const shared = this.options.shared;
        if (!shared) throw new Error("Xeon chưa bật ảnh chia sẻ.");
        const encoded = String(body["anhBase64"] ?? "");
        // Ảnh cất vào kho asset TRƯỚC, sổ ghi sau: sổ trỏ tới tệp không có còn tệ hơn tệp thừa.
        const asset = encoded ? this.options.library.storeAsset(Buffer.from(encoded, "base64")) : null;
        const image = shared.settle(worker, String(body["lo"] ?? ""), body["ketQua"], asset?.name ?? "");
        sendJson(res, 200, { ok: true, trangThai: image.state }); return true;
      }
      sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
    } catch (error) { sendJson(res, 409, { ok: false, error: "job_khong_hop_le", message: error instanceof Error ? error.message : String(error) }); return true; }
  }
}
