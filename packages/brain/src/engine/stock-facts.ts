/**
 * @file The stock TRUTH handed to the model, and the plan of finder calls that produces it
 * (Desk `buildStockFacts` ~1427, `ensureStockCascade` ~2161, `lookup_tools.js` `runResolveStock`
 * ~415, `agent_level2.js` `mergeSizeRows` — 25/09/2026).
 *
 * The model never guesses stock: it reads `StockFacts`. Each field is one replay:
 *   - price BY SIZE and BY WAREHOUSE (v8): the same code sits in two warehouses at two prices, and
 *     the price quoted is the one of the warehouse that HAS the size — the lowest when several do,
 *     as the web shows (Nguyen Duyen JP9252, 07/09);
 *   - "còn màu nào khác?" lists the SAME MODEL's other colourways that still have the size, plus
 *     one filter link (Nguyen Duc Liem, 05/09) — without the list the model said "hết màu khác";
 *   - a weak hit (nothing, or only a step DOWN) looks for a colourway with a better step;
 *   - the cascade opens the next rung only when the previous one cannot serve the SIZE: "Boston 13
 *     còn không?" with no size must not drag Boston 12 in front of the customer.
 * Pure: `buildStockFacts` reads the items the finder returned; `planStockCascade` returns the
 * calls Xeon should make, in order, and never makes them.
 */

import type { MatchingConfig } from "../pack/types";
import { inStockRows, priceOf, sourceOf, VersionReader, type FoundItem, type FoundSize } from "./catalog-score";
import { findLine, type ProductLine } from "./dialogue-frame";
import type { TurnFacts } from "./fact-note";
import { fillText, packRegex } from "./fill-text";
import { SizeMatcher, type SizeStock } from "./size-match";
import { escapeRe, normalize } from "./text-analysis";

/** A product line with what the stock cascade needs of `line-dna.json`: the equivalent and the beginner lines. */
export interface CascadeLine extends ProductLine {
  equivalents?: string[] | undefined;
  beginnerAlternative?: string[] | undefined;
  purpose?: string | undefined;
  note?: string | undefined;
}

export interface VariantInStock {
  code: string;
  name: string;
  price: number | undefined;
  /** In-stock labels (the requested size only, when one was asked). */
  sizesInStock: string[];
  partner: boolean;
}

export interface StockFacts {
  productCode: string;
  productName: string;
  requestedSize: string;
  stock: { size: string; qty: number | undefined; approximate: boolean } | null;
  /** The price of the size (the warehouse that has it), else the item's lowest price. */
  price: number;
  stockType?: "san" | "order" | undefined;
  /** The warehouse the size ships from (its code as the finder gave it), when known. */
  kho?: string | undefined;
  /** The selling terms of that warehouse, quoted from the finder's `dieu_kien`. */
  sellingTerms?: string | undefined;
  /** "K2: hết size, giá 1.990.000" — the other warehouses carrying the code (Desk v8). */
  otherKho: string[];
  /** Same model, other colourways with the size (only when the customer asked for other colours). */
  variantsAvailable: VariantInStock[];
  filterLink?: string | undefined;
  colorwayAlternative?: { code: string; name: string; size: string; qty: number | undefined; price: number; approximate: boolean } | null | undefined;
}

export interface StockFactsQuery {
  code: string;
  requestedSize?: string | undefined;
  /** The customer asked "còn màu nào khác" (Desk's `asksColors`): list the same model's colourways instead. */
  otherColorsAsked?: boolean | undefined;
}

export interface StockFactsOptions {
  lines?: readonly ProductLine[] | undefined;
  /** Builds the storefront filter link for the model (`line`, `version`, `size`, `gender`); the landing owns its URL shape. */
  filterLink?: ((q: { line: string; version: string; size: string; gender: string }) => string) | undefined;
}

/** Builds stock facts with one industry's matching data. */
export class StockFactsBuilder {
  readonly sizes: SizeMatcher;
  readonly versions: VersionReader;
  private readonly lineNoise: Set<string>;
  private readonly genders: [string, RegExp][];

