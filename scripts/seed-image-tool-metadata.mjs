import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProductLibrary } from "../packages/xeon/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.IMAGE_TOOL_DATA_DIR || "D:/TopRun_Image_Tool_Final/data";
const target = process.env.XEON_THU_MUC_DU_LIEU || path.join(root, "du-lieu");
const apply = process.argv.includes("--apply");
const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(sourceRoot, name), "utf8")); } catch { return fallback; } };
const text = (value) => String(value ?? "").trim();
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const urls = (value) => (Array.isArray(value) ? value : value ? [value] : [])
  .map((entry) => text(typeof entry === "string" ? entry : object(entry).url || object(entry).asset_url || object(entry).image_url))
  .filter((url) => /^https:\/\//i.test(url));

const sourceCache = object(read("source_cache.json", {})).entries ?? {};
const assetCache = read("asset_url_cache.json", {});
const classifications = object(read("product_classification_cache.json", {})).by_code ?? {};
const merged = object(read("merged_inventory_snapshot.json", {})).products ?? [];
const byCode = new Map();
const item = (code) => { const key = text(code).toUpperCase(); if (!key) return null; if (!byCode.has(key)) byCode.set(key, { code: key, media: [], sources: [], specifications: {}, status: "needs_review", confidence: 0 }); return byCode.get(key); };

for (const [rawCode, raw] of Object.entries(object(classifications))) {
  const out = item(rawCode); if (!out) continue; const value = object(raw);
  out.sport ||= text(value.category); out.category ||= text(value.division); out.gender ||= text(value.gender);
  if (text(value.product_kind)) out.specifications.productKind = text(value.product_kind);
  if (text(value.accessory_type)) out.specifications.accessoryType = text(value.accessory_type);
}
for (const raw of Array.isArray(merged) ? merged : []) {
  const value = object(raw); const out = item(value.article_number || value.code); if (!out) continue;
  out.name ||= text(value.model_name || value.name); out.brand ||= text(value.brand); out.sport ||= text(value.category); out.category ||= text(value.division); out.gender ||= text(value.gender);
  out.material ||= text(value.product_material); if (text(value.product_fit)) out.specifications.fit = text(value.product_fit);
  if (text(value.product_dimensions)) out.physicalDimensions = { length: text(value.product_dimensions), width: "", height: "", unit: "", weight: "" };
}
for (const code of new Set([...Object.keys(object(sourceCache)), ...Object.keys(object(assetCache))])) {
  const out = item(code); if (!out) continue; const source = object(sourceCache[code]); const asset = object(assetCache[code]);
  const page = text(source.page_url || asset.source_page); const provider = text(source.source_type || asset.source_type || "image-tool");
  const found = [...new Set([...urls(asset.asset_urls), ...urls(source.gallery_urls)])].slice(0, 10);
  const observedAt = text(source.last_success_at || source.verified_at || asset.updated_at) || new Date().toISOString();
  out.media = found.map((url, index) => ({ id: `${out.code}-${index + 1}`, role: index === 0 ? "primary" : "gallery", order: index, sourceUrl: url, assetUrl: url, storageUrl: url, confidence: 0, status: "needs_review", source: { url: /^https:\/\//i.test(page) ? page : url, provider, observedAt } }));
  if (/^https:\/\//i.test(page)) out.sources = [{ url: page, provider, observedAt }];
}

const candidates = [...byCode.values()].filter((value) => value.name || value.brand || value.sport || value.category || value.gender || value.material || value.physicalDimensions || value.media.length);
const stats = { sourceRoot, target, candidates: candidates.length, withName: candidates.filter((x) => x.name).length, withClassification: candidates.filter((x) => x.sport || x.category).length, withMaterial: candidates.filter((x) => x.material).length, withDimensions: candidates.filter((x) => x.physicalDimensions).length, withMedia: candidates.filter((x) => x.media.length).length, media: candidates.reduce((sum, x) => sum + x.media.length, 0) };
if (!apply) { console.log(JSON.stringify({ mode: "preview", ...stats }, null, 2)); process.exit(0); }
const library = new ProductLibrary(target);
const result = library.mergeWorkerResults(candidates);
console.log(JSON.stringify({ mode: "applied", ...stats, ...result }, null, 2));
