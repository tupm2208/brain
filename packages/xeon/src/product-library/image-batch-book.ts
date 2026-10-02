/**
 * @file LÔ ẢNH — xong một lô thì Xeon tự đẩy kết quả về landing của shop, một lần.
 *
 * 30/09/2026. Trước hôm nay chỉ có MÀN OMI "Hoàn thiện dữ liệu" lưu kết quả Image Tool vào kho: nó
 * hỏi `tien-trinh` năm giây một lần và gọi `bo-sung` cho mã nào xong — mà chỉ khi màn đang mở. Tối
 * 30/09 shop sadida gửi lô 50 mã lúc 23:02 rồi rời màn: Image Tool bóc xong cả lô lúc 23:07, ảnh
 * nằm trên Xeon không về kho, còn màn đứng mãi ở "16 đang chạy · 34 đang chờ".
 *
 * Nay mỗi lần một shop hỏi (`tra-nhieu` / `tra-ma`; OMI gửi lô 50 mã) là MỘT LÔ, ghi ở
 * `image-batches.json`. Khi mọi việc của lô đã ngã ngũ, Xeon gọi
 * `POST /api/hang-kho/thu-vien/ket-qua-tu-xeon` trên landing của shop đó với các mã đã xong, và
 * landing tự tải ảnh vào kho. Màn OMI có mở hay không không còn quan trọng.
 *
 * Những điều phải giữ (phần lớn do agent phản biện bắt ngày 30/09):
 * - "Ngã ngũ" = không còn việc nào đang chạy hay đang chờ lượt đầu. Việc báo LỖI thì hàng đợi hẹn
 *   lại 15-60 phút; bắt 49 mã xong chờ một mã hẹn lại suốt hai tiếng là vô lý, nên lô gửi phần đã
 *   xong trước, mã đang hẹn lại được gửi thêm một lần khi nó xong. Hàng đợi đang DỪNG thì việc chờ
 *   cũng không giữ lô — "Dừng an toàn" hứa "tác vụ đang chạy sẽ được lưu xong".
 * - Gửi thành từng gói nhỏ (`BATCH_PUSH_CHUNK`). Landing tải ảnh TUẦN TỰ, tới 12 tấm một mã, và
 *   đường qua Cloudflare cắt mọi request quá 100 giây (HTTP 524).
 * - Một gói chậm không được chặn cả lô: mã của gói hỏng bị đếm lỗi và xếp gửi SAU CÙNG ở lượt sau;
 *   hỏng quá `CODE_GIVE_UP_AFTER` lần thì bỏ riêng mã đó. Landing im hẳn (mạng, quá hạn) thì thôi
 *   gọi shop đó trong lượt này — không đốt 95 giây cho từng lô, không bắt shop khác chờ.
 * - Landing trả 401/403/404 là hỏng HẲN (landing cũ chưa có cửa, vé không hợp lệ): bỏ lô, không
 *   gọi lại ba ngày.
 * - Chỉ gửi mã đã `done`. Mã `failed` không có gì để lưu; gửi nó đi thì landing hỏi lại
 *   `tra-nhieu`, thư viện chưa có gì, Xeon xếp việc mới — một vòng lặp không đáy. Cùng lý do,
 *   `bao-asset-loi` KHÔNG mở lô (xem `product-library-controller.ts`).
 * - Không bao giờ ném lỗi ra ngoài: `deliverReady()` chạy theo kiểu "bắn rồi quên" từ đồng hồ và từ
 *   `hoan-tat`; một lỗi ghi tệp (EPERM trên Windows) mà thành promise bị từ chối là sập cả Xeon.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import type { LicenseService } from "../license/license-service";
import type { ActivityLog } from "../support/activity-log";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import type { ImageJob, ImageJobQueue } from "./image-job-queue";

export const BATCH_FILE = "image-batches.json";
/** Tối đa mã một lô. Lô nhập file 1.000 mã mà để nguyên thì không gửi gì cho tới khi xong cả nghìn mã. */
export const BATCH_MAX_CODES = 50;
/** Mã mỗi lời gọi. 5 mã x 12 ảnh tuần tự vẫn dưới trần 100 giây của Cloudflare. */
export const BATCH_PUSH_CHUNK = 5;
/** Dưới trần 100 giây của Cloudflare: quá hạn thì tự bỏ trước khi Cloudflare trả 524. */
export const BATCH_PUSH_TIMEOUT_MS = 95_000;
/** Landing không nhận thì hẹn lại: 1, 5, 15, 30 phút, rồi mỗi giờ. */
export const BATCH_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 1_800_000, 3_600_000] as const;
/** Lô quá ba ngày mà vẫn chưa gửi được thì bỏ. */
export const BATCH_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Một mã hỏng chừng ấy lần gửi thì bỏ riêng mã đó, để phần còn lại của lô đóng được. */
export const CODE_GIVE_UP_AFTER = 5;
/** Landing trả mấy mã này là landing không có cửa / không nhận vé — gọi lại cũng thế. */
const PERMANENT_STATUSES = new Set([401, 403, 404]);

