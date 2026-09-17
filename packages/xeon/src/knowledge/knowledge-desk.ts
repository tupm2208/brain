/**
 * @file THE KNOWLEDGE DESK — sample profiles, the research queue and line knowledge per shop (Đ9).
 *
 * Sales Desk kept sample profiles inside its one-shop store and researched them through a Gemini
 * browser extension. On the platform the store is Xeon's (`du-lieu/kien-thuc/<shop>.json`), the
 * research runs on Xeon's model (no extension, no key on a shop's machine), and OMI views, edits,
 * merges and publishes through the landing. Publishing returns the PRODUCT LINES for the landing
 * to keep next to its catalogue — the landing owns what is sold, Xeon owns what is known.
 *
 * Research never publishes itself: a finished job leaves its profile `pending_review`, and only
 * "Áp vào Fit Finder/Catalog" (a person) moves it on.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withUsage } from "../ai/usage-context";
import type { TextModelPort } from "../content/text-model";
import type { Clock } from "../support/clock";
import { classifyByRules, type KnowledgePack, type KnowledgePackRegistry } from "./industry-packs";
import type { CustomerNeed } from "./line-dna";
import { lineId, plain, text, type Profile } from "./sample-profiles";

export interface ResearchJob {
  id: string;
  targetProfileId: string;
  targetProfileName: string;
  missingFields: string[];
  family: string;
  template: string;
  prompt: string;
  status: "pending" | "running" | "done" | "error";
  error: string;
  createdAt: string;
  updatedAt: string;
}

interface ShopKnowledge {
  version: 1;
  mau: Profile[];
  nghienCuu: ResearchJob[];
  /** Line ids published to the landing ("Đã có trong productLine"). */
  daXuatBan: string[];
  promptChung: string;
  capNhatLuc: string;
}

export type KnowledgeResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; message: string };

const MAX_PROFILES = 2000;
const MAX_JOBS = 300;
const JOBS_PER_RUN = 3;

const fail = (status: number, error: string, message: string) => ({ ok: false as const, status, error, message });
const safeShop = (shop: string): string => shop.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "_";

export interface KnowledgeDeskOptions {
  /** Empty = keep everything in memory (tests). */
  dataDirectory: string;
  packs: KnowledgePackRegistry;
  model: TextModelPort;
  clock: Clock;
}

export class KnowledgeDesk {
  private readonly memory = new Map<string, ShopKnowledge>();

  constructor(private readonly options: KnowledgeDeskOptions) {}

  private now(): string {
    return this.options.clock.now().toISOString();
  }

  private file(shop: string): string {
    return path.join(this.options.dataDirectory, "kien-thuc", `${safeShop(shop)}.json`);
  }

