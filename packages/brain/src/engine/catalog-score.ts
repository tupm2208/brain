/**
 * @file Scoring the candidates the stock finder returned against what the customer asked
 * (Desk `ai_router.js` `scoreProduct` ~3585 + `retrieveCatalog` ~3041, `product_match.js`
 * `wantedVersion` / `hasVersion`, `agent_level2.js` `compareRecommendationProducts` — 25/09/2026).
 *
 * Pure: takes the `FoundItem` list that `catalog.find` already returned and a query; never calls a
 * tool. Every rule is one conversation that went wrong, and the numbers are data
 * (`cham-diem-chung.json` ⊕ `cham-diem.json`):
 *   - an exact code is the strongest evidence there is, and switches every "drop" gate below off —
 *     JQ0764 once scored +90 for its code and was then dropped by the brand gate (Do Quan, 24/08);
 *   - a line name must match ALL its distinctive words — "Adizero Boston" once matched a running
 *     shirt "Adizero Ekiden" on "adizero" alone;
 *   - a product carrying ANOTHER version is dropped, not demoted — "Boston 12" used to beat
 *     "ADIZERO BOSTON 13 M" when the customer asked for Boston 13; a version in the shoe-size
 *     range (35–52) only demotes, "boston 42" is a size;
 *   - a stated brand drops products of a KNOWN other brand only — 84% of the landing's records had
 *     an empty brand field, and the gate once emptied 58% of the pool on "adidas";
 *   - a distinctive word the customer typed (jordan, novablast) must appear in the name, generic
 *     words (air, pro, max) never count — "air jordan 1 low" once matched "Air Zoom Vapor Pro 3".
 */

import type { MatchingConfig } from "../pack/types";
import { findLine, type ProductLine } from "./dialogue-frame";
import type { Entities } from "./entities";
import { packRegex } from "./fill-text";
import { SizeMatcher, type SizeRow, type SizeStock } from "./size-match";
import { escapeRe, normalize, tokens } from "./text-analysis";

/** One size row of a found item, as `catalog.find` returns it (`cac_size[]`). `so_luong` / `kho` are newer landings' fields. */
export interface FoundSize extends SizeRow {
  size: string;
  gia: number;
}

/**
 * One item as `catalog.find` returns it (the contract's `ketQua[]`), plus optional fields a caller
 * may know: `hang` (brand), `mau` (colour), `nguon` (own / partner warehouse), `khuyenMai` (campaign).
 * The wire fields keep their Vietnamese names on purpose: the agent's prompt reads them.
 */
export interface FoundItem {
  ma: string;
  ten: string;
  loai?: string | undefined;
  cac_size: FoundSize[];
  anh?: string | undefined;
  link?: string | undefined;
  nhom?: string | undefined;
  dieu_kien?: Record<string, string> | undefined;
  hang?: string | undefined;
  mau?: string | undefined;
  nguon?: "own" | "partner" | undefined;
  khuyenMai?: boolean | undefined;
  /** Need tags the shop attached (fit notes, "daily", "race"…) for the `need` bonus. */
  nhuCau?: string[] | undefined;
}

/** What the customer asked, as the scorer reads it. Empty string = not said. */
export interface CatalogQuery {
  productCode: string;
  productName: string;
  /** The product LINE the analysis split out ("Adizero Adios Pro"); Desk's `entities.productLine`. */
  productLine: string;
  modelVersion: string;
  brand: string;
  productType: string;
  size: string;
  color: string;
  need: string;
  intent: string;
}

/** A scored item: the candidate the resolver, the gate and the stock facts work on. */
export interface CatalogCandidate {
  code: string;
  name: string;
  brand: string;
  source: "own" | "partner";
  /** The lowest price among the in-stock rows. */
  price: number;
  /** In-stock rows (rows whose quantity is unknown count as in stock, like the public finder). */
  sizes: FoundSize[];
  requestedSizeStock: SizeStock | null;
  score: number;
  reasons: string[];
  /** The same code returned again by another warehouse (Desk v8: one line per code, the rest listed here). */
  otherKho: { kho: string; price: number; sizes: string[] }[];
  item: FoundItem;
}

/** The scorer's query from the extractor's entities, the intent and (optionally) the model's analysis entities. */
export function catalogQueryOf(entities: Pick<Entities, "productCode" | "productName" | "brand" | "size" | "need">, intent: string, analysis: Record<string, unknown> = {}): CatalogQuery {
  const str = (key: string): string => {
    const v = analysis[key];
    return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  };
  return {
    productCode: entities.productCode || str("productCode"),
    productName: entities.productName || str("productName"),
    productLine: str("productLine"),
    modelVersion: str("modelVersion"),
    brand: entities.brand || str("brand"),
    productType: str("productType"),
    size: entities.size || str("size"),
    color: str("color"),
    need: entities.need || str("need"),
    intent
  };
}

