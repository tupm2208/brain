/**
 * @file Ảnh shop CHIA SẺ vào thư viện chung — chờ gỡ logo, chờ người duyệt (02/10/2026).
 *
 * Anh chốt 02/10/2026:
 *  - Ảnh từ kho gốc của một shop (Sapo...) chỉ shop đó dùng, TRỪ KHI shop tự chọn chia sẻ (ô trong
 *    cấu hình shop, mặc định không chia).
 *  - Ảnh shop có thể đóng logo shop. Máy chủ ảnh dò + gỡ logo (chỉ tính ngược logo mờ, tô nền, cắt
 *    mép — KHÔNG vẽ lại). Ảnh không gỡ được thì không chia.
 *  - MỌI ảnh từ shop vào hệ thống chung phải qua NGƯỜI DUYỆT (màn trong OMI máy nhà phát triển).
 *  - Shop khác chỉ nhận ảnh đã duyệt, và chỉ khi máy tìm ảnh không ra (`approvedFor`).
 *
 * Vòng đời một ảnh:
 *
 *   cho-go-logo ──(máy chủ ảnh xin lô)──▶ dang-go ──▶ cho-duyet ──(người)──▶ da-duyet | da-loai
 *        ▲                                  │   └──▶ khong-chia-duoc (logo không gỡ được / lỗi 3 lần)
 *        └──── hết hạn giữ / lỗi tải ───────┘
 *   Shop tắt chia sẻ: mọi ảnh của shop → da-rut (bật lại thì chờ gỡ lại từ đầu).
 *
 * Bài học 24/09/2026: cửa duyệt đặt ở màn không ai mở thì 1.766 sản phẩm kẹt mãi. Vì thế sổ này
 * đếm số chờ duyệt để màn OMI hiện con số, và ảnh chờ duyệt KHÔNG chặn gì của shop gửi — shop đó vẫn
 * dùng ảnh gốc của mình ngay.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SharedImageState = "cho-go-logo" | "dang-go" | "cho-duyet" | "da-duyet" | "da-loai" | "khong-chia-duoc" | "da-rut";
export const SHARED_IMAGE_STATES: readonly SharedImageState[] = ["cho-go-logo", "dang-go", "cho-duyet", "da-duyet", "da-loai", "khong-chia-duoc", "da-rut"];

/** Kết quả gỡ logo do máy chủ ảnh báo về (`logo_shop.KetQua.to_json`). */
export interface LogoReport {
  trangThai: "khong-co-logo" | "da-go" | "khong-go" | "loi";
  lyDo: string;
  lop: string[];
  cach: string[];
  vung: number[][];
  kiem: Record<string, unknown>;
}

export interface SharedImage {
  id: string;
  shop: string;
  code: string;
  /** "kho-goc" (Sapo... của shop) hoặc "anh-khach" (ảnh khách người trực đã xác nhận). */
  source: string;
  /** Bản shop đang giữ (landing của shop) — máy chủ ảnh tải từ đây trước. */
  originalUrl: string;
  /** Địa chỉ ở hệ thống gốc (Sapo...) — dự phòng khi landing không trả. */
  sourceUrl: string;
  state: SharedImageState;
  logo?: LogoReport;
  /** Tệp trong kho asset của Xeon (`product-assets/<sha256>.<ext>`): bản đưa cho shop khác. */
  assetName?: string;
  attempts: number;
  lease?: { worker: string; batch: string; until: string };
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectReason?: string;
}

export interface LogoBatch {
  id: string;
  goiY: string[];
  anh: { id: string; url: string; goc: string }[];
  thamChieu: string[];
}

interface SharedImageDocument { version: 1; images: SharedImage[]; hints: Record<string, string[]> }

const BATCH_SIZE = 120;
const REFERENCE_TARGET = 40;
const LEASE_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const OFFER_CAP = 500;

const text = (value: unknown, max: number): string => String(value ?? "").trim().slice(0, max);
const httpsUrl = (value: unknown): string => {
  let url = text(value, 2000);
  if (url.startsWith("//")) url = `https:${url}`;
  return /^https?:\/\//i.test(url) ? url : "";
};
const codeKey = (value: unknown): string => text(value, 120).toUpperCase().replace(/[^A-Z0-9._/-]/g, "");
const stableId = (shop: string, code: string, url: string): string =>
  `anh_${crypto.createHash("sha1").update(`${shop}|${code}|${url}`).digest("hex").slice(0, 24)}`;

