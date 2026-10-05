/**
 * @file ẢNH BỊ BÁO SAI — sổ chung của thư viện ảnh (04/10/2026).
 *
 * Anh duyệt phương án 02/10 (PfBnnbpvxcNRLGpmgZ1VtR) và mockup 04/10 (JqdSZxWYSkeGKmsguZqX9K):
 *  - Shop nào báo sai một ảnh thì ảnh đó TẠM ẨN ở mọi shop ngay, chờ người duyệt.
 *  - Duyệt là ảnh chuẩn → trả lại đúng chỗ cũ ở mọi shop. Xác nhận sai → chặn hẳn theo tấm ảnh
 *    (cùng tấm gắn cho nhiều mã thì chặn ở cả các mã đó).
 *  - Hàng nhái xác nhận MỘT lần là chặn trang nguồn (theo hãng); lý do khác thì trang nguồn bị hạ
 *    một bậc khi có từ BA mã bị xác nhận sai.
 *  - Chống báo bừa (câu 4 mockup): mỗi shop một ngày được một số lời báo có tác dụng mọi shop
 *    (`XEON_TRAN_BAO_ANH_NGAY`, mặc định 30); quá mức thì ảnh chỉ ẩn ở shop báo, vẫn chờ duyệt.
 *
 * Một CA = một tấm ảnh (theo `imageKey`: host + đường dẫn, bỏ tham số). Nhiều shop báo cùng tấm thì
 * chung một ca. Sổ không tự mở thư viện: bộ điều khiển tra thư viện rồi đưa thông tin vào.
 *
 * Landing của từng shop tự đọc `feedFor(shop)` để ẩn / trả / chặn bản sao của mình (Xeon không biết
 * shop nào đã tải tấm nào), rồi báo lại số ảnh đã ẩn (`ack`) — con số "đang ẩn ở N shop" là thật.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hostAndPath, type SourceTier } from "../knowledge/image-sources";

export const REPORT_REASONS = ["sai-mau", "sai-hang", "nhai", "banner", "logo", "xau"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type CaseState = "cho-duyet" | "da-tra" | "da-chan" | "da-rut";
export const CASE_STATES: readonly CaseState[] = ["cho-duyet", "da-tra", "da-chan", "da-rut"];
export type Reach = "moi-shop" | "chi-shop";
export type MediaVerdict = "giu" | "an" | "bo";

/** Ngưỡng hạ bậc trang nguồn: số MÃ bị xác nhận sai (lý do khác hàng nhái). */
export const DOWNGRADE_AFTER_CODES = 3;
/** Ca đã trả lại / đã rút vẫn nằm trong luồng cho landing chừng ấy ngày, để landing tắt máy lâu vẫn kịp trả ảnh. */
export const FEED_KEEP_RESOLVED_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REPORTERS = 50;
const MAX_ASSETS = 20;
const MAX_CODES = 200;

export interface Reporter { shop: string; lyDo: ReportReason; ghiChu: string; luc: string; hieuLuc: Reach }
export interface ImageCase {
  id: string;
  key: string;
  /** Mã được báo (lần đầu). */
  ma: string;
  /** Mọi mã trong thư viện có tấm này (một khung khuyến mãi có thể gắn cho nhiều mã). */
  maCung: string[];
  /** Mọi địa chỉ đã biết của tấm này (ảnh nguồn, bản Xeon cất) — landing so bản sao của mình với các địa chỉ này. */
  assets: string[];
  /** Địa chỉ để xem ảnh. */
  anh: string;
  /** Trang nguồn (nơi máy tìm ảnh lấy tấm này). "" = không biết (ảnh không có trong thư viện). */
  trang: string;
  host: string;
  hang: string;
  nguoiBao: Reporter[];
  phanDoi: { shop: string; luc: string }[];
  /** Shop → số ảnh bản sao đã ẩn ở shop đó. */
  apDung: Record<string, number>;
  trangThai: CaseState;
  taoLuc: string;
  capNhat: string;
  quyetLuc?: string;
  nguoiQuyet?: string;
}
export interface SourceRecord { host: string; hang: string; maSai: string[]; chan: boolean; chanLuc?: string; chanVi?: string }
interface ReportDocument { version: 1; cases: ImageCase[]; nguon: SourceRecord[]; dem: Record<string, number> }