export function emptyCatalogQuery(over: Partial<CatalogQuery> = {}): CatalogQuery {
  return { productCode: "", productName: "", productLine: "", modelVersion: "", brand: "", productType: "", size: "", color: "", need: "", intent: "", ...over };
}

/** Rows with stock: a row without a quantity is the public finder's "in stock". */
export function inStockRows(item: FoundItem): FoundSize[] {
  return item.cac_size.filter((row) => row && row.size !== undefined && (row.so_luong === undefined || row.so_luong > 0));
}

/** Own warehouse unless the item (or every row) says "order" (Desk `source === "partner"`). */
export function sourceOf(item: FoundItem): "own" | "partner" {
  if (item.nguon !== undefined) return item.nguon;
  const kinds = [item.loai, ...item.cac_size.map((row) => row.loai)].filter((k): k is string => typeof k === "string" && k !== "");
  if (kinds.length === 0) return "own";
  return kinds.every((k) => /order/i.test(k)) ? "partner" : "own";
}

/** Lowest price among the rows (Desk `mergeSizeRows`: the web shows the minimum across warehouses). */
export function priceOf(item: FoundItem): number {
  const prices = inStockRows(item).map((row) => Number(row.gia)).filter((p) => Number.isFinite(p) && p > 0);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

/** Versions read from a name: the first 1–2 digit number that is not part of a SKU (Desk `product_match.js`). */
export class VersionReader {
  private readonly sku: RegExp | null;

  constructor(skuLikePattern: string) {
    this.sku = packRegex(skuLikePattern);
  }

  stripSku(name: string): string {
    const sku = this.sku;
    return normalize(name).split(" ").filter((t) => sku === null || !sku.test(t)).join(" ");
  }

  has(name: string, version: string): boolean {
    if (!/^\d{1,2}$/.test(version)) return false;
    return new RegExp(`(^|[^0-9])${version}([^0-9]|$)`).test(this.stripSku(name));
  }

  hasAny(name: string): boolean {
    return /(^|[^0-9])\d{1,2}([^0-9]|$)/.test(this.stripSku(name));
  }

  /** "ADIZERO BOSTON 13 M" → "13"; "" when the name carries none. */
  of(name: string): string {
    const m = this.stripSku(name).match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/);
    return m?.[1] ?? "";
  }

  /** The number RIGHT AFTER a line alias in the text ("boston 13" → "13"); never a number elsewhere ("size 42"). */
  afterLine(text: string, aliases: readonly string[]): string {
    const hay = normalize(text);
    if (hay === "") return "";
    const list = aliases.map(normalize).filter((a) => a.length >= 3).sort((a, b) => b.length - a.length);
    for (const alias of list) {
      let from = 0;
      for (;;) {
        const at = hay.indexOf(alias, from);
        if (at < 0) break;
        const m = hay.slice(at + alias.length).match(/^\s+(\d{1,2})(?![\d.])/);
        if (m?.[1]) return m[1];
        from = at + alias.length;
      }
    }
    return "";
  }
}

/** Every run of consecutive letter words of a hint, long spans first (Desk `aliasSpans`). */
function aliasSpans(hint: string): string[] {
  const spans: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    for (let size = Math.min(run.length, 6); size >= 1; size -= 1) {
      for (let start = 0; start + size <= run.length; start += 1) {
        const span = run.slice(start, start + size).join(" ");
        if (size >= 2 || span.length >= 4) spans.push(span);
      }
    }
    run = [];
  };
  for (const token of normalize(hint).split(" ")) {
    if (/^[a-z]+([.-][a-z]+)*$/.test(token)) run.push(token); else flush();
  }
  flush();
  return [...new Set(spans)].sort((a, b) => b.length - a.length);
}

/** Scores and retrieves catalog candidates with one industry's matching data. */
export class CatalogScorer {
  readonly sizes: SizeMatcher;
  readonly versions: VersionReader;
  private readonly noise: Set<string>;
  private readonly genericName: Set<string>;
  private readonly lineGeneric: Set<string>;
  private readonly brandHints: [string, string[]][];
  private readonly typeRules: { kind: string; res: RegExp[] }[];