export class SharedImageBook {
  private document: SharedImageDocument;
  private sequence = 0;

  constructor(private readonly directory: string | null, private readonly now: () => Date = () => new Date()) {
    this.document = this.load();
  }

  /** Shop gửi ảnh vào (đã bật chia sẻ). Ảnh đã có thì giữ nguyên trạng thái, trừ ảnh đã rút (bật lại). */
  offer(shop: string, items: unknown[], hints: unknown[]): { added: number; known: number } {
    const owner = text(shop, 120);
    if (!owner) throw new Error("Thiếu shop.");
    const at = this.now().toISOString();
    let added = 0, known = 0;
    for (const raw of items.slice(0, OFFER_CAP)) {
      const o = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const code = codeKey(o["ma"]);
      const originalUrl = httpsUrl(o["url"]);
      const sourceUrl = httpsUrl(o["goc"]);
      if (!code || (!originalUrl && !sourceUrl)) continue;
      const id = stableId(owner, code, sourceUrl || originalUrl);
      const old = this.document.images.find((image) => image.id === id);
      if (old) {
        known += 1;
        if (old.state === "da-rut") Object.assign(old, { state: "cho-go-logo", attempts: 0, originalUrl: originalUrl || old.originalUrl, updatedAt: at });
        continue;
      }
      this.document.images.push({ id, shop: owner, code, source: text(o["nguon"], 30) || "kho-goc", originalUrl, sourceUrl, state: "cho-go-logo", attempts: 0, createdAt: at, updatedAt: at });
      added += 1;
    }
    const cleanHints = [...new Set(hints.map((h) => text(h, 120)).filter((h) => h.length >= 3))].slice(0, 12);
    if (cleanHints.length) this.document.hints[owner] = cleanHints;
    this.save();
    return { added, known };
  }

  /** Shop tắt chia sẻ: rút hết, kể cả ảnh đã duyệt — shop khác thôi nhận từ lần hỏi sau. */
  withdraw(shop: string): number {
    const at = this.now().toISOString();
    let count = 0;
    for (const image of this.document.images) {
      if (image.shop !== shop || image.state === "da-rut") continue;
      image.state = "da-rut"; delete image.lease; image.updatedAt = at; count += 1;
    }
    if (count) this.save();
    return count;
  }

  pendingLogoCount(): number {
    this.releaseExpired();
    return this.document.images.filter((image) => image.state === "cho-go-logo").length;
  }