  constructor(private readonly cfg: MatchingConfig) {
    this.sizes = new SizeMatcher(cfg.sizes);
    this.versions = new VersionReader(cfg.skuLikePattern);
    this.lineNoise = new Set(cfg.lineNoiseTokens.map(normalize));
    this.genders = Object.entries(cfg.genderTokens).map(([k, p]) => [k, packRegex(p)] as [string, RegExp | null]).filter((x): x is [string, RegExp] => x[1] !== null);
  }

  private text(key: string, fallback: string): string {
    return this.cfg.texts[key] ?? fallback;
  }

  /** "M" / "W" from the name, "" when it says nothing (Desk `productGenderKey`). */
  genderOf(name: string): string {
    const n = normalize(name);
    for (const [key, re] of this.genders) if (re.test(n)) return key;
    return "";
  }

  /** The words of a name that make it a LINE: no noise, no numbers, no SKU fragments (Desk `lineTokensOf`). */
  lineTokens(name: string): string[] {
    return normalize(name).split(" ").filter((t) => t.length >= 3 && !this.lineNoise.has(t)).filter((t) => !/^\d+$/.test(t)).filter((t) => !/^[a-z]{1,3}\d{3,}$/.test(t));
  }

  /** "Adizero Adios" and "Adizero Adios Pro" are two lines: the token SETS must be equal, not one inside the other (Do Quan, 24/08). */
  sameLine(a: readonly string[], b: readonly string[]): boolean {
    if (a.length === 0 || a.length !== b.length) return false;
    const other = new Set(b);
    return a.every((t) => other.has(t));
  }

  /** "lineId:version" when a line is known, else the line tokens + version — the key of "same model, other colourway". */
  modelKey(item: FoundItem, lines: readonly ProductLine[]): string {
    const line = findLine(item.ten, lines);
    const version = this.versions.of(item.ten);
    if (line !== null) return `${line.id}:${version}`;
    return `${this.lineTokens(item.ten).sort().join(" ")}:${version}`;
  }

  /** Desk `buildStockFacts`. `null` when the product is not among the items, or no size was asked and no colours either. */
  build(found: readonly FoundItem[], query: StockFactsQuery, options: StockFactsOptions = {}): StockFacts | null {
    const lines = options.lines ?? [];
    const product = found.find((it) => it && normalize(it.ma) === normalize(query.code));
    if (product === undefined) return null;
    const size = (query.requestedSize ?? "").trim();
    const rows = inStockRows(product);

    if (query.otherColorsAsked === true) {
      const variants = this.sameModelVariants(found, product, size, lines);
      const gender = new Set(variants.map((v) => this.genderOf(v.name)).filter((g) => g !== ""));
      const link = variants.length >= 2 && options.filterLink !== undefined
        ? options.filterLink({ line: this.lineQuery(product, lines), version: this.versions.of(product.ten), size, gender: gender.size === 1 ? [...gender][0]! : "" })
        : "";
      const hit = size !== "" ? this.sizes.nearest(rows, size) : null;
      return {
        productCode: product.ma, productName: product.ten, requestedSize: size,
        stock: hit === null ? null : { size: hit.size, qty: hit.qty, approximate: hit.approximate },
        price: hit !== null && hit.row.gia > 0 ? hit.row.gia : priceOf(product),
        otherKho: [], variantsAvailable: variants, ...(link !== "" ? { filterLink: link } : {})
      };
    }
    if (size === "") return null;

    // The size: the cheapest warehouse that has it (rows are per label; the finder already picked the warehouse).
    const matches = this.sizes.matches(rows, size);
    const best = [...matches].sort((a, b) => (a.gia || Number.MAX_SAFE_INTEGER) - (b.gia || Number.MAX_SAFE_INTEGER))[0];
    let stock: SizeStock | null = best !== undefined ? { size: best.size, qty: best.so_luong, approximate: !this.exactLabel(best.size, size), row: best } : this.sizes.nearest(rows, size);
    if (stock !== null && best === undefined && stock.approximate) {
      // A neighbouring step only: keep it, the customer is told it is approximate.
    }
    const row = stock?.row as FoundSize | undefined;
    const price = row !== undefined && row.gia > 0 ? row.gia : priceOf(product);
    const kho = row?.kho ?? "";
    const otherKho = this.otherWarehouses(product, size, kho);
    const stockType = this.stockTypeOf(product, row);
    const terms = row?.dk !== undefined ? product.dieu_kien?.[row.dk] : undefined;

    // A weak hit: look for the same model in another colourway with a better step.
    let colorway: StockFacts["colorwayAlternative"] = null;
    if (this.sizes.isWeak(stock, size)) {
      const alt = this.sameModelColorwayWithSize(found, product, size, lines);
      if (alt !== null && !this.sizes.isWeak(alt.stock, size)) {
        colorway = { code: alt.item.ma, name: alt.item.ten, size: alt.stock.size, qty: alt.stock.qty, price: alt.stock.row.gia > 0 ? alt.stock.row.gia : priceOf(alt.item), approximate: alt.stock.approximate };
      }
    }
    if (stock !== null && stock.qty !== undefined && stock.qty <= 0) stock = null;
    return {
      productCode: product.ma, productName: product.ten, requestedSize: size,
      stock: stock === null ? null : { size: stock.size, qty: stock.qty, approximate: stock.approximate },
      price,
      ...(stockType !== undefined ? { stockType } : {}),
      ...(kho !== "" ? { kho } : {}),
      ...(terms !== undefined ? { sellingTerms: terms } : {}),
      otherKho, variantsAvailable: [], colorwayAlternative: colorway
    };
  }

