/**
 * @file Shared product knowledge on Xeon. This is not merchant stock and never stores price,
 * quantity, customer data or merchant-only copy.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertCatalogClean } from "@sp/contract";

export type LibraryStatus = "verified" | "needs_review" | "not_found";
export type MediaRole = "primary" | "sideview" | "gallery";

export interface LibrarySource { url: string; provider: string; observedAt: string }
export interface LibraryMedia {
  id: string; role: MediaRole; order: number; sourceUrl: string; storageUrl: string; assetUrl: string;
  confidence: number; status: "verified" | "needs_review"; source: LibrarySource;
}
export interface LibraryProduct {
  code: string; aliases: string[]; name: string; brand: string; line: string; color: string;
  sport: string; category: string; gender: string; material: string; origin: string; description: string;
  physicalDimensions: { length: string; width: string; height: string; unit: string; weight: string };
  specifications: Record<string, string>;
  seo: { title: string; description: string; keywords: string[] };
  media: LibraryMedia[]; sources: LibrarySource[]; status: LibraryStatus;
  confidence: number; updatedAt: string; reviewedAt?: string; reviewedBy?: string;
  /**
   * 24/09/2026: lần gần nhất Image Tool cào XONG mã này — dù có tìm ra ảnh hay không.
   *
   * Thiếu nó thì hàng đợi không có trí nhớ: 508 mã mà công cụ đã lùng khắp các nguồn mà không thấy
   * gì vẫn được xếp hàng lại mỗi lần người ta bấm bổ sung, mở Chrome, đi tám IP, để rồi lại không
   * thấy gì. `updatedAt` không thay được vai này vì nó đổi theo mọi lần ghi, kể cả lần đề xuất tay.
   */
  scrapedAt?: string;
}
export interface ProductTemplate {
  id: string; brand: string; line: string; category: string;
  defaults: Pick<LibraryProduct, "gender" | "description" | "specifications" | "seo">;
  updatedAt: string;
}
interface LibraryDocument { version: 1; products: LibraryProduct[]; templates: ProductTemplate[] }

const emptyDocument = (): LibraryDocument => ({ version: 1, products: [], templates: [] });
const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);
const codeKey = (v: unknown): string => text(v, 100).toUpperCase().replace(/[^A-Z0-9._/-]/g, "");
/**
 * 24/09/2026: `//product.hstatic.net/anh.jpg` là URL hợp lệ, chỉ thiếu mỗi tên giao thức — mọi thẻ
 * ảnh của adidas-phoenix.com.vn (nền Haravan) viết thế. Cửa dưới đòi `https://` nên 62 mã cào ra
 * ảnh thật mà vào thư viện vẫn là con số không. Bổ sung `https:` là đọc đúng chuẩn web, không nới
 * lỏng gì: `http://` vẫn bị từ chối như cũ.
 */
const httpsUrl = (v: unknown, max: number): string => {
  const value = text(v, max);
  return value.startsWith("//") ? `https:${value}` : value;
};
/**
 * 24/09/2026: địa chỉ của một tấm ẢNH, nâng lên https. Ca B75807 — trang dealer viết 123 thẻ ảnh
 * kiểu `//host/...`, 49 thẻ `https://`, và đúng một thẻ meta `http://`; engine lấy đúng thẻ meta
 * ấy, nên mã về tay không dù ảnh có thật (cùng tấm ấy tải qua https ra đủ 15.760 byte).
 *
 * Chỉ ảnh mới được nâng, không áp dụng cho địa chỉ trang nguồn: ảnh là thứ phải tải được, còn
 * trang nguồn là dấu vết để người đối chiếu — ghi một địa chỉ không tồn tại còn tệ hơn không ghi.
 */
const httpsMediaUrl = (v: unknown, max: number): string => {
  const value = httpsUrl(v, max);
  return /^http:\/\//i.test(value) ? `https://${value.slice("http://".length)}` : value;
};
const words = (v: unknown, max: number, len: number): string[] => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, len)).filter(Boolean))].slice(0, max);
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