export interface ImageBatch {
  id: string;
  shop: string;
  taoLuc: string;
  viec: { id: string; code: string }[];
  /** Mã đã ngã ngũ hẳn: đã gửi về landing, việc chết (không có gì để gửi), hoặc gửi hỏng quá nhiều lần. */
  xong: string[];
  lanGui: number;
  loiCuoi?: string;
  thuLaiLuc?: string;
  /** Số lần gửi hỏng của từng mã — mã hay hỏng được gửi sau cùng. */
  loiTheoMa?: Record<string, number>;
}

interface BatchDocument { phienBan: 1; lo: ImageBatch[] }

export interface ImageBatchBookOptions {
  queue: ImageJobQueue;
  license: LicenseService;
  clock: Clock;
  logger: Logger;
  /** `null` = chỉ trong bộ nhớ (bài kiểm tra). */
  dataDirectory: string | null;
  fetch?: FetchLike | undefined;
  activityLog?: ActivityLog | undefined;
}

type JobState = "gui-duoc" | "xong-han" | "dang-lam" | "hen-lai";

/**
 * Việc chờ với `attempts >= 5` không bao giờ được nhận lại (`claim` lọc `attempts < 5`), nên coi như
 * chết. Hàng đợi đang dừng thì việc chờ không giữ lô.
 */
const stateOf = (job: ImageJob | undefined, paused: boolean): JobState => {
  if (!job || job.status === "failed") return "xong-han";
  if (job.status === "done") return "gui-duoc";
  if (job.status === "running") return "dang-lam";
  if (job.attempts >= 5) return "xong-han";
  if (paused) return "hen-lai";
  return job.error ? "hen-lai" : "dang-lam";
};

export class ImageBatchBook {
  private readonly filePath: string | null;
  private doc: BatchDocument;
  private readonly gateways = new Map<string, { origin: string; gateway: LandingGateway }>();
  private inFlight: Promise<number> | null = null;
  private again = false;

  constructor(private readonly options: ImageBatchBookOptions) {
    this.filePath = options.dataDirectory ? path.join(options.dataDirectory, BATCH_FILE) : null;
    this.doc = this.load();
  }

  /**
   * Mở lô cho những việc shop vừa hỏi, tối đa `BATCH_MAX_CODES` mã một lô. Không có shop (mã dùng
   * chung kiểu cũ) hay không có việc thì thôi. Không ném lỗi: hỏng ghi tệp thì lô vẫn sống trong
   * bộ nhớ, và việc đã xếp của shop không được biến thành câu trả lời hỏng.
   */
  open(shop: string | null, jobs: readonly ImageJob[]): ImageBatch[] {
    const owner = String(shop ?? "").trim();
    const seen = new Set<string>();
    const viec = jobs.filter((job) => !seen.has(job.id) && seen.add(job.id)).map((job) => ({ id: job.id, code: job.code }));
    if (!owner || viec.length === 0) return [];
    const at = this.options.clock.now().toISOString();
    const opened: ImageBatch[] = [];
    for (let start = 0; start < viec.length; start += BATCH_MAX_CODES) {
      opened.push({ id: `lo_${crypto.randomUUID()}`, shop: owner, taoLuc: at, viec: viec.slice(start, start + BATCH_MAX_CODES), xong: [], lanGui: 0 });
    }
    this.doc.lo.push(...opened); this.trySave();
    return opened.map((batch) => ({ ...batch }));
  }