export interface ImageToReport {
  key: string; assets: string[]; anh: string; trang: string; host: string; hang: string; maCung: string[];
}
export interface ReportOutcome { id: string; key: string; hieuLuc: Reach; daChan: boolean }
export interface FeedEntry {
  id: string; key: string; assets: string[]; ma: string; maCung: string[];
  trangThai: "tam-an" | "chan" | "tra-lai";
  cuaShop: boolean; lyDo: ReportReason; capNhat: string;
}

const text = (value: unknown, max: number): string => String(value ?? "").trim().slice(0, max);
const codeKey = (value: unknown): string => text(value, 120).toUpperCase().replace(/[^A-Z0-9._/-]/g, "");
const brandKey = (value: unknown): string => text(value, 100).toLowerCase();

/** Danh tính một tấm ảnh: host + đường dẫn, chữ thường, bỏ tham số (`?v=`, `?width=` đổi mà ảnh không đổi). */
export function imageKey(url: string): string {
  return hostAndPath(url);
}

/** Ngày theo giờ Việt Nam, để "30 lời báo một ngày" sang ngày mới đúng nửa đêm của shop. */
function dayOf(at: Date): string {
  return new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function lowerTier(tier: SourceTier): SourceTier {
  return tier === "chinh" ? "daily" : "khac";
}

export class ImageReportBook {
  private document: ReportDocument;

  constructor(private readonly directory: string | null, private readonly now: () => Date = () => new Date()) {
    this.document = this.load();
  }

  /** Lời báo có tác dụng mọi shop còn lại hôm nay của một shop. */
  remainingToday(shop: string, limit: number): number {
    return Math.max(0, limit - (this.document.dem[`${shop}|${dayOf(this.now())}`] ?? 0));
  }

  /** Shop báo sai một hay nhiều tấm của một mã. */
  report(input: { shop: string; code: string; images: ImageToReport[]; lyDo: string; ghiChu: string }, dailyLimit: number): ReportOutcome[] {
    const shop = text(input.shop, 120);
    const code = codeKey(input.code);
    const reason = REPORT_REASONS.find((r) => r === input.lyDo);
    if (!shop || !code) throw new Error("Thiếu shop hoặc mã sản phẩm.");
    if (!reason) throw new Error("Lý do báo sai không hợp lệ.");
    const at = this.now();
    const iso = at.toISOString();
    const counter = `${shop}|${dayOf(at)}`;
    const out: ReportOutcome[] = [];
    for (const image of input.images.slice(0, MAX_ASSETS)) {
      const key = text(image.key, 2000);
      if (!key) continue;
      let entry = this.document.cases.find((c) => c.key === key);
      if (entry?.trangThai === "da-chan") { out.push({ id: entry.id, key, hieuLuc: "moi-shop", daChan: true }); continue; }
      const mine = entry?.trangThai === "cho-duyet" ? entry.nguoiBao.find((r) => r.shop === shop) : undefined;
      if (mine) { out.push({ id: entry!.id, key, hieuLuc: mine.hieuLuc, daChan: false }); continue; }
      const used = this.document.dem[counter] ?? 0;
      const reach: Reach = used < dailyLimit ? "moi-shop" : "chi-shop";
      if (reach === "moi-shop") this.document.dem[counter] = used + 1;
      const reporter: Reporter = { shop, lyDo: reason, ghiChu: text(input.ghiChu, 200), luc: iso, hieuLuc: reach };
      if (!entry) {
        entry = {
          id: `bs_${crypto.createHash("sha1").update(key).digest("hex").slice(0, 20)}`, key, ma: code,
          maCung: [...new Set([code, ...image.maCung.map(codeKey).filter(Boolean)])].slice(0, MAX_CODES),
          assets: [...new Set(image.assets.map((a) => text(a, 2000)).filter(Boolean))].slice(0, MAX_ASSETS),
          anh: text(image.anh, 2000), trang: text(image.trang, 2000), host: text(image.host, 200), hang: text(image.hang, 100),
          nguoiBao: [reporter], phanDoi: [], apDung: {}, trangThai: "cho-duyet", taoLuc: iso, capNhat: iso
        };
        this.document.cases.push(entry);
      } else {
        // Ca đã trả lại / đã rút mà có người báo lại: mở lại từ đầu, giữ những mã đã biết.
        if (entry.trangThai !== "cho-duyet") { entry.nguoiBao = []; entry.phanDoi = []; entry.apDung = {}; delete entry.quyetLuc; delete entry.nguoiQuyet; }
        entry.trangThai = "cho-duyet";
        entry.nguoiBao = [...entry.nguoiBao, reporter].slice(-MAX_REPORTERS);
        entry.maCung = [...new Set([...entry.maCung, code, ...image.maCung.map(codeKey).filter(Boolean)])].slice(0, MAX_CODES);
        entry.assets = [...new Set([...entry.assets, ...image.assets.map((a) => text(a, 2000)).filter(Boolean)])].slice(0, MAX_ASSETS);
        if (!entry.hang && image.hang) entry.hang = text(image.hang, 100);
        entry.capNhat = iso;
      }
      out.push({ id: entry.id, key, hieuLuc: reach, daChan: false });
    }
    this.save();
    return out;
  }

  /** Shop rút lời báo của mình (chỉ khi ca còn chờ duyệt). Không còn ai báo thì ca thành "đã rút": ảnh về lại. */
  withdraw(shop: string, keys: string[]): number {
    const wanted = new Set(keys.map((k) => text(k, 2000)).filter(Boolean));
    const iso = this.now().toISOString();
    let count = 0;
    for (const entry of this.document.cases) {
      if (!wanted.has(entry.key) || entry.trangThai !== "cho-duyet") continue;
      const before = entry.nguoiBao.length;
      entry.nguoiBao = entry.nguoiBao.filter((r) => r.shop !== shop);
      if (entry.nguoiBao.length === before) continue;
      count += 1;
      entry.capNhat = iso;
      if (entry.nguoiBao.length === 0) entry.trangThai = "da-rut";
    }
    if (count) this.save();
    return count;
  }

  /** Một shop khác thấy ảnh đúng: ý kiến cho người duyệt, không tự trả ảnh lại. */
  object(shop: string, id: string): boolean {
    const entry = this.document.cases.find((c) => c.id === text(id, 60));
    if (!entry || entry.trangThai !== "cho-duyet" || entry.nguoiBao.some((r) => r.shop === shop)) return false;
    if (!entry.phanDoi.some((p) => p.shop === shop)) entry.phanDoi.push({ shop, luc: this.now().toISOString() });
    entry.capNhat = this.now().toISOString();
    this.save();
    return true;
  }

  /** Landing báo lại đã ẩn bao nhiêu bản sao của mỗi ca. */
  ack(shop: string, counts: Record<string, unknown>): void {
    let changed = false;
    for (const [id, raw] of Object.entries(counts).slice(0, 2000)) {
      const entry = this.document.cases.find((c) => c.id === id);
      if (!entry) continue;
      const n = Math.max(0, Math.min(10_000, Math.trunc(Number(raw) || 0)));
      if (n === 0) { if (shop in entry.apDung) { delete entry.apDung[shop]; changed = true; } continue; }
      if (entry.apDung[shop] !== n) { entry.apDung[shop] = n; changed = true; }
    }
    if (changed) this.save();
  }

  private reachesEveryone(entry: ImageCase): boolean {
    return entry.nguoiBao.some((r) => r.hieuLuc === "moi-shop");
  }

  /** Những ca landing của `shop` phải làm theo. */
  feedFor(shop: string): FeedEntry[] {
    const horizon = this.now().getTime() - FEED_KEEP_RESOLVED_MS;
    const out: FeedEntry[] = [];
    for (const entry of this.document.cases) {
      const reporter = entry.nguoiBao.find((r) => r.shop === shop);
      let state: FeedEntry["trangThai"] | null = null;
      if (entry.trangThai === "cho-duyet") state = this.reachesEveryone(entry) || reporter ? "tam-an" : null;
      else if (entry.trangThai === "da-chan") state = "chan";
      else if (Date.parse(entry.capNhat) >= horizon) state = "tra-lai";
      if (!state) continue;
      out.push({
        id: entry.id, key: entry.key, assets: entry.assets, ma: entry.ma, maCung: entry.maCung, trangThai: state,
        cuaShop: Boolean(reporter), lyDo: (reporter ?? entry.nguoiBao[0])?.lyDo ?? "sai-mau", capNhat: entry.capNhat
      });
    }
    return out;
  }

  get(id: string): ImageCase | null {
    return this.document.cases.find((c) => c.id === text(id, 60)) ?? null;
  }

  byKey(key: string): ImageCase | null {
    return this.document.cases.find((c) => c.key === key) ?? null;
  }

  pendingCount(): number {
    return this.document.cases.filter((c) => c.trangThai === "cho-duyet").length;
  }

  list(filter: { state?: string; limit?: number; offset?: number } = {}): { cases: ImageCase[]; total: number; counts: Record<string, number> } {
    const counts: Record<string, number> = Object.fromEntries(CASE_STATES.map((s) => [s, 0]));
    for (const entry of this.document.cases) counts[entry.trangThai] = (counts[entry.trangThai] ?? 0) + 1;
    const state = CASE_STATES.find((s) => s === filter.state) ?? "cho-duyet";
    const matched = this.document.cases.filter((c) => c.trangThai === state)
      // Chờ duyệt: cũ nhất lên trước (mockup). Đã xử lý: mới nhất lên trước.
      .sort((a, b) => state === "cho-duyet" ? a.taoLuc.localeCompare(b.taoLuc) : (b.quyetLuc ?? b.capNhat).localeCompare(a.quyetLuc ?? a.capNhat));
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0));
    const limit = Math.min(100, Math.max(1, Math.trunc(filter.limit ?? 30)));
    return { cases: matched.slice(offset, offset + limit), total: matched.length, counts };
  }

  /** Người duyệt quyết. `standard` = ảnh chuẩn (trả lại); không thì chặn hẳn và tính vào uy tín trang nguồn. */
  decide(id: string, standard: boolean, reviewer: string): { entry: ImageCase; source: SourceRecord | null } {
    const entry = this.get(id);
    if (!entry) throw new Error("Không có ca báo sai này.");
    if (entry.trangThai !== "cho-duyet") throw new Error("Ca này đã được xử lý.");
    const iso = this.now().toISOString();
    entry.trangThai = standard ? "da-tra" : "da-chan";
    entry.quyetLuc = iso; entry.capNhat = iso; entry.nguoiQuyet = text(reviewer, 100) || "nguoi-duyet";
    let source: SourceRecord | null = null;
    if (!standard && entry.host) {
      source = this.sourceRecord(entry.host, entry.hang, true)!;
      if (entry.nguoiBao.some((r) => r.lyDo === "nhai")) { source.chan = true; source.chanLuc = iso; source.chanVi = `Hàng nhái: ${entry.ma}`; }
      else source.maSai = [...new Set([...source.maSai, entry.ma])].slice(-500);
    }
    this.save();
    return { entry, source };
  }

  /** Bậc thật của một trang nguồn với một hãng: bậc từ danh sách ngành, hạ khi đủ mã sai, "chan" khi bị chặn. */
  effectiveTier(host: string, brand: string, base: SourceTier): SourceTier | "chan" {
    const records = [this.sourceRecord(host, brand, false), brand ? this.sourceRecord(host, "", false) : null].filter((r): r is SourceRecord => r !== null);
    if (records.some((r) => r.chan)) return "chan";
    const wrong = new Set(records.flatMap((r) => r.maSai)).size;
    return wrong >= DOWNGRADE_AFTER_CODES ? lowerTier(base) : base;
  }

  sources(): SourceRecord[] {
    return this.document.nguon.map((r) => ({ ...r, maSai: [...r.maSai] }));
  }

  /**
   * Ảnh này còn được dùng không — trả cho shop (`tenant` = shop đang hỏi) hay giữ trong thư viện.
   *  - "bo": đã chặn hẳn, hoặc trang nguồn bị chặn với hãng này.
   *  - "an": đang tạm ẩn chờ duyệt (với mọi shop, hoặc chỉ với shop đã báo nếu quá trần ngày).
   *  - `fresh` (ảnh MỚI máy vừa tìm): bỏ cả ảnh từ trang nguồn của một ca chưa trả lại của cùng mã —
   *    "tìm lại, bỏ qua trang vừa bị báo". Không áp cho ảnh đã có: một trang có thể có một khung khuyến
   *    mãi mà các ảnh khác vẫn đúng.
   */
  verdict(input: { code: string; brand: string; url: string; pageUrl: string; tenant: string | null; fresh: boolean }): MediaVerdict {
    const key = imageKey(input.url);
    const entry = key ? this.byKey(key) : null;
    if (entry?.trangThai === "da-chan") return "bo";
    if (entry?.trangThai === "cho-duyet") {
      if (this.reachesEveryone(entry)) return "an";
      if (input.tenant && entry.nguoiBao.some((r) => r.shop === input.tenant)) return "an";
      if (input.fresh) return "an";
    }
    const host = hostAndPath(input.pageUrl).split("/", 1)[0] ?? "";
    if (host && this.effectiveTier(host, brandKey(input.brand), "khac") === "chan") return "bo";
    if (input.fresh && input.pageUrl) {
      const code = codeKey(input.code);
      const page = imageKey(input.pageUrl);
      if (this.document.cases.some((c) => (c.trangThai === "cho-duyet" || c.trangThai === "da-chan") && c.maCung.includes(code) && c.trang && imageKey(c.trang) === page)) return "bo";
    }
    return "giu";
  }

  private sourceRecord(host: string, brand: string, create: boolean): SourceRecord | null {
    const h = text(host, 200).toLowerCase();
    const b = brandKey(brand);
    let record = this.document.nguon.find((r) => r.host === h && r.hang === b) ?? null;
    if (!record && create) { record = { host: h, hang: b, maSai: [], chan: false }; this.document.nguon.push(record); }
    return record;
  }

  private load(): ReportDocument {
    const empty: ReportDocument = { version: 1, cases: [], nguon: [], dem: {} };
    if (this.directory === null) return empty;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.directory, "anh-bao-sai.json"), "utf8")) as Partial<ReportDocument>;
      return parsed.version === 1 && Array.isArray(parsed.cases)
        ? { version: 1, cases: parsed.cases, nguon: Array.isArray(parsed.nguon) ? parsed.nguon : [], dem: parsed.dem ?? {} }
        : empty;
    } catch { return empty; }
  }

  private save(): void {
    // Đếm ngày cũ chỉ là rác: giữ ba ngày gần nhất.
    const keep = new Set([0, 1, 2].map((d) => dayOf(new Date(this.now().getTime() - d * 86_400_000))));
    for (const key of Object.keys(this.document.dem)) if (!keep.has(key.split("|").pop() ?? "")) delete this.document.dem[key];
    if (this.directory === null) return;
    fs.mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, "anh-bao-sai.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.document, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }
}