function source(v: unknown): LibrarySource | null {
  const o = object(v); const url = httpsUrl(o["url"], 2000); const provider = text(o["provider"], 100);
  if (!url || !/^https:\/\//i.test(url) || !provider) return null;
  return { url, provider, observedAt: text(o["observedAt"], 40) || new Date().toISOString() };
}

/** Strictly reduces external/worker input before it can enter the shared library. */
export function cleanLibraryProduct(raw: unknown, now = new Date().toISOString()): LibraryProduct {
  const o = object(raw); const code = codeKey(o["code"]);
  if (!code) throw new Error("Mã sản phẩm không hợp lệ.");
  const specifications: Record<string, string> = {};
  for (const [key, value] of Object.entries(object(o["specifications"])).slice(0, 100)) {
    const safeKey = text(key, 80); const safeValue = text(value, 500); if (safeKey && safeValue) specifications[safeKey] = safeValue;
  }
  const seoRaw = object(o["seo"]);
  const sources = (Array.isArray(o["sources"]) ? o["sources"] : []).map(source).filter((x): x is LibrarySource => x !== null).slice(0, 30);
  const media = (Array.isArray(o["media"]) ? o["media"] : []).slice(0, 50).map((value, index): LibraryMedia | null => {
    const m = object(value); const src = source(m["source"]); const sourceUrl = httpsMediaUrl(m["sourceUrl"], 2000); const storageUrl = httpsMediaUrl(m["assetUrl"] ?? m["storageUrl"], 2000);
    if (!src || !/^https:\/\//i.test(sourceUrl) || !/^https:\/\//i.test(storageUrl)) return null;
    const role: MediaRole = ["primary", "sideview", "gallery"].includes(String(m["role"])) ? m["role"] as MediaRole : "gallery";
    return { id: text(m["id"], 120) || `${code}-${index + 1}`, role, order: Math.max(0, Math.floor(Number(m["order"]) || index)), sourceUrl, storageUrl, assetUrl: storageUrl, confidence: Math.max(0, Math.min(1, Number(m["confidence"]) || 0)), status: m["status"] === "verified" ? "verified" : "needs_review", source: src };
  }).filter((x): x is LibraryMedia => x !== null).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const status: LibraryStatus = ["verified", "needs_review", "not_found"].includes(String(o["status"])) ? o["status"] as LibraryStatus : "needs_review";
  const dimensions = object(o["physicalDimensions"]);
  const product: LibraryProduct = {
    code, aliases: words(o["aliases"], 30, 100).map(codeKey).filter((x) => x && x !== code),
    name: text(o["name"], 300), brand: text(o["brand"], 100), line: text(o["line"], 160), color: text(o["color"], 160),
    sport: text(o["sport"], 100), category: text(o["category"], 100), gender: text(o["gender"], 40),
    material: text(o["material"], 500), origin: text(o["origin"], 200), description: text(o["description"], 10000),
    physicalDimensions: { length: text(dimensions["length"], 40), width: text(dimensions["width"], 40), height: text(dimensions["height"], 40), unit: text(dimensions["unit"], 20), weight: text(dimensions["weight"], 40) }, specifications,
    seo: { title: text(seoRaw["title"], 300), description: text(seoRaw["description"], 1000), keywords: words(seoRaw["keywords"], 30, 100) },
    media, sources, status, confidence: Math.max(0, Math.min(1, Number(o["confidence"]) || 0)), updatedAt: now,
    ...(text(o["scrapedAt"], 40) ? { scrapedAt: text(o["scrapedAt"], 40) } : {})
  };
  // Reuse the platform's PII gate over a public-catalog-shaped projection.
  // Media URLs commonly contain long numeric asset IDs. They are already
  // constrained to HTTPS above and must not be mistaken for phone/customer data.
  // Product identifiers are frequently long numeric article numbers; scanning them as prose makes
  // the PII gate mistake valid SKUs for phone numbers. Keep the gate over every human-authored field.
  assertCatalogClean({ tenant: "shared-library", id: "library-item", code: "LIBRARY_ITEM", name: product.name || "Library item", brand: product.brand, category: product.category, variantAxis: "", variants: [], attributes: { line: product.line, sport: product.sport, color: product.color, gender: product.gender, material: product.material, origin: product.origin, description: product.description, ...product.specifications }, images: [], updatedAt: product.updatedAt });
  return product;
}

export class ProductLibrary {
  private document: LibraryDocument;
  constructor(private readonly directory: string | null, private readonly now: () => Date = () => new Date()) { this.document = this.load(); }

  lookup(code: string): { product: LibraryProduct | null; template: ProductTemplate | null } {
    const key = codeKey(code); const product = this.document.products.find((p) => p.code === key || p.aliases.includes(key)) ?? null;
    return { product, template: product ? this.templateFor(product) : null };
  }

  lookupMany(codes: string[]): { code: string; product: LibraryProduct | null; template: ProductTemplate | null }[] {
    return [...new Set(codes.map(codeKey).filter(Boolean))].slice(0, 1000).map((code) => ({ code, ...this.lookup(code) }));
  }

  list(status?: LibraryStatus): LibraryProduct[] { return this.document.products.filter((p) => !status || p.status === status); }

  recoverAsset(code: string, oldUrl: string, bytes: Buffer, publicBase = ""): { assetId: string; path: string; contentHash: string; type: string } {
    if (this.directory === null) throw new Error("Storage trung tâm chưa được cấu hình.");
    if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) throw new Error("Ảnh phục hồi phải từ 1 byte đến 15 MB.");
    let extension = "", type = "";
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { extension = ".png"; type = "image/png"; }
    else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { extension = ".jpg"; type = "image/jpeg"; }
    else if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") { extension = ".webp"; type = "image/webp"; }
    else if (bytes.length >= 12 && /^(avif|avis)$/.test(bytes.subarray(8, 12).toString("ascii"))) { extension = ".avif"; type = "image/avif"; }
    else throw new Error("Ảnh phục hồi chỉ nhận JPEG, PNG, WebP hoặc AVIF.");
    const contentHash = crypto.createHash("sha256").update(bytes).digest("hex"); const assetId = `ast_${contentHash}`;
    const directory = path.join(this.directory, "product-assets"); fs.mkdirSync(directory, { recursive: true });
    const name = `${contentHash}${extension}`; const file = path.join(directory, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx" });
    const assetPath = `/thu-vien-san-pham/asset/${name}`; const publicUrl = `${publicBase.replace(/\/$/, "")}${assetPath}`;
    const product = this.lookup(code).product;
    if (product && oldUrl) { for (const media of product.media) if (media.assetUrl === oldUrl || media.storageUrl === oldUrl) { media.id = assetId; media.assetUrl = publicUrl; media.storageUrl = publicUrl; } this.save(); }
    return { assetId, path: assetPath, contentHash, type };
  }

  readAsset(name: string): { data: Buffer; type: string } | null {
    if (this.directory === null || !/^[a-f0-9]{64}\.(?:jpg|png|webp|avif)$/.test(name)) return null;
    try { const data = fs.readFileSync(path.join(this.directory, "product-assets", name)); const ext = path.extname(name); return { data, type: ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}` }; } catch { return null; }
  }

  propose(raw: unknown): LibraryProduct {
    const incoming = object(raw); const incomingCode = codeKey(incoming["code"]);
    const old = this.lookup(incomingCode).product;
    if (old?.status === "verified") throw new Error("Sản phẩm đã duyệt; đề xuất không được ghi đè bản chuẩn.");
    // Worker ảnh chỉ gửi gallery; giữ nguyên tên, hãng và nội dung đã có.
    const product = cleanLibraryProduct({ ...(old ?? {}), ...incoming, status: "needs_review" }, this.now().toISOString());
    this.put(product); return product;
  }

  /** Worker results may fill blanks and replace explicitly broken assets, never overwrite facts already kept. */
  mergeWorkerResult(raw: unknown, brokenAssetUrls: string[] = [], persist = true): LibraryProduct {
    const scrapedAt = this.now().toISOString();
    // Đóng dấu NGAY CẢ khi không ra tấm ảnh nào: "đã tìm, không thấy" cũng là một điều đáng nhớ.
    const incoming = cleanLibraryProduct({ ...object(raw), scrapedAt }, scrapedAt);
    const stored = this.lookup(incoming.code).product;
    const old = stored ? cleanLibraryProduct(stored, stored.updatedAt) : null;
    if (!old) { this.put(incoming, persist); return incoming; }
    const keep = (current: string, proposed: string) => current.trim() || proposed;
    const broken = new Set(brokenAssetUrls.map((x) => String(x).trim()).filter(Boolean));
    const retainedMedia = old.media.filter((m) => !broken.has(m.assetUrl) && !broken.has(m.storageUrl));
    const seen = new Set(retainedMedia.flatMap((m) => [m.assetUrl, m.storageUrl]).filter(Boolean));
    const newMedia = incoming.media.filter((m) => !seen.has(m.assetUrl) && !seen.has(m.storageUrl));
    const product = cleanLibraryProduct({
      ...old,
      name: keep(old.name, incoming.name), brand: keep(old.brand, incoming.brand), line: keep(old.line, incoming.line),
      sport: keep(old.sport, incoming.sport), category: keep(old.category, incoming.category), gender: keep(old.gender, incoming.gender),
      color: keep(old.color, incoming.color), material: keep(old.material, incoming.material), origin: keep(old.origin, incoming.origin),
      description: keep(old.description, incoming.description),
      physicalDimensions: {
        length: keep(old.physicalDimensions.length, incoming.physicalDimensions.length), width: keep(old.physicalDimensions.width, incoming.physicalDimensions.width),
        height: keep(old.physicalDimensions.height, incoming.physicalDimensions.height), unit: keep(old.physicalDimensions.unit, incoming.physicalDimensions.unit),
        weight: keep(old.physicalDimensions.weight, incoming.physicalDimensions.weight)
      },
      specifications: { ...incoming.specifications, ...old.specifications },
      seo: { title: keep(old.seo.title, incoming.seo.title), description: keep(old.seo.description, incoming.seo.description), keywords: old.seo.keywords.length ? old.seo.keywords : incoming.seo.keywords },
      media: [...retainedMedia, ...newMedia].slice(0, 10), status: old.status, scrapedAt
    }, scrapedAt);
    this.put(product, persist); return product;
  }

  mergeWorkerResults(raw: unknown[]): { processed: number; products: number } {
    let processed = 0;
    for (const value of raw) { this.mergeWorkerResult(value, [], false); processed += 1; }
    this.save(); return { processed, products: this.document.products.length };
  }

  approve(raw: unknown, reviewer: string): LibraryProduct {
    const product = cleanLibraryProduct({ ...object(raw), status: "verified" }, this.now().toISOString());
    product.reviewedAt = product.updatedAt; product.reviewedBy = text(reviewer, 100) || "operator";
    product.media = product.media.map((m) => ({ ...m, status: "verified" })); this.put(product); return product;
  }

  markNotFound(code: string): LibraryProduct { const old = this.lookup(code).product; const product = cleanLibraryProduct({ ...(old ?? {}), code, status: "not_found" }, this.now().toISOString()); this.put(product); return product; }

  saveTemplate(raw: unknown): ProductTemplate {
    const o = object(raw); const defaults = object(o["defaults"]); const cleaned = cleanLibraryProduct({ code: "TEMPLATE", ...defaults }, this.now().toISOString());
    const template: ProductTemplate = { id: text(o["id"], 120), brand: text(o["brand"], 100), line: text(o["line"], 160), category: text(o["category"], 100), defaults: { gender: cleaned.gender, description: cleaned.description, specifications: cleaned.specifications, seo: cleaned.seo }, updatedAt: this.now().toISOString() };
    if (!template.id || (!template.brand && !template.line && !template.category)) throw new Error("Mẫu cần id và ít nhất một phạm vi hãng/dòng/nhóm.");
    const i = this.document.templates.findIndex((x) => x.id === template.id); if (i < 0) this.document.templates.push(template); else this.document.templates[i] = template; this.save(); return template;
  }

  private templateFor(p: LibraryProduct): ProductTemplate | null {
    return [...this.document.templates].map((t) => ({ t, score: (t.line && t.line === p.line ? 4 : 0) + (t.brand && t.brand === p.brand ? 2 : 0) + (t.category && t.category === p.category ? 1 : 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id))[0]?.t ?? null;
  }
  private put(product: LibraryProduct, persist = true): void { const keys = new Set([product.code, ...product.aliases]); const collision = this.document.products.find((p) => p.code !== product.code && [p.code, ...p.aliases].some((x) => keys.has(x))); if (collision) throw new Error(`Mã thay thế đang thuộc ${collision.code}.`); const i = this.document.products.findIndex((p) => p.code === product.code); if (i < 0) this.document.products.push(product); else this.document.products[i] = product; if (persist) this.save(); }
  private load(): LibraryDocument { if (this.directory === null) return emptyDocument(); try { const parsed = JSON.parse(fs.readFileSync(path.join(this.directory, "product-library.json"), "utf8")) as LibraryDocument; return parsed.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.templates) ? parsed : emptyDocument(); } catch { return emptyDocument(); } }
  private save(): void { if (this.directory === null) return; fs.mkdirSync(this.directory, { recursive: true }); const file = path.join(this.directory, "product-library.json"); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.document, null, 2), "utf8"); fs.renameSync(tmp, file); }
}
