/** @file Private HTTP protocol for Image Tool workers. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { ImageJobQueue } from "../product-library/image-job-queue";
import type { ProductLibrary } from "../product-library/product-library";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export class ImageWorkerController implements RequestController {
  constructor(private readonly options: { queue: ImageJobQueue; library: ProductLibrary; key: string }) {}
  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!ctx.path.startsWith("/image-worker/")) return false;
    if (!this.options.key) { sendJson(res, 503, { ok: false, error: "worker_chua_bat" }); return true; }
    if (!constantTimeEqual(bearerToken(req), this.options.key)) { sendJson(res, 401, { ok: false, error: "sai_ma_worker" }); return true; }
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }
    const body = await ctx.readJson(); if (body === null) return true; const worker = String(body["worker"] ?? "").slice(0, 100);
    try {
      if (ctx.path === "/image-worker/nhan") { sendJson(res, 200, { ok: true, job: this.options.queue.claim(worker) }); return true; }
      if (ctx.path === "/image-worker/gia-han") { sendJson(res, 200, { ok: true, job: this.options.queue.renew(String(body["id"] ?? ""), worker) }); return true; }
      if (ctx.path === "/image-worker/hoan-tat") {
        const owned = this.options.queue.assertOwned(String(body["id"] ?? ""), worker); const raw = body["sanPham"] as Record<string, unknown> | null;
        const returnedCode = String(raw?.["code"] ?? "").trim().toUpperCase().replace(/[^A-Z0-9._/-]/g, ""); if (returnedCode !== owned.code) throw new Error("Mã kết quả không khớp job.");
        const product = this.options.library.mergeWorkerResult(raw, owned.brokenAssetUrls ?? []); const job = this.options.queue.finish(owned.id, worker); sendJson(res, 200, { ok: true, job, product }); return true;
      }
      if (ctx.path === "/image-worker/loi") { sendJson(res, 200, { ok: true, job: this.options.queue.fail(String(body["id"] ?? ""), worker, String(body["loi"] ?? "")) }); return true; }
      sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
    } catch (error) { sendJson(res, 409, { ok: false, error: "job_khong_hop_le", message: error instanceof Error ? error.message : String(error) }); return true; }
  }
}