  /**
   * @param cfg the merged matching data of the industry
   * @param lines the industry's product lines (`line-dna.json`), for the version after a line name; may be empty
   * @param brands the pack's brand list, for reading a brand off a name
   */
  constructor(readonly cfg: MatchingConfig, private readonly lines: readonly ProductLine[] = [], private readonly brands: readonly string[] = []) {
    this.sizes = new SizeMatcher(cfg.sizes);
    this.versions = new VersionReader(cfg.skuLikePattern);
    this.noise = new Set(cfg.noiseTokens.map(normalize));
    this.genericName = new Set(cfg.genericNameTokens.map(normalize));
    this.lineGeneric = new Set(cfg.lineGenericTokens.map(normalize));
    this.brandHints = Object.entries(cfg.brandLineHints).map(([brand, hints]) => [normalize(brand), hints.map(normalize)]);
    this.typeRules = cfg.types.rules.map((rule) => ({ kind: rule.kind, res: rule.patterns.filter((p) => p !== "").map((p) => new RegExp(p)) }));
  }

  private weight(key: string): number {
    return this.cfg.weights[key] ?? 0;
  }

  /** The brand of an item: its own field, a pack brand in its name, or the brand its line name implies ("adizero" → adidas). */
  brandOf(item: FoundItem): string {
    if ((item.hang ?? "") !== "") return normalize(item.hang);
    const text = normalize(`${item.ten} ${item.ma}`);
    const direct = this.brands.map(normalize).find((b) => b !== "" && new RegExp(`(^|\\s)${escapeRe(b)}(?=\\s|$|[.,-])`).test(text));
    if (direct !== undefined) return direct;
    if (/\bnew\s*-?\s*balance\b/.test(text)) return "new balance";
    const byLine = this.brandHints.find(([, hints]) => hints.some((h) => h !== "" && text.includes(h)));
    return byLine ? byLine[0] : "";
  }

  /**
   * The item's type by the industry's rules ("dep", "ao", "giay"…). When the name says nothing, the
   * size labels decide (Desk `sizeEvidence`): two or more numeric sizes in the main item's range is
   * the main type (a shoe); letters or nothing leave it "" — never dropped, only never proven.
   */
  typeOf(item: FoundItem): string {
    const text = normalize(`${item.ten} ${item.nhom ?? ""}`);
    for (const rule of this.typeRules) if (rule.res.some((re) => re.test(text))) return rule.kind;
    const { min, max } = this.cfg.ambiguousVersion;
    const primary = this.cfg.types.primaryTypes[0] ?? "";
    if (primary === "" || max <= 0) return "";
    const numeric = item.cac_size.map((row) => this.sizes.toNumber(row.size)).filter((n) => Number.isFinite(n) && n >= min && n <= max);
    return numeric.length >= 2 ? primary : "";
  }

  /** The canonical type of a word the customer said ("ao gio" → "ao"); "" when unknown. */
  canonicalType(value: string): string {
    const n = normalize(value);
    if (n === "") return "";
    const aliases = this.cfg.types.aliases;
    if (aliases[n] !== undefined) return aliases[n] ?? "";
    for (const [alias, kind] of Object.entries(aliases)) {
      if (alias !== "" && new RegExp(`(^|\\s)${escapeRe(normalize(alias))}(\\s|$)`).test(n)) return kind;
    }
    return "";
  }

  /**
   * The version the customer wants (Desk `wantedVersion`): the analysis's explicit field, else the
   * number after a KNOWN line alias in the hint, else a guess confirmed by the catalog (some item
   * carries both the span and the version). Never a bare number: "Boston size 42" is not version 42.
   */
  requestedVersion(query: CatalogQuery, items: readonly FoundItem[]): string {
    const direct = query.modelVersion.trim();
    if (/^\d{1,2}$/.test(direct)) return direct;
    const hint = query.productName.trim() !== "" ? query.productName : query.productLine;
    if (hint.trim() === "") return "";
    const line = findLine(hint, this.lines);
    if (line !== null) {
      const v = this.versions.afterLine(hint, [line.name, ...(line.aliases ?? [])]);
      if (v !== "") return v;
    }
    const names = items.map((it) => normalize(it.ten)).filter((n) => n.length >= 3);
    if (names.length === 0) return "";
    for (const span of aliasSpans(hint)) {
      const v = this.versions.afterLine(hint, [span]);
      if (v === "") continue;
      if (names.some((n) => n.includes(span) && this.versions.has(n, v))) return v;
    }
    return "";
  }