  private exactLabel(label: string, requested: string): boolean {
    if (this.sizes.key(label) === this.sizes.key(requested)) return true;
    const a = this.sizes.toNumber(label);
    const b = this.sizes.toNumber(requested);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }

  private stockTypeOf(product: FoundItem, row: FoundSize | undefined): "san" | "order" | undefined {
    const kind = row?.loai ?? product.loai ?? "";
    if (kind === "") return undefined;
    return /order/i.test(kind) ? "order" : "san";
  }

  /** The other warehouses of the code: which of them has the size, at what price (Desk v8 `otherKho`). */
  private otherWarehouses(product: FoundItem, size: string, chosen: string): string[] {
    const rows = inStockRows(product);
    const perKho = new Map<string, { has: boolean; price: number }>();
    for (const row of rows) {
      const kho = row.kho ?? "";
      if (kho === "" || kho === chosen) continue;
      const entry = perKho.get(kho) ?? { has: false, price: 0 };
      const has = this.sizes.same(row.size, size);
      if (has) entry.has = true;
      if (row.gia > 0 && (entry.price === 0 || (has && row.gia < entry.price))) entry.price = row.gia;
      perKho.set(kho, entry);
    }
    return [...perKho.entries()].map(([kho, e]) => fillText(this.text("otherKho", "{kho}: {ton} size, giá {gia}"), {
      kho, ton: e.has ? this.text("inStock", "còn") : this.text("outOfStock", "hết"), gia: e.price > 0 ? e.price.toLocaleString("vi-VN") : ""
    }));
  }

  /** The longest line alias in the product's name (+ version), for the filter link's query. */
  private lineQuery(product: FoundItem, lines: readonly ProductLine[]): string {
    const line = findLine(product.ten, lines);
    if (line === null) return this.lineTokens(product.ten).join(" ");
    const name = ` ${normalize(product.ten)} `;
    const aliases = [line.name, ...(line.aliases ?? [])].map(normalize).filter((a) => a !== "");
    const alias = aliases.filter((a) => name.includes(` ${a} `)).sort((x, y) => y.length - x.length)[0] ?? aliases[0] ?? "";
    // The alias may carry the version ("boston 13"); the caller appends the version itself (Desk's `\bversion\b` guard).
    const version = this.versions.of(product.ten);
    return version === "" ? alias : alias.replace(new RegExp(`\\s*\\b${escapeRe(version)}\\b`), "").trim();
  }