  /** Máy chủ ảnh xin MỘT lô, của MỘT shop (dò logo lặp lại cần nhiều ảnh cùng shop). */
  claimBatch(worker: string): LogoBatch | null {
    this.releaseExpired();
    const waiting = this.document.images.filter((image) => image.state === "cho-go-logo");
    if (waiting.length === 0) return null;
    const shop = waiting.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b)).shop;
    const mine = waiting.filter((image) => image.shop === shop).slice(0, BATCH_SIZE);
    const batch = `lo_${this.now().getTime().toString(36)}_${(this.sequence += 1)}`;
    const until = new Date(this.now().getTime() + LEASE_MS).toISOString();
    for (const image of mine) { image.state = "dang-go"; image.lease = { worker: text(worker, 100), batch, until }; }
    const thamChieu = mine.length >= REFERENCE_TARGET ? [] : this.document.images
      .filter((image) => image.shop === shop && image.state !== "dang-go" && image.state !== "cho-go-logo" && image.originalUrl)
      .slice(-(REFERENCE_TARGET - mine.length)).map((image) => image.originalUrl);
    this.save();
    return { id: batch, goiY: this.document.hints[shop] ?? [], anh: mine.map((image) => ({ id: image.id, url: image.originalUrl, goc: image.sourceUrl })), thamChieu };
  }

  /** Kết quả một ảnh. `assetName` = bản đã lưu vào kho asset (ảnh sạch hoặc đã gỡ). */
  settle(worker: string, batch: string, raw: unknown, assetName = ""): SharedImage {
    const o = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const image = this.document.images.find((item) => item.id === text(o["id"], 60));
    if (!image) throw new Error("Không có ảnh này.");
    if (image.state !== "dang-go" || image.lease?.batch !== batch || image.lease.worker !== text(worker, 100)) throw new Error("Ảnh không còn thuộc lô này.");
    const report: LogoReport = {
      trangThai: (["khong-co-logo", "da-go", "khong-go", "loi"] as const).find((s) => s === o["trangThai"]) ?? "loi",
      lyDo: text(o["lyDo"], 300),
      lop: (Array.isArray(o["lop"]) ? o["lop"] : []).map((x) => text(x, 20)).slice(0, 4),
      cach: (Array.isArray(o["cach"]) ? o["cach"] : []).map((x) => text(x, 20)).slice(0, 4),
      vung: (Array.isArray(o["vung"]) ? o["vung"] : []).slice(0, 12).map((v) => (Array.isArray(v) ? v : []).slice(0, 4).map((n) => Math.round(Number(n) || 0))),
      kiem: o["kiem"] !== null && typeof o["kiem"] === "object" ? o["kiem"] as Record<string, unknown> : {}
    };
    delete image.lease;
    image.logo = report;
    image.updatedAt = this.now().toISOString();
    if ((report.trangThai === "khong-co-logo" || report.trangThai === "da-go") && assetName) {
      image.state = "cho-duyet"; image.assetName = assetName;
    } else if (report.trangThai === "khong-go") {
      image.state = "khong-chia-duoc";
    } else {
      image.attempts += 1;
      image.state = image.attempts >= MAX_ATTEMPTS ? "khong-chia-duoc" : "cho-go-logo";
    }
    this.save();
    return image;
  }

  /** Người duyệt quyết. Chỉ ảnh đang chờ duyệt mới đổi được. */
  decide(ids: unknown[], approve: boolean, reviewer: string, reason = ""): number {
    const wanted = new Set(ids.map((id) => text(id, 60)));
    const at = this.now().toISOString();
    let count = 0;
    for (const image of this.document.images) {
      if (!wanted.has(image.id) || image.state !== "cho-duyet") continue;
      image.state = approve ? "da-duyet" : "da-loai";
      image.reviewedAt = at; image.reviewedBy = text(reviewer, 100) || "nguoi-duyet"; image.updatedAt = at;
      if (approve) delete image.rejectReason; else image.rejectReason = text(reason, 200);
      count += 1;
    }
    if (count) this.save();
    return count;
  }

  /** Ảnh đã duyệt của mã này, từ shop KHÁC shop đang hỏi (shop gửi đã có bản gốc của mình). */
  approvedFor(code: string, askingShop: string | null): SharedImage[] {
    const key = codeKey(code);
    return this.document.images.filter((image) => image.code === key && image.state === "da-duyet" && image.assetName && image.shop !== askingShop);
  }

  list(filter: { state?: string; shop?: string; limit?: number; offset?: number } = {}): { images: SharedImage[]; total: number; counts: Record<string, number> } {
    this.releaseExpired();
    const counts: Record<string, number> = Object.fromEntries(SHARED_IMAGE_STATES.map((s) => [s, 0]));
    for (const image of this.document.images) counts[image.state] = (counts[image.state] ?? 0) + 1;
    const matched = this.document.images
      .filter((image) => (!filter.state || image.state === filter.state) && (!filter.shop || image.shop === filter.shop))
      .sort((a, b) => a.shop.localeCompare(b.shop) || a.code.localeCompare(b.code) || a.createdAt.localeCompare(b.createdAt));
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0));
    const limit = Math.min(200, Math.max(1, Math.trunc(filter.limit ?? 60)));
    return { images: matched.slice(offset, offset + limit), total: matched.length, counts };
  }

  /** Lô bị bỏ dở (máy chủ ảnh tắt giữa chừng): hết hạn giữ thì quay về chờ, đếm một lần thử. */
  private releaseExpired(): void {
    const now = this.now().toISOString();
    let changed = false;
    for (const image of this.document.images) {
      if (image.state !== "dang-go" || !image.lease || image.lease.until > now) continue;
      delete image.lease; image.attempts += 1; image.updatedAt = now; changed = true;
      image.state = image.attempts >= MAX_ATTEMPTS ? "khong-chia-duoc" : "cho-go-logo";
    }
    if (changed) this.save();
  }

  private load(): SharedImageDocument {
    const empty: SharedImageDocument = { version: 1, images: [], hints: {} };
    if (this.directory === null) return empty;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.directory, "anh-chia-se.json"), "utf8")) as SharedImageDocument;
      return parsed.version === 1 && Array.isArray(parsed.images) ? { version: 1, images: parsed.images, hints: parsed.hints ?? {} } : empty;
    } catch { return empty; }
  }

  private save(): void {
    if (this.directory === null) return;
    fs.mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, "anh-chia-se.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.document, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }
}