  /** Desk `scoreProduct`: the score and the reasons, `{ score: 0 }` when a gate drops the item. */
  score(item: FoundItem, query: CatalogQuery, requestedVersion: string): { score: number; reasons: string[] } {
    const none = { score: 0, reasons: [] as string[] };
    const code = normalize(item.ma);
    const name = normalize(item.ten);
    const brand = this.brandOf(item);
    const source = sourceOf(item);
    let score = source === "own" ? this.weight("own") : this.weight("partner");
    const reasons: string[] = [];

    let exactCode = false;
    const wantedCode = normalize(query.productCode);
    if (wantedCode !== "" && code === wantedCode) { score += this.weight("codeExact"); exactCode = true; reasons.push("code"); }
    else if (wantedCode !== "" && code.includes(wantedCode)) { score += this.weight("codePartial"); reasons.push("code_partial"); }

    // The line: every distinctive word of it must be in the name.
    const requestedLine = normalize(query.productLine);
    if (requestedLine !== "") {
      const lineTokens = requestedLine.split(" ").filter((t) => t.length >= 3 && !this.noise.has(t));
      const distinctive = lineTokens.filter((t) => !this.lineGeneric.has(t));
      const pool = distinctive.length > 0 ? distinctive : lineTokens;
      const hits = pool.filter((t) => name.includes(t)).length;
      if (!exactCode && pool.length > 0 && hits < pool.length) return none;
      if (pool.length > 0) { score += this.weight("line"); reasons.push("line_match"); }
    }

    // The type gate, INVERTED: drop only when the item is proven to be of ANOTHER type.
    const requestedType = this.canonicalType(query.productType);
    if (requestedType !== "") {
      const kind = this.typeOf(item);
      if (kind !== "" && kind !== requestedType && !exactCode) return none;
      if (kind === requestedType) { score += this.weight("type"); reasons.push("type_match"); }
    }

    // The version: another version is another shoe; a size-like number only demotes.
    if (/^\d{1,2}$/.test(requestedVersion)) {
      if (this.versions.has(item.ten, requestedVersion)) { score += this.weight("version"); reasons.push("version_match"); }
      else if (!exactCode && this.versions.hasAny(item.ten) && !this.versionIsAmbiguous(requestedVersion)) return none;
      else score += this.weight("versionMissing");
    }

    // The brand: drop a KNOWN other brand only; an unknown brand passes without the bonus.
    const requestedBrand = normalize(query.brand);
    if (requestedBrand !== "") {
      if (!exactCode && brand !== "" && !brand.includes(requestedBrand)) return none;
      if (brand !== "") { score += this.weight("brand"); reasons.push("brand"); }
    }

    // The name, in three strengths; then the distinctive words the customer typed.
    const hint = normalize(query.productName);
    if (hint !== "") {
      if (name === hint) { score += this.weight("nameExact"); reasons.push("name_exact", "name_strong"); }
      else if (hint.includes(name) && name.length >= 6) { score += this.weight("nameWithin"); reasons.push("name_within_hint", "name_strong"); }
      else if (name.includes(hint)) { score += this.weight("nameContains"); reasons.push("name_contains_hint"); }
      const words = hint.split(" ").filter((t) => t.length >= 3 && !this.noise.has(t) && t !== requestedBrand);
      const distinctive = words.filter((t) => !this.genericName.has(t));
      const hits = words.filter((t) => name.includes(t)).length;
      const distinctiveHits = distinctive.filter((t) => name.includes(t)).length;
      if (!exactCode && distinctive.length > 0 && distinctiveHits === 0 && !reasons.includes("name_strong")) return none;
      if (hits >= 2) { score += this.weight("nameStrong"); reasons.push("name_strong"); }
      else if (hits === 1) {
        const rare = words.some((t) => t.length >= 6 && name.includes(t));
        score += rare ? this.weight("namePartialRare") : this.weight("namePartial");
        reasons.push("name_partial");
      }
    }

    if (query.size !== "" && this.sizes.nearest(inStockRows(item), query.size) !== null) {
      score += query.intent === "product_advice" ? this.weight("sizeAdvice") : this.weight("size");
      reasons.push("size");
    }
    if (query.color !== "" && this.matchesColor(item, query.color)) { score += this.weight("color"); reasons.push("color"); }
    if (query.intent === "product_advice" && query.need !== "" && this.matchesNeed(item, query.need)) { score += this.weight("need"); reasons.push("need"); }
    return { score, reasons: [...new Set(reasons)] };
  }

  /** A version inside the shoe-size range cannot be told from a size. */
  versionIsAmbiguous(version: string): boolean {
    const { min, max } = this.cfg.ambiguousVersion;
    const n = Number(version);
    return max > 0 && n >= min && n <= max;
  }

  private matchesColor(item: FoundItem, color: string): boolean {
    const hay = normalize(`${item.mau ?? ""} ${item.ten}`);
    return tokens(color).filter((t) => t.length >= 2).some((t) => hay.includes(t));
  }