  list(): ImageBatch[] { return this.doc.lo.map((batch) => ({ ...batch })); }

  /**
   * Gửi mọi lô đã ngã ngũ. Gọi sau mỗi `hoan-tat` / `loi` của Image Tool và theo đồng hồ một phút.
   * Đang gửi dở mà có người gọi nữa thì chạy thêm một vòng sau đó, không chạy song song.
   */
  deliverReady(): Promise<number> {
    if (this.inFlight) { this.again = true; return this.inFlight; }
    const run = async (): Promise<number> => {
      let total = 0;
      do {
        this.again = false;
        try { total += await this.pass(); }
        catch (error) { this.options.logger.warn(`[lo-anh] vong gui hong: ${error instanceof Error ? error.message : String(error)}`); }
      } while (this.again);
      return total;
    };
    this.inFlight = run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async pass(): Promise<number> {
    const started = this.options.clock.now().getTime();
    const paused = this.options.queue.control().paused;
    const jobs = this.options.queue.getMany(this.doc.lo.flatMap((batch) => batch.viec.filter((entry) => !batch.xong.includes(entry.code)).map((entry) => entry.id)));
    const closed = new Set<string>();
    const silentShops = new Set<string>();
    let sent = 0;
    for (const batch of [...this.doc.lo]) {
      if (started - Date.parse(batch.taoLuc) > BATCH_MAX_AGE_MS) {
        this.options.logger.warn(`[lo-anh] bo lo ${batch.id} cua shop "${batch.shop}" qua 3 ngay (gui ${batch.lanGui} lan, loi cuoi: ${batch.loiCuoi ?? "chua gui"})`);
        closed.add(batch.id); continue;
      }
      if (silentShops.has(batch.shop)) continue;
      if (batch.thuLaiLuc && Date.parse(batch.thuLaiLuc) > started) continue;
      const xong = new Set(batch.xong);
      const errors = { ...(batch.loiTheoMa ?? {}) };
      const ready: string[] = []; let busy = false; let waitingRetry = false;
      for (const entry of batch.viec) {
        if (xong.has(entry.code)) continue;
        const state = stateOf(jobs.get(entry.id), paused);
        if (state === "gui-duoc") ready.push(entry.code);
        else if (state === "xong-han") xong.add(entry.code);
        else if (state === "dang-lam") busy = true;
        else waitingRetry = true;
      }
      if (busy || ready.length === 0) {
        batch.xong = [...xong];
        if (!busy && !waitingRetry) closed.add(batch.id);
        continue;
      }
      // Mã hay hỏng gửi sau cùng: một mã có ảnh treo không được chặn mã khác của lô.
      ready.sort((a, b) => (errors[a] ?? 0) - (errors[b] ?? 0));
      let failure: { viSao: string } | null = null;
      // Hàng gói cần gửi; gói nhiều mã mà landing TRẢ LỜI lỗi thì tách ra gửi lại từng mã, để chỉ mã
      // thật sự hỏng bị đếm lỗi và mã lành trong cùng gói vẫn về kho ngay lượt này.
      const chunks: string[][] = [];
      for (let start = 0; start < ready.length; start += BATCH_PUSH_CHUNK) chunks.push(ready.slice(start, start + BATCH_PUSH_CHUNK));
      while (chunks.length) {
        const chunk = chunks.shift()!;
        const result = await this.send(batch, chunk);
        if (result.ok) { for (const code of chunk) xong.add(code); sent += chunk.length; continue; }
        if (result.permanent) {
          this.options.logger.warn(`[lo-anh] landing cua shop "${batch.shop}" khong nhan lo ${batch.id} (${result.viSao}) — bo lo, khong goi lai`);
          closed.add(batch.id); failure = null; break;
        }
        failure = result;
        // Landing im hẳn (mạng, quá hạn): thôi gọi shop này trong lượt này — mỗi lần thử là 95 giây.
        if (result.status === 0) {
          for (const code of chunk) errors[code] = (errors[code] ?? 0) + 1;
          silentShops.add(batch.shop); break;
        }
        if (chunk.length > 1) { chunks.unshift(...chunk.map((code) => [code])); continue; }
        const code = chunk[0]!;
        errors[code] = (errors[code] ?? 0) + 1;
        if (errors[code]! >= CODE_GIVE_UP_AFTER) { xong.add(code); this.options.logger.warn(`[lo-anh] bo ma ${code} cua lo ${batch.id}: gui hong ${errors[code]} lan (${result.viSao})`); }
      }
      batch.xong = [...xong];
      if (Object.keys(errors).length) batch.loiTheoMa = errors;
      if (failure) {
        batch.lanGui += 1; batch.loiCuoi = failure.viSao;
        const delay = BATCH_RETRY_DELAYS_MS[Math.min(batch.lanGui - 1, BATCH_RETRY_DELAYS_MS.length - 1)]!;
        // Đọc đồng hồ LÚC HỎNG: một lượt có thể kéo dài nhiều phút, giờ đầu lượt đã cũ.
        batch.thuLaiLuc = new Date(this.options.clock.now().getTime() + delay).toISOString();
        this.options.logger.warn(`[lo-anh] chua gui het lo ${batch.id} cho shop "${batch.shop}": ${failure.viSao} — hen lai sau ${Math.round(delay / 60_000)} phut`);
      } else { delete batch.loiCuoi; delete batch.thuLaiLuc; }
      if (batch.viec.every((entry) => xong.has(entry.code))) closed.add(batch.id);
      this.trySave();
    }
    // Lọc theo mã lô, không gán lại mảng đã chụp: trong lúc chờ mạng, `open()` có thể vừa thêm lô mới.
    if (closed.size) { this.doc.lo = this.doc.lo.filter((batch) => !closed.has(batch.id)); this.trySave(); }
    return sent;
  }

  private async send(batch: ImageBatch, codes: string[]): Promise<{ ok: true } | { ok: false; viSao: string; status: number; permanent: boolean }> {
    const landing = this.options.license.landingFor(batch.shop);
    if (!landing.ok) return { ok: false, viSao: landing.viSao, status: -1, permanent: true };
    const result = await this.gatewayFor(batch.shop, landing.diaChi).pushImageResults({ lo: batch.id, ma: codes });
    if (result.ok) { this.options.logger.info(`[lo-anh] da gui ${codes.length} ma cua lo ${batch.id} ve shop "${batch.shop}" — landing bo sung ${result.daBoSung} ma`); return { ok: true }; }
    return { ...result, permanent: PERMANENT_STATUSES.has(result.status) };
  }

  private gatewayFor(shop: string, origin: string): LandingGateway {
    const known = this.gateways.get(shop);
    if (known && known.origin === origin) return known.gateway;
    const tickets = new ServiceTicketProvider(this.options.license, shop, this.options.clock);
    const gateway = new LandingGateway({
      origin, ticket: () => tickets.ticket(), fetch: this.options.fetch, timeoutMs: BATCH_PUSH_TIMEOUT_MS,
      logger: this.options.logger, clock: this.options.clock, activityLog: this.options.activityLog, shop
    });
    this.gateways.set(shop, { origin, gateway });
    return gateway;
  }

  private load(): BatchDocument {
    if (this.filePath === null) return { phienBan: 1, lo: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<BatchDocument>;
      return { phienBan: 1, lo: Array.isArray(parsed.lo) ? parsed.lo : [] };
    } catch {
      return { phienBan: 1, lo: [] };
    }
  }

  /** Hỏng ghi (EPERM khi diệt virus giữ tệp, đầy đĩa) chỉ là một dòng cảnh báo: sổ vẫn sống trong bộ nhớ, lần ghi sau bù. */
  private trySave(): void {
    if (this.filePath === null) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.doc), "utf8");
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      this.options.logger.warn(`[lo-anh] khong ghi duoc ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