  /** Same model (line + version), same gender when the base names one, with the size in stock (Desk `sameModelVariantsInStock`). */
  sameModelVariants(found: readonly FoundItem[], product: FoundItem, size: string, lines: readonly ProductLine[], ignoreGender = false): VariantInStock[] {
    const baseKey = this.modelKey(product, lines);
    if (baseKey.startsWith(":")) return [];
    const baseGender = ignoreGender ? "" : this.genderOf(product.ten);
    const out: VariantInStock[] = [];
    for (const item of found) {
      if (!item || this.modelKey(item, lines) !== baseKey) continue;
      if (baseGender !== "" && this.genderOf(item.ten) !== "" && this.genderOf(item.ten) !== baseGender) continue;
      const seen = new Set<string>();
      const sizes: string[] = [];
      for (const row of inStockRows(item)) {
        const label = row.size.trim();
        if (label === "" || seen.has(label)) continue;
        if (size !== "" && !this.sizes.same(label, size)) continue;
        seen.add(label); sizes.push(label);
      }
      if (sizes.length === 0) continue;
      out.push({ code: item.ma, name: item.ten, price: priceOf(item) || undefined, sizesInStock: sizes.slice(0, 40), partner: sourceOf(item) === "partner" });
      if (out.length >= 8) break;
    }
    if (out.length === 0 && baseGender !== "" && !ignoreGender) return this.sameModelVariants(found, product, size, lines, true);
    return out.sort((a, b) => (a.code === product.ma ? -1 : b.code === product.ma ? 1 : 0) || (Number(a.partner) - Number(b.partner)));
  }

  /** Another colourway of the model with the size: exact step first, own warehouse, more stock (Desk `sameModelColorwayWithSize`). */
  sameModelColorwayWithSize(found: readonly FoundItem[], product: FoundItem, size: string, lines: readonly ProductLine[]): { item: FoundItem; stock: SizeStock & { row: FoundSize } } | null {
    const baseKey = this.modelKey(product, lines);
    if (baseKey.startsWith(":")) return null;
    const candidates: { item: FoundItem; stock: SizeStock & { row: FoundSize } }[] = [];
    for (const item of found) {
      if (!item || normalize(item.ma) === normalize(product.ma) || sourceOf(item) === "partner") continue;
      if (this.modelKey(item, lines) !== baseKey) continue;
      const stock = this.sizes.nearest(inStockRows(item), size);
      if (stock !== null) candidates.push({ item, stock });
    }
    candidates.sort((a, b) => (Number(a.stock.approximate) - Number(b.stock.approximate)) || ((b.stock.qty ?? 1) - (a.stock.qty ?? 1)));
    return candidates[0] ?? null;
  }
}

/** Desk `buildStockFacts` as a function: the items the finder returned, the code and size asked, the industry's matching data. */
export function buildStockFacts(found: readonly FoundItem[], query: StockFactsQuery, cfg: MatchingConfig, options: StockFactsOptions = {}): StockFacts | null {
  return new StockFactsBuilder(cfg).build(found, query, options);
}

/** The `MAU_KHAC` block of the system note from the facts (empty when the customer did not ask for colours). */
export function turnFactsFromStock(facts: StockFacts | null): Pick<TurnFacts, "otherVariants"> {
  if (facts === null || facts.variantsAvailable.length === 0) return {};
  return {
    otherVariants: {
      productName: facts.productName, productCode: facts.productCode,
      ...(facts.requestedSize !== "" ? { requestedVariant: facts.requestedSize } : {}),
      items: facts.variantsAvailable.map((v) => ({ code: v.code, name: v.name, price: v.price, variants: v.sizesInStock, partner: v.partner })),
      ...(facts.filterLink !== undefined ? { filterLink: facts.filterLink } : {})
    }
  };
}

// ---------------------------------------------------------------- the cascade plan

export type CascadeLevel = "exact_code" | "same_line_same_version" | "same_line_other_version" | "equivalent_line" | "beginner_line";