  private matchesNeed(item: FoundItem, need: string): boolean {
    const hay = normalize(`${item.ten} ${item.nhom ?? ""} ${(item.nhuCau ?? []).join(" ")}`);
    return need.split(",").map((n) => normalize(n)).some((n) => n !== "" && hay.includes(n));
  }

  /** A candidate from an item and its score. */
  candidate(item: FoundItem, query: CatalogQuery, score: number, reasons: string[]): CatalogCandidate {
    const sizes = inStockRows(item);
    return {
      code: item.ma, name: item.ten, brand: this.brandOf(item), source: sourceOf(item), price: priceOf(item), sizes,
      requestedSizeStock: query.size !== "" ? this.sizes.nearest(sizes, query.size) : null,
      score, reasons, otherKho: [], item
    };
  }

  /**
   * Desk `retrieveCatalog`: score every item, keep those within `band` of the best (and at least
   * `minScore`), prefer name matches when a name was typed, prefer the own warehouse, fold the same
   * code returned by several warehouses into one line, cut at `limit`.
   */
  retrieve(items: readonly FoundItem[], query: CatalogQuery): CatalogCandidate[] {
    const requestedVersion = this.requestedVersion(query, items);
    const priority = (item: FoundItem): number => (sourceOf(item) === "own" ? 1 : 2);
    const scored = items
      .filter((item) => item && typeof item.ma === "string")
      .map((item) => ({ item, ...this.score(item, query, requestedVersion) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => priority(a.item) - priority(b.item) || b.score - a.score || a.item.ten.localeCompare(b.item.ten));
    const top = scored[0]?.score ?? 0;
    const minScore = this.cfg.retrieve.minScore > 0 ? this.cfg.retrieve.minScore : 25;
    const band = this.cfg.retrieve.band > 0 ? this.cfg.retrieve.band : 8;
    const limit = this.cfg.retrieve.limit > 0 ? this.cfg.retrieve.limit : 5;
    const strong = scored.filter((x) => x.score >= Math.max(minScore, top - band));
    const named = strong.filter((x) => x.reasons.some((r) => r.startsWith("name_")));
    const pool = query.productName !== "" && named.length > 0 ? named : strong;
    const own = pool.filter((x) => sourceOf(x.item) === "own");
    const selectedPool = own.length > 0 ? own : pool;
    const byCode = new Map<string, CatalogCandidate>();
    const out: CatalogCandidate[] = [];
    for (const x of selectedPool) {
      const key = normalize(x.item.ma);
      const existing = key !== "" ? byCode.get(key) : undefined;
      if (existing !== undefined) {
        existing.otherKho.push({ kho: x.item.cac_size.find((r) => (r.kho ?? "") !== "")?.kho ?? (sourceOf(x.item) === "own" ? "own" : "partner"), price: priceOf(x.item), sizes: inStockRows(x.item).map((r) => `${r.size}:${r.so_luong ?? ""}`.replace(/:$/, "")) });
        continue;
      }
      const c = this.candidate(x.item, query, x.score, x.reasons);
      if (key !== "") byCode.set(key, c);
      out.push(c);
    }
    return out.slice(0, limit);
  }
}

/**
 * Sort for a family search ("Boston"): newer version → campaign → better price → more sizes → own
 * warehouse (Desk `agent_level2.js` `compareRecommendationProducts`), so the list no longer depends
 * on the import order of the catalog. Exported for the landing and Xeon.
 */
export function compareRecommendationProducts(left: FoundItem, right: FoundItem, versions: VersionReader = DEFAULT_VERSIONS): number {
  const version = (item: FoundItem): number => Number(versions.of(item.ten)) || 0;
  const campaign = (item: FoundItem): number => (item.khuyenMai === true ? 1 : 0);
  const price = (item: FoundItem): number => priceOf(item) || Number.MAX_SAFE_INTEGER;
  const sizeCount = (item: FoundItem): number => new Set(inStockRows(item).map((r) => r.size.trim()).filter((s) => s !== "")).size;
  const own = (item: FoundItem): number => (sourceOf(item) === "own" ? 0 : 1);
  return (version(right) - version(left))
    || (campaign(right) - campaign(left))
    || (price(left) - price(right))
    || (sizeCount(right) - sizeCount(left))
    || (own(left) - own(right));
}

/** The SKU shape of tier 1's `cham-diem-chung.json`, for callers that sort without a pack in hand. */
const DEFAULT_VERSIONS = new VersionReader("(?:[a-z]{1,3}\\d{4,}|\\d{4,}[a-z]|\\d+[a-z]{1,3}\\d{3,}|\\d{2,}-\\d{2,})");
