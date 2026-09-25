/** @file Durable, deduplicated work queue used by headless Image Tool workers. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

export interface ImageJob {
  id: string; code: string; status: "waiting" | "running" | "done" | "failed"; attempts: number;
  createdAt: string; updatedAt: string; leaseUntil?: string; worker?: string; error?: string;
  requestedFields?: string[]; brokenAssetUrls?: string[];
  /**
   * 24/09/2026 — HÃNG, đi cùng mã xuống tận bộ cào.
   *
   * Không có nó thì `fast_backend` bỏ qua cả nhánh adidas.com.vn (`_is_adidas_brand("")` là sai),
   * chỉ còn 17 đại lý — mà hàng đời cũ thì đại lý gỡ hết. 476 mã của shop nằm im vì thế, dù ảnh
   * chính hãng vẫn còn nguyên: FX3624 khai hãng vào là ra 9 tấm, không khai thì ra con số không.
   * Landing biết hãng từ đầu (cột `hang`); việc duy nhất phải làm là chuyển nó xuống.
   */
  brand?: string;
}
interface QueueDocument { version: 1; jobs: ImageJob[]; paused?: boolean }
/** `failed` (24/09/2026): số việc chết của CẢ hàng đợi — màn hình đếm trong danh sách đã cắt thì
 *  ba việc chết hôm 19/09 rơi ra ngoài, nút "Chạy lại việc lỗi" tự ẩn và không cửa nào mở lại được. */
export interface QueueControl { paused: boolean; running: number; waiting: number; failed: number; capacity: number; max: number }
const key = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9._/-]/g, "").slice(0, 100);