/** Rungs that count as "found real stock"; the two outside-catalog rungs of Desk are not rungs here (the line is simply not found). */
export const CASCADE_FOUND_LEVELS: readonly CascadeLevel[] = ["exact_code", "same_line_same_version", "same_line_other_version", "equivalent_line"];

export interface CascadeStep {
  level: CascadeLevel;
  /** The `catalog.find` input for this rung. */
  find: { ma?: string | undefined; ten?: string | undefined; size?: string | undefined };
  /** The line this rung searches (an equivalent / beginner line carries its id, purpose and note for the prompt). */
  line?: { id: string; name: string; purpose?: string | undefined; note?: string | undefined } | undefined;
  /** Stop the cascade here when this rung returns an item with the requested size. */
  stopWhenSizeFound: boolean;
}

export interface CascadeQuery {
  productCode?: string | undefined;
  productName?: string | undefined;
  size?: string | undefined;
  modelVersion?: string | undefined;
  /** The customer's whole message, for a line named in it ("Nimbus 28 bên mình có không"). */
  message?: string | undefined;
}

/**
 * Desk `ensureStockCascade` + the rungs of `runResolveStock`, as a PLAN: exact code → same line
 * and version → other versions of the line (size given only) → equivalent lines → beginner lines.
 * Xeon calls `catalog.find` rung by rung and stops at the first that has the size. Empty when
 * nothing names a product, or a line is named without a size and without a code (a size-less
 * "còn không" is answered from the first rung alone).
 */
export function planStockCascade(query: CascadeQuery, lines: readonly CascadeLine[] = [], versions: VersionReader = new VersionReader("")): CascadeStep[] {
  const code = (query.productCode ?? "").trim();
  const name = (query.productName ?? "").trim();
  const size = (query.size ?? "").trim();
  // `lines` are cascade lines, so what `findLine` picks is one of them.
  const line = (findLine(name, lines) ?? findLine(query.message ?? "", lines)) as CascadeLine | null;
  if (code === "" && name === "" && line === null) return [];
  const sizeArg = size !== "" ? { size } : {};
  const steps: CascadeStep[] = [];
  if (code !== "") steps.push({ level: "exact_code", find: { ma: code, ...sizeArg }, stopWhenSizeFound: true });
  const explicit = (query.modelVersion ?? "").trim();
  const version = /^\d{1,2}$/.test(explicit) ? explicit : line !== null ? versions.afterLine(`${name} ${query.message ?? ""}`, [line.name, ...(line.aliases ?? [])]) : versions.afterLine(name, [name.replace(/\s*\d{1,2}\s*$/, "")]);
  const lineName = line !== null ? line.name : name.replace(new RegExp(`\\s*${escapeRe(version)}\\s*$`), "").trim();
  if (lineName !== "" && (line !== null || name !== "")) {
    steps.push({ level: "same_line_same_version", find: { ten: version !== "" ? `${lineName} ${version}` : lineName, ...sizeArg }, ...(line !== null ? { line: { id: line.id, name: line.name } } : {}), stopWhenSizeFound: true });
    if (size !== "" && version !== "") steps.push({ level: "same_line_other_version", find: { ten: lineName, size }, ...(line !== null ? { line: { id: line.id, name: line.name } } : {}), stopWhenSizeFound: true });
  }
  if (size !== "" && line !== null) {
    const byId = new Map(lines.map((l) => [l.id, l] as const));
    for (const id of line.equivalents ?? []) {
      const eq = byId.get(id);
      if (eq === undefined) continue;
      steps.push({ level: "equivalent_line", find: { ten: eq.name, size }, line: { id: eq.id, name: eq.name, purpose: eq.purpose, note: eq.note }, stopWhenSizeFound: false });
    }
    for (const id of line.beginnerAlternative ?? []) {
      const alt = byId.get(id);
      if (alt === undefined) continue;
      steps.push({ level: "beginner_line", find: { ten: alt.name, size }, line: { id: alt.id, name: alt.name, purpose: alt.purpose, note: alt.note }, stopWhenSizeFound: false });
    }
  }
  return steps;
}