  private read(shop: string): ShopKnowledge {
    const cached = this.memory.get(shop);
    if (cached) return cached;
    let doc: ShopKnowledge = { version: 1, mau: [], nghienCuu: [], daXuatBan: [], promptChung: "", capNhatLuc: "" };
    if (this.options.dataDirectory) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file(shop), "utf8")) as Partial<ShopKnowledge>;
        doc = { ...doc, ...raw, mau: Array.isArray(raw.mau) ? raw.mau : [], nghienCuu: Array.isArray(raw.nghienCuu) ? raw.nghienCuu : [], daXuatBan: Array.isArray(raw.daXuatBan) ? raw.daXuatBan : [] };
      } catch { /* first use for this shop */ }
    }
    this.memory.set(shop, doc);
    return doc;
  }

  private write(shop: string, doc: ShopKnowledge): void {
    doc.capNhatLuc = this.now();
    doc.mau = doc.mau.slice(0, MAX_PROFILES);
    doc.nghienCuu = doc.nghienCuu.slice(-MAX_JOBS);
    this.memory.set(shop, doc);
    if (!this.options.dataDirectory) return;
    const file = this.file(shop);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc), "utf8");
    fs.renameSync(tmp, file);
  }

  /** The first read of a shop with no profiles at all seeds the pack's defaults (Desk did the same). */
  private profiles(shop: string, pack: KnowledgePack): ShopKnowledge {
    const doc = this.read(shop);
    if (doc.mau.length === 0 && doc.capNhatLuc === "") {
      const now = this.now();
      doc.mau = pack.defaultProfiles().map((p) => pack.kit.normalize(p, now));
      if (doc.mau.length > 0) this.write(shop, doc);
    }
    return doc;
  }

  private summary(pack: KnowledgePack, doc: ShopKnowledge, p: Profile): Profile {
    const c = pack.kit.completeness(p);
    const scores = (p["scores"] ?? {}) as Record<string, number>;
    return {
      id: p["id"], name: p["name"], brand: p["brand"] ?? "", category: p["category"] ?? "", keywords: (p["keywords"] ?? []).slice(0, 6),
      useCases: (p["useCases"] ?? []).slice(0, 4), family: pack.kit.family(p), needsVersion: pack.kit.needsVersion(p),
      completeness: c, scores: { daily: scores["daily"] ?? 0, speed: scores["speed"] ?? 0, stability: scores["stability"] ?? 0, comfort: scores["comfort"] ?? 0 },
      measurementStatus: p["fitSizing"]?.["measurementStatus"] ?? "", widthProfile: p["fitSizing"]?.["widthProfile"] ?? "",
      runrepeatUrl: p["runrepeatUrl"] ?? "", researchStatus: p["researchStatus"] ?? "", published: doc.daXuatBan.includes(lineId(p["id"] || p["name"])), updatedAt: p["updatedAt"] ?? ""
    };
  }

  // ---------------------------------------------------------------- reads

  overview(shop: string, industry: string, filter: { q?: string; doDay?: string } = {}): KnowledgeResult<Record<string, unknown>> {
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    const q = plain(filter.q ?? "");
    const want = filter.doDay ?? "all";
    const rows = doc.mau.filter((p) => {
      const c = pack.kit.completeness(p);
      if (want !== "all" && c.status !== want && !(want === "missing" && c.status === "empty")) return false;
      return !q || plain([p["name"], p["brand"], ...(p["keywords"] ?? [])].join(" ")).includes(q);
    });
    const jobs = doc.nghienCuu;
    return {
      ok: true,
      goi: { id: pack.id, ten: pack.name, soDong: pack.lines.size(), nhom: pack.families, promptChuyenNganh: pack.kit.specialisedFamilies() },
      mau: rows.map((p) => this.summary(pack, doc, p)),
      dem: {
        tong: doc.mau.length, loc: rows.length,
        daXuatBan: doc.mau.filter((p) => doc.daXuatBan.includes(lineId(p["id"] || p["name"]))).length,
        canNghienCuu: doc.mau.filter((p) => pack.kit.completeness(p).status !== "complete").length,
        trung: pack.kit.duplicateSummary(doc.mau)
      },
      nghienCuu: jobs.slice(-30).reverse().map(({ prompt: _p, ...rest }) => rest),
      demNghienCuu: { pending: jobs.filter((j) => j.status === "pending").length, running: jobs.filter((j) => j.status === "running").length, done: jobs.filter((j) => j.status === "done").length, error: jobs.filter((j) => j.status === "error").length },
      promptChung: doc.promptChung || pack.generalPrompt,
      moHinhSanSang: this.options.model.ready()
    };
  }

  packInfo(industry: string): KnowledgeResult<Record<string, unknown>> {
    const pack = this.options.packs.get(industry);
    return { ok: true, goi: { id: pack.id, ten: pack.name, soDong: pack.lines.size(), nhom: pack.families }, fitFinder: pack.fitFinder };
  }

  get(shop: string, industry: string, id: string): KnowledgeResult<{ mau: Profile; doDay: unknown; nhom: string }> {
    const pack = this.options.packs.get(industry);
    const p = this.profiles(shop, pack).mau.find((x) => x["id"] === id);
    if (!p) return fail(404, "khong_thay_mau", "Không tìm thấy sản phẩm mẫu — có thể đã bị xoá hoặc gộp.");
    return { ok: true, mau: pack.kit.normalize(p, this.now()), doDay: pack.kit.completeness(p), nhom: pack.kit.family(p) };
  }

  // ---------------------------------------------------------------- writes

  save(shop: string, industry: string, input: Profile): KnowledgeResult<{ mau: Profile }> {
    const pack = this.options.packs.get(industry);
    if (!text(input["id"]) || !text(input["name"])) return fail(400, "thieu_id_ten", "Profile cần có id và name.");
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(text(input["id"]))) return fail(400, "id_khong_hop_le", "ID mẫu chỉ gồm chữ không dấu, số, _ và -.");
    const doc = this.profiles(shop, pack);
    const now = this.now();
    const profile = pack.kit.normalize({ ...input, updatedAt: now }, now);
    const i = doc.mau.findIndex((p) => p["id"] === profile["id"]);
    if (i >= 0) doc.mau[i] = profile; else doc.mau.unshift(profile);
    this.write(shop, doc);
    return { ok: true, mau: profile };
  }

  remove(shop: string, industry: string, ids: string[]): KnowledgeResult<{ daXoa: number }> {
    const doc = this.profiles(shop, this.options.packs.get(industry));
    const drop = new Set(ids);
    if (drop.size === 0) return fail(400, "chua_chon", "Chưa chọn sản phẩm mẫu để xoá.");
    const before = doc.mau.length;
    doc.mau = doc.mau.filter((p) => !drop.has(p["id"]));
    doc.nghienCuu = doc.nghienCuu.filter((j) => !drop.has(j.targetProfileId));
    this.write(shop, doc);
    return { ok: true, daXoa: before - doc.mau.length };
  }

  private renameJobs(doc: ShopKnowledge, renamed: Record<string, string>): void {
    for (const job of doc.nghienCuu) {
      const to = renamed[job.targetProfileId];
      if (!to) continue;
      job.targetProfileId = to;
      job.targetProfileName = String(doc.mau.find((p) => p["id"] === to)?.["name"] ?? to);
    }
  }

  merge(shop: string, industry: string, ids: string[], targetId: string): KnowledgeResult<{ daGop: number; mau: Profile | null; boMa: string[] }> {
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    if (new Set(ids).size < 2) return fail(400, "can_hai_mau", "Chọn ít nhất hai sản phẩm mẫu để gộp.");
    if (!ids.includes(targetId)) return fail(400, "mau_giu_chua_chon", "Mở mẫu muốn giữ lại trước, rồi chọn các mẫu cần gộp cùng.");
    const r = pack.kit.merge(doc.mau, ids, targetId, this.now());
    doc.mau = r.profiles;
    this.renameJobs(doc, Object.fromEntries(r.removed.map((id) => [id, targetId])));
    this.write(shop, doc);
    return { ok: true, daGop: r.merged, mau: r.target ? this.summary(pack, doc, r.target) : null, boMa: r.removed };
  }

  consolidate(shop: string, industry: string): KnowledgeResult<{ daGop: number; boMa: string[] }> {
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    const r = pack.kit.consolidate(doc.mau, this.now());
    doc.mau = r.profiles;
    this.renameJobs(doc, r.renamed);
    this.write(shop, doc);
    return { ok: true, daGop: r.merged, boMa: r.removed };
  }

  mergeCatalog(shop: string, industry: string, products: Profile[]): KnowledgeResult<{ soDong: number; taoMoi: number; daGop: number }> {
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    const r = pack.kit.mergeCatalog(doc.mau, products, this.now());
    doc.mau = r.profiles;
    this.renameJobs(doc, r.renamed);
    this.write(shop, doc);
    return { ok: true, soDong: r.groups, taoMoi: r.created, daGop: r.consolidated };
  }

  reset(shop: string, industry: string): KnowledgeResult<{ soMau: number }> {
    const pack = this.options.packs.get(industry);
    const doc = this.read(shop);
    const now = this.now();
    doc.mau = pack.defaultProfiles().map((p) => pack.kit.normalize(p, now));
    doc.nghienCuu = [];
    this.write(shop, doc);
    return { ok: true, soMau: doc.mau.length };
  }

  /**
   * "Áp vào Fit Finder/Catalog": every profile becomes a product line; `products` (code, name, brand,
   * line from the landing) are matched by keyword. Profiles waiting for review are approved by this press.
   */
  publish(shop: string, industry: string, products: Profile[]): KnowledgeResult<{ dong: Profile[]; gan: { ma: string; dong: string }[]; soMau: number }> {
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    const now = this.now();
    const lines: Profile[] = [];
    const assigned = new Map<string, { line: string; length: number }>();
    for (const p of doc.mau) {
      if (p["researchStatus"] === "pending_review") { p["researchStatus"] = "approved"; p["researchApprovedAt"] = now; }
      const line = pack.kit.toProductLine(p, now);
      lines.push(line);
      for (const product of products) {
        const code = text(product["ma"]);
        const length = code ? pack.kit.matchLength(p, product) : 0;
        if (length > (assigned.get(code)?.length ?? 0)) assigned.set(code, { line: String(line["id"]), length });
      }
    }
    doc.daXuatBan = lines.map((l) => String(l["id"]));
    this.write(shop, doc);
    return { ok: true, dong: lines, gan: [...assigned].map(([ma, hit]) => ({ ma, dong: hit.line })), soMau: doc.mau.length };
  }

  /** "Dùng sản phẩm này làm mẫu cho dòng" (left over from Đ5): a product's web fields become the line's profile. */
  fromProduct(shop: string, industry: string, product: Profile): KnowledgeResult<{ mau: Profile; dong: Profile }> {
    const pack = this.options.packs.get(industry);
    const lineName = text(product["tenDong"]) || text(product["ten"]);
    if (!lineName) return fail(400, "thieu_ten_dong", "Cần tên dòng sản phẩm.");
    const doc = this.profiles(shop, pack);
    const now = this.now();
    const id = lineId(lineName);
    const existing = doc.mau.find((p) => p["id"] === id || lineId(p["name"]) === id) ?? {};
    const lines = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/)).map((x) => text(x)).filter(Boolean);
    const profile = pack.kit.normalize({
      ...existing, id: existing["id"] ?? id, name: existing["name"] ?? lineName, brand: text(product["hang"]) || existing["brand"] || "",
      category: existing["category"] ?? text(product["loai"]),
      keywords: [...new Set([...lines(product["tuKhoa"]), ...(existing["keywords"] ?? []), lineName])],
      referenceProductCode: text(product["ma"]),
      sourceProductCodes: [...new Set([...(existing["sourceProductCodes"] ?? []), text(product["ma"])].filter(Boolean))],
      bestFor: lines(product["phuHop"]).length ? lines(product["phuHop"]) : existing["bestFor"] ?? [],
      avoidFor: lines(product["khongHop"]).length ? lines(product["khongHop"]) : existing["avoidFor"] ?? [],
      technologies: lines(product["congNghe"]).length ? lines(product["congNghe"]) : existing["technologies"] ?? [],
      webContent: {
        ...(existing["webContent"] ?? {}), intro: text(product["gioiThieu"]) || existing["webContent"]?.["intro"] || "", shortDescription: text(product["gioiThieu"]) || existing["webContent"]?.["shortDescription"] || "",
        article: text(product["baiViet"]) || existing["webContent"]?.["article"] || "", features: lines(product["tinhNang"]), technologies: lines(product["congNghe"]),
        bestFor: lines(product["phuHop"]), notFor: lines(product["khongHop"]), fitGuide: text(product["huongDanFit"]), sizeNote: text(product["ghiChuSize"])
      },
      updatedAt: now
    }, now);
    const i = doc.mau.findIndex((p) => p["id"] === profile["id"]);
    if (i >= 0) doc.mau[i] = profile; else doc.mau.unshift(profile);
    if (!doc.daXuatBan.includes(lineId(profile["id"]))) doc.daXuatBan.push(lineId(profile["id"]));
    this.write(shop, doc);
    return { ok: true, mau: this.summary(pack, doc, profile), dong: pack.kit.toProductLine(profile, now) };
  }

  /** "Phân tích & điền vào mẫu": pasted research → the profile (the form's unsaved edits ride along in `draft`). */
  parse(shop: string, industry: string, id: string, raw: string, draft: Profile | null): KnowledgeResult<{ mau: Profile }> {
    const pack = this.options.packs.get(industry);
    if (!text(raw)) return fail(400, "thieu_noi_dung", "Cần chọn sản phẩm mẫu và dán nội dung nghiên cứu.");
    const doc = this.profiles(shop, pack);
    const current = draft && text(draft["id"]) === id ? draft : doc.mau.find((p) => p["id"] === id);
    if (!current) return fail(404, "khong_thay_mau", "Không tìm thấy sản phẩm mẫu.");
    const now = this.now();
    const parsed = pack.kit.normalize(pack.kit.applyResearch(current, raw, now), now);
    const i = doc.mau.findIndex((p) => p["id"] === id);
    if (i >= 0) doc.mau[i] = parsed; else doc.mau.unshift(parsed);
    this.write(shop, doc);
    return { ok: true, mau: parsed };
  }

  // ---------------------------------------------------------------- research queue

  createJobs(shop: string, industry: string, ids: string[], generalPrompt: string): KnowledgeResult<{ viec: Omit<ResearchJob, "prompt">[] }> {
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    const chosen = doc.mau.filter((p) => ids.includes(p["id"]));
    if (chosen.length === 0) return fail(400, "chua_chon", "Chọn ít nhất một sản phẩm mẫu để tạo job nghiên cứu.");
    if (text(generalPrompt)) doc.promptChung = text(generalPrompt).slice(0, 20000);
    const now = this.now();
    const created: ResearchJob[] = [];
    for (const p of chosen) {
      if (doc.nghienCuu.some((j) => j.targetProfileId === p["id"] && (j.status === "pending" || j.status === "running"))) continue;
      const built = pack.kit.researchPrompt(p, doc.promptChung || pack.generalPrompt);
      created.push({
        id: `nc_${crypto.randomBytes(6).toString("hex")}`, targetProfileId: String(p["id"]), targetProfileName: String(p["name"] ?? p["id"]),
        missingFields: pack.kit.completeness(p).missing, family: built.family, template: built.template, prompt: built.prompt,
        status: "pending", error: "", createdAt: now, updatedAt: now
      });
    }
    doc.nghienCuu.push(...created);
    this.write(shop, doc);
    return { ok: true, viec: created.map(({ prompt: _p, ...rest }) => rest) };
  }

  /** Runs up to `limit` pending jobs on Xeon's model. Each result is parsed into its profile, left for review. */
  async runJobs(shop: string, industry: string, limit = JOBS_PER_RUN): Promise<KnowledgeResult<{ daChay: number; xong: number; loi: number; conCho: number }>> {
    if (!this.options.model.ready()) return fail(503, "chua_co_mo_hinh", "Xeon chưa cấu hình mô hình AI — hàng nghiên cứu chưa chạy được.");
    const pack = this.options.packs.get(industry);
    const doc = this.profiles(shop, pack);
    const batch = doc.nghienCuu.filter((j) => j.status === "pending").slice(0, Math.max(1, Math.min(10, limit)));
    let done = 0;
    let failed = 0;
    for (const job of batch) {
      job.status = "running";
      job.updatedAt = this.now();
      const outcome = await withUsage({ shop, agent: "knowledge_research" }, () => this.options.model.complete({
        system: "Bạn là nhóm chuyên gia nghiên cứu sản phẩm. Viết bằng tiếng Việt, có tiêu đề rõ ràng. Không bịa thông số; chưa xác minh thì ghi rõ.",
        user: job.prompt, maxTokens: 8000
      }));
      const profile = doc.mau.find((p) => p["id"] === job.targetProfileId);
      if (!outcome.ok || !profile) {
        job.status = "error";
        job.error = outcome.ok ? "Sản phẩm mẫu đã bị xoá." : outcome.viSao;
        failed += 1;
      } else {
        const now = this.now();
        const parsed = pack.kit.normalize({ ...pack.kit.applyResearch(profile, outcome.text, now), researchStatus: "pending_review" }, now);
        doc.mau[doc.mau.indexOf(profile)] = parsed;
        job.status = "done";
        job.error = "";
        done += 1;
      }
      job.updatedAt = this.now();
      this.write(shop, doc);
    }
    return { ok: true, daChay: batch.length, xong: done, loi: failed, conCho: doc.nghienCuu.filter((j) => j.status === "pending").length };
  }

  // ---------------------------------------------------------------- line knowledge

  recommend(industry: string, need: CustomerNeed, inStock: string[], limit: number): KnowledgeResult<Record<string, unknown>> {
    const pack = this.options.packs.get(industry);
    if (pack.lines.size() === 0) return fail(404, "goi_chua_co_dong", `Gói kiến thức "${pack.name}" chưa có dữ liệu dòng sản phẩm.`);
    return { ok: true, ...pack.lines.recommend(need, inStock, Math.max(1, Math.min(5, limit))) };
  }

  findLine(industry: string, query: string, inStock: string[]): KnowledgeResult<Record<string, unknown>> {
    const pack = this.options.packs.get(industry);
    const line = pack.lines.findByText(query);
    if (!line) return { ok: true, dong: null, tuongDuong: [], choNguoiMoi: [], conHangTuongTu: [], moTa: "" };
    const resolved = pack.lines.resolve(line);
    const brief = (l: typeof line) => ({ id: l.id, name: l.name, brand: l.brand ?? "", purpose: l.purpose ?? "", plate: l.plate ?? "", level: l.level ?? "", note: l.note ?? "", priceTier: l.priceTier ?? 0 });
    return {
      ok: true, dong: brief(line), tuongDuong: resolved.equivalents.map(brief), choNguoiMoi: resolved.beginnerAlternatives.map(brief),
      conHangTuongTu: inStock.length ? pack.lines.similarInStock(line.id, inStock, 3) : [], moTa: pack.lines.describe(line)
    };
  }

  classify(industry: string, products: Profile[]): KnowledgeResult<Record<string, unknown>> {
    const pack = this.options.packs.get(industry);
    const byCategory: Record<string, number> = {};
    let matched = 0;
    const rows = products.map((p) => {
      const product = { ten: text(p["ten"]), ma: text(p["ma"]), hang: text(p["hang"]), dong: text(p["dong"]), loai: text(p["loai"]) };
      const c = classifyByRules(pack.referenceRules, product);
      const line = pack.lines.findByText(`${product.ten} ${product.dong}`);
      if (c.status === "matched") { matched += 1; byCategory[c.category] = (byCategory[c.category] ?? 0) + 1; }
      return { ma: product.ma, ten: product.ten, ...c, dong: line ? { id: line.id, name: line.name, purpose: line.purpose ?? "" } : null };
    });
    return { ok: true, tong: rows.length, khop: matched, thieu: rows.length - matched, theoNhom: byCategory, sanPham: rows };
  }
}