export class ImageJobQueue {
  private doc: QueueDocument;
  constructor(private readonly directory: string | null, private readonly now: () => Date = () => new Date(), private readonly maxConcurrent = 16) { this.doc = this.load(); }
  private capacity(): number {
    const cpu = Math.max(1, os.cpus().length);
    const byMemory = Math.max(1, Math.floor(os.freemem() / (700 * 1024 * 1024)));
    const load = os.loadavg()[0] || 0; const byLoad = load > cpu * 0.9 ? Math.max(1, Math.floor(cpu / 3)) : cpu;
    return Math.max(1, Math.min(16, this.maxConcurrent, cpu, byMemory, byLoad));
  }
  enqueue(code: string, request: { requestedFields?: unknown; brokenAssetUrls?: unknown; brand?: unknown } = {}): ImageJob {
    const normalized = key(code); if (!normalized) throw new Error("Mã sản phẩm không hợp lệ.");
    const brand = String(request.brand ?? "").trim().slice(0, 100);
    const requestedFields = [...new Set((Array.isArray(request.requestedFields) ? request.requestedFields : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 50);
    const brokenAssetUrls = [...new Set((Array.isArray(request.brokenAssetUrls) ? request.brokenAssetUrls : []).map((x) => String(x).trim()).filter((x) => /^https:\/\//i.test(x)))].slice(0, 50);
    const active = this.doc.jobs.find((j) => j.code === normalized && (j.status === "waiting" || j.status === "running"));
    if (active) {
      active.requestedFields = [...new Set([...(active.requestedFields ?? []), ...requestedFields])];
      active.brokenAssetUrls = [...new Set([...(active.brokenAssetUrls ?? []), ...brokenAssetUrls])];
      if (brand && !active.brand) active.brand = brand;   // biết muộn còn hơn không bao giờ biết
      active.updatedAt = this.now().toISOString(); this.save(); return { ...active };
    }
    const at = this.now().toISOString();
    const job: ImageJob = { id: `img_${crypto.randomUUID()}`, code: normalized, status: "waiting", attempts: 0, createdAt: at, updatedAt: at,
      ...(requestedFields.length ? { requestedFields } : {}), ...(brokenAssetUrls.length ? { brokenAssetUrls } : {}), ...(brand ? { brand } : {}) };
    this.doc.jobs.push(job); this.save(); return job;
  }
  claim(worker: string, leaseMs = 30 * 60 * 1000): ImageJob | null {
    const now = this.now(); const owner = String(worker || "worker").slice(0, 100);
    for (const job of this.doc.jobs) if (job.status === "running" && Date.parse(job.leaseUntil ?? "") <= now.getTime()) { job.status = "waiting"; delete job.leaseUntil; delete job.worker; }
    // A scheduled worker can be restarted while a browser scrape is in flight.
    // Let the same logical worker immediately resume its leased job instead of
    // waiting for expiry or claiming a second job. Resuming is not a new attempt.
    const resumed = this.doc.jobs.filter((j) => j.status === "running" && j.worker === owner).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))[0];
    if (resumed) { resumed.updatedAt = now.toISOString(); resumed.leaseUntil = new Date(now.getTime() + Math.max(30_000, leaseMs)).toISOString(); this.save(); return { ...resumed }; }
    if (this.doc.paused) { this.save(); return null; }
    if (this.doc.jobs.filter((j) => j.status === "running").length >= this.capacity()) { this.save(); return null; }
    const job = this.doc.jobs.filter((j) => j.status === "waiting" && j.attempts < 5).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    if (!job) { this.save(); return null; }
    job.status = "running"; job.worker = owner; job.attempts += 1; job.updatedAt = now.toISOString(); job.leaseUntil = new Date(now.getTime() + Math.max(30_000, leaseMs)).toISOString(); this.save(); return { ...job };
  }
  finish(id: string, worker: string): ImageJob { const job = this.owned(id, worker); job.status = "done"; job.updatedAt = this.now().toISOString(); delete job.leaseUntil; this.save(); return { ...job }; }
  renew(id: string, worker: string, leaseMs = 10 * 60 * 1000): ImageJob {
    const job = this.owned(id, worker); const now = this.now(); job.updatedAt = now.toISOString(); job.leaseUntil = new Date(now.getTime() + Math.max(30_000, leaseMs)).toISOString(); this.save(); return { ...job };
  }
  assertOwned(id: string, worker: string): ImageJob { return { ...this.owned(id, worker) }; }
  fail(id: string, worker: string, error: string): ImageJob { const job = this.owned(id, worker); job.status = job.attempts >= 5 ? "failed" : "waiting"; job.error = String(error).slice(0, 1000); job.updatedAt = this.now().toISOString(); delete job.leaseUntil; delete job.worker; this.save(); return { ...job }; }
  /**
   * 24/09/2026: chỗ này từng cắt 1.000 việc mới nhất RỒI mới để người gọi lọc theo mã. Hàng đợi có
   * 2.389 việc, nên 971 trong 1.767 mã không bao giờ lọt vào câu trả lời: màn hình hỏi "mã của tôi
   * xong chưa?", nhận về rỗng — không thấy `done`, cũng không thấy `failed` — nên giữ mã trong danh
   * sách chờ và hỏi lại sau 5 giây, vĩnh viễn. Lọc TRƯỚC, cắt SAU.
   */
  list(codes?: readonly string[]): ImageJob[] {
    const wanted = codes === undefined ? null : new Set(codes.map(key).filter(Boolean));
    return this.doc.jobs.filter((job) => wanted === null || wanted.has(job.code))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 1000);
  }
  setPaused(paused: boolean): QueueControl { this.doc.paused = paused; this.save(); return this.control(); }
  control(): QueueControl { return { paused: this.doc.paused === true, running: this.doc.jobs.filter((j) => j.status === "running").length, waiting: this.doc.jobs.filter((j) => j.status === "waiting").length, failed: this.doc.jobs.filter((j) => j.status === "failed").length, capacity: this.capacity(), max: Math.min(16, this.maxConcurrent) }; }
  /**
   * Mo lai MOI viec dang o trang thai `failed`.
   *
   * 23/09/2026: truoc day cho nay chi mo lai viec chet vi HTTP 409 — cai loi tu no khoi duoc. Nhung
   * ham nay chi chay khi NGUOI bam "Chay lai viec loi": luc do ho vua sua xong cai gay ra loi (hom
   * nay la ba ma chet vi may thieu thu vien `lxml`), va y ho la chay lai TAT CA. Loc theo 409 khien
   * nhung viec do nam chet vinh vien, khong cua nao mo lai duoc tru viec go tay vao tep hang doi.
   */
  retryFailed(): { retried: number } { let retried = 0; for (const job of this.doc.jobs) if (job.status === "failed") { job.status = "waiting"; job.attempts = 0; delete job.error; delete job.worker; delete job.leaseUntil; retried += 1; } this.save(); return { retried }; }
  private owned(id: string, worker: string): ImageJob { const job = this.doc.jobs.find((j) => j.id === id); if (!job || job.status !== "running" || job.worker !== worker || Date.parse(job.leaseUntil ?? "") <= this.now().getTime()) throw new Error("Job không còn thuộc worker này."); return job; }
  private load(): QueueDocument { if (this.directory === null) return { version: 1, jobs: [] }; try { const value = JSON.parse(fs.readFileSync(path.join(this.directory, "image-worker-jobs.json"), "utf8")) as QueueDocument; return value.version === 1 && Array.isArray(value.jobs) ? value : { version: 1, jobs: [] }; } catch { return { version: 1, jobs: [] }; } }
  private save(): void { if (this.directory === null) return; fs.mkdirSync(this.directory, { recursive: true }); const file = path.join(this.directory, "image-worker-jobs.json"); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.doc, null, 2), "utf8"); fs.renameSync(tmp, file); }
}
