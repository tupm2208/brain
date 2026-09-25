/**
 * @file The entity extractor: size, phone, brand, product code, need, budget, address, closing
 * signals — Sales Desk `extractEntities` (~2778) and its helpers, copied as data (24/09/2026).
 *
 * Copied from Desk `ai_router.js`: `SIZE_CORE_PATTERN` + `extractExplicitShoeSize` (~3012, the
 * "42 rưỡi" / "41-1/3" / "size 265" spellings), `resolveBareJapaneseSize` + `bareNumberInCustomerText`
 * (~2966, "size 28" of an adult shoe is 28cm on the tag), the letter sizes (v67), `extractApparelSize`
 * (A/88), `extractProductCode`, `extractProductNameHint`, `extractNeed`, `extractFootForm`,
 * `extractGenderNeed`, `extractBudget`, `extractAddress`, `looksLikeAddressMessage`,
 * `extractClosingSignals` and `recoverSizeFromRecentCustomer`; the tag → size table from
 * `size_chart.js` `FOOT_TABLE`. Pure: no model, no disk.
 *
 * Everything that names a thing of ONE industry is data: the size patterns, the tag chart, the
 * needs and foot forms live in `nganh/<id>/thuc-the.json` + `bang-size.json`; phone, address,
 * budget and gender in `loi-chung/thuc-the-chung.json`. Brands and product-code shapes come from
 * the pack's lexicon and dialogue config, so one list serves the frame, the ledger and this.
 *
 * One deliberate difference from Desk: the contract's `normalize` KEEPS ". , / + -" (Desk's
 * `normalizeText` turned "/" and "," into spaces), so "44 2/3" reaches the patterns as written and
 * the patterns in the JSON accept both spellings.
 */

import type { EntityConfig, SizeChartRow } from "../pack/types";
import type { Turn } from "../ports/index";
import { packRegex } from "./fill-text";
import { hasKeyword } from "./intent-rules";
import { normalize, tokens } from "./text-analysis";

/** How the size was read; the prompt and the gates tell a tag reading from a typed size by it. */
export type SizeSource = "" | "explicit" | "tag" | "bare_tag" | "letter" | "apparel";

/** What one customer message names. Empty string / 0 / [] = not said. */
export interface Entities {
  size: string;
  sizeSource: SizeSource;
  /** "tem 26.5cm → size 42" when the size was converted from a tag reading. */
  sizeNote: string;
  productCode: string;
  productName: string;
  brand: string;
  need: string;
  footForm: string;
  gender: string;
  budgetMin: number;
  budgetMax: number;
  phone: string;
  address: string;
  closingSignals: string[];
}

/** A product the conversation is about, with its stock labels, for the bare tag-size decision. */
export interface SizeCandidate {
  code?: string | undefined;
  name: string;
  brand?: string | undefined;
  category?: string | undefined;
  sizes: readonly string[];
}

export interface ExtractOptions {
  /** Recent history, oldest first; customer turns feed the bare tag-size guards and the size recovery. */
  turns?: readonly Turn[] | undefined;
  /** Products in focus (catalog hits, the frame's product, the ledger's focus). Never the whole catalog. */
  candidates?: readonly SizeCandidate[] | undefined;
}

/** Brands and product-code shapes of the industry, from the pack. */
/** "[1 tệp đính kèm]", "[khách gửi ảnh]", "[gửi 2 ảnh]" — what an inbox writes for an attachment; never a word of the customer's. */
const ATTACHMENT_PLACEHOLDER_RE = /\[[^\]]*(?:tệp|tep|đính kèm|dinh kem|gửi ảnh|gui anh|ảnh|anh)[^\]]*\]/giu;

export interface EntityLexicon {
  brands: readonly string[];
  /** Misspelling → brand ("adidat" → "adidas"), the pack's `lexicon.aliases`. */
  aliases?: Readonly<Record<string, string>> | undefined;
  /** Regexes whose group 1 is a bare product code (the dialogue config's `productCodePatterns`). */
  productCodePatterns: readonly string[];
  /** The dialogue config's attachment placeholders, as regexes (`imagePlaceholders`). */
  placeholderRes?: RegExp[] | undefined;
}

/** "44 2/3" → 44.667, "42.5" → 42.5, "42,5" → 42.5; NaN for letters (Desk `sizeToNumber`). */
export function sizeToNumber(value: string): number {
  const text = value.trim().replace(",", ".");
  const fraction = text.match(/^(\d{1,2})\s*-?\s*([12])\s*\/?\s*3$/);
  if (fraction) return Number(fraction[1]) + Number(fraction[2]) / 3;
  return /^\d{1,2}(?:\.\d)?$/.test(text) ? Number(text) : NaN;
}

/** The tag → size chart of an industry (`bang-size.json`). */
export class SizeChart {
  constructor(private readonly rows: readonly SizeChartRow[]) {}

  get size(): number {
    return this.rows.length;
  }

  /**
   * The row for a tag reading: "26,5" / 26.5 / "265" (millimetres) → size 42. `null` when the
   * chart has no such tag (tolerance a quarter centimetre) or the value is not a tag at all.
   */
  fromTag(tag: number | string): SizeChartRow | null {
    let tem = Number(String(tag).replace(",", "."));
    if (!Number.isFinite(tem)) return null;
    if (tem >= 200 && tem <= 330) tem = tem / 10;
    if (this.rows.length === 0) return null;
    const min = Math.min(...this.rows.map((r) => r.tem));
    const max = Math.max(...this.rows.map((r) => r.tem));
    if (tem < min - 0.26 || tem > max + 0.26) return null;
    return this.rows.find((row) => Math.abs(row.tem - tem) < 0.26) ?? null;
  }
}

/** Reads the entities of one message with the merged entity config of an industry. */
export class EntityExtractor {
  readonly chart: SizeChart;
  private readonly sizePatterns: RegExp[];
  private readonly tagPatterns: RegExp[];
  private readonly barePatterns: RegExp[];
  private readonly codePatterns: RegExp[];

  constructor(private readonly cfg: EntityConfig, private readonly lexicon: EntityLexicon) {
    this.chart = new SizeChart(cfg.sizeChart);
    const expand = (p: string): RegExp => new RegExp(p.split("{core}").join(cfg.sizeCore));
    this.sizePatterns = cfg.sizePatterns.filter((p) => p !== "").map(expand);
    this.tagPatterns = cfg.sizeTagPatterns.filter((p) => p !== "").map((p) => new RegExp(p));
    this.barePatterns = cfg.sizeBarePatterns.filter((p) => p !== "").map((p) => new RegExp(p));
    this.codePatterns = lexicon.productCodePatterns.filter((p) => p !== "").map((p) => new RegExp(p, "gi"));
  }

  /** Every entity of one message (Desk `extractEntities` plus the size conversions the router did afterwards). */
  extract(rawMessage: string, options: ExtractOptions = {}): Entities {
    // An attachment placeholder the inbox wrote is stripped BEFORE anything reads the text: "[1 tệp
    // đính kèm]" once became the product name "tep dinh kem" and sent the finder after it (25/09/2026).
    // An en/em dash in a size range ("43–46") is a hyphen; `normalize` would turn it into a space.
    const message = this.stripPlaceholders(rawMessage).replace(/[–—]/g, "-");
    const normalized = normalize(message);
    // "42,5" must stay a half size: turn the decimal comma into a dot BEFORE reading (Desk v84).
    const forSize = normalize(message.replace(/(\d),(\d)/g, "$1.$2"));
    const brand = this.brand(normalized);
    const productCode = this.productCode(message);
    const productName = this.productNameHint(normalized, brand, productCode);
    const size = this.size(message, forSize, { brand, productCode, productName, turns: options.turns ?? [], candidates: options.candidates ?? [] });
    const phone = this.phone(normalized);
    const budget = this.budget(normalized);
    return {
      ...size,
      productCode, productName, brand,
      need: this.need(normalized),
      footForm: this.footForm(normalized),
      gender: this.gender(normalized),
      budgetMin: budget.min, budgetMax: budget.max,
      phone,
      address: this.address(message),
      closingSignals: this.cfg.closingSignals.filter((s) => s !== "" && normalized.includes(normalize(s)))
    };
  }

  // ------------------------------------------------------------------ size

  private size(message: string, forSize: string, ctx: { brand: string; productCode: string; productName: string; turns: readonly Turn[]; candidates: readonly SizeCandidate[] }): Pick<Entities, "size" | "sizeSource" | "sizeNote"> {
    const none = { size: "", sizeSource: "" as SizeSource, sizeNote: "" };
    // A range label as the warehouse writes it for socks / apparel ("43-46", "43–46") is one size: kept whole (kb2-12).
    const range = /(?:^|\s)(\d{2})\s*[-–]\s*(\d{2})(?=\s|$)/.exec(forSize);
    if (range !== null && Number(range[2]) > Number(range[1]) && Number(range[2]) - Number(range[1]) <= 6) return { size: `${range[1]}-${range[2]}`, sizeSource: "apparel", sizeNote: "" };
    const explicit = this.explicitSize(forSize);
    if (explicit !== "") return { size: explicit, sizeSource: "explicit", sizeNote: "" };
    const tag = this.tagSize(forSize);
    if (tag !== "") {
      const row = this.chart.fromTag(tag);
      return row === null ? { size: tag, sizeSource: "tag", sizeNote: "" } : { size: row.size, sizeSource: "tag", sizeNote: `tem ${row.tem}cm → size ${row.size}` };
    }
    const bare = this.bareSize(forSize);
    if (bare !== "") {
      const resolved = this.resolveBareTagSize(bare, message, ctx.turns, ctx.candidates, ctx.productCode, ctx.productName);
      return resolved === null ? { size: bare, sizeSource: "bare_tag", sizeNote: "" } : { size: resolved.size, sizeSource: "bare_tag", sizeNote: `khach noi "size ${bare}" = so cm tem ${resolved.tem}cm → size ${resolved.size}` };
    }
    const letter = packRegex(this.cfg.sizeLetterPattern)?.exec(forSize);
    if (letter?.[1]) return { size: letter[1].toUpperCase(), sizeSource: "letter", sizeNote: "" };
    const apparel = this.apparelSize(message, forSize);
    if (apparel !== "") return { size: apparel, sizeSource: "apparel", sizeNote: "" };
    return none;
  }

  /** "size 42", "di 41-1/3", "chot 44 2/3", "size 42,5", "size 42 rưỡi" → "42", "41 1/3", "44 2/3", "42.5", "42.5". */
  explicitSize(forSize: string): string {
    for (const re of this.sizePatterns) {
      const m = re.exec(forSize);
      if (!m?.[1]) continue;
      if (m[2]) return `${m[1]} ${m[2]}/3`;
      if (m[3]) return `${m[1]}.5`;
      return m[1];
    }
    return "";
  }

  /** "size 265" / "size 26,5": the tag reading as written, to be converted by the chart. */
  tagSize(forSize: string): string {
    for (const re of this.tagPatterns) {
      const m = re.exec(forSize);
      if (m?.[1]) return m[1].replace(",", ".");
    }
    return "";
  }

  /** "size 28" bare (22–32): the number, for `resolveBareTagSize` to decide. */
  bareSize(forSize: string): string {
    for (const re of this.barePatterns) {
      const m = re.exec(forSize);
      if (m?.[1]) return m[1];
    }
    return "";
  }

  /** "a88", "a/88", "size a 88" → "A/88" (adult trouser sizes of one brand, kept as the warehouse labels them). */
  apparelSize(message: string, forSize: string): string {
    const raw = message.toLowerCase();
    for (const p of this.cfg.apparelSizePatterns) {
      if (p === "") continue;
      const m = new RegExp(p).exec(raw) ?? new RegExp(p).exec(forSize);
      if (m?.[1]) return `${this.cfg.apparelSizePrefix}${m[1]}`;
    }
    return "";
  }

  /**
   * "size 28" said BARE by a customer buying an adult shoe is the centimetres on the tag (28 = 44).
   * Not converted when the number is a date / percent / price / house number, a foot measurement,
   * already a tag or cm reading, when the product is apparel or a kids' shoe, or when the chart has
   * no such tag. Returns the chart row or `null` (Desk `resolveBareJapaneseSize`).
   */
  resolveBareTagSize(raw: string, message: string, turns: readonly Turn[], candidates: readonly SizeCandidate[], productCode: string, productName: string): SizeChartRow | null {
    const g = this.cfg.bareTag;
    const value = raw.trim().replace(",", ".");
    if (!(packRegex(g.range)?.test(value) ?? false)) return null;
    const num = Number(value);
    if (g.maxTem > 0 && num > g.maxTem) return null;
    const said = this.bareNumberInCustomerText(value, message, turns);
    if (said === null) return null;
    const code = productCode.toUpperCase();
    const byCode = code === "" ? [] : candidates.filter((c) => (c.code ?? "").toUpperCase() === code);
    const seen = new Set<string>();
    const uniq = [...byCode, ...candidates].filter((c) => { const k = c.code ?? c.name; if (seen.has(k)) return false; seen.add(k); return true; });
    const apparelRe = packRegex(g.apparelWords);
    let sawShoe = false;
    for (const product of uniq) {
      const labels = product.sizes.map((s) => String(s).trim()).filter((s) => s !== "");
      const nums = labels.map(sizeToNumber).filter((n) => Number.isFinite(n));
      if (apparelRe?.test(normalize(`${product.name} ${product.category ?? ""}`)) ?? false) return null;
      if (labels.length === 0) continue;
      if (nums.length === 0) return null;
      if (nums.some((n) => Math.abs(n - num) < 0.01)) return null;
      if (g.adultMin > 0 && nums.some((n) => n < g.adultMin)) return null;
      sawShoe = true;
    }
    if (!sawShoe) {
      const depth = g.historyDepth > 0 ? g.historyDepth : 8;
      const custText = normalize([message, ...turns.filter((t) => t.role === "customer").slice(-depth).map((t) => t.text)].join(" "));
      if (packRegex(g.kidsText)?.test(custText) ?? false) return null;
      const nameNorm = normalize(productName);
      if ((apparelRe?.test(nameNorm) ?? false) || (uniq.length === 0 && (apparelRe?.test(said) ?? false))) return null;
      if (nameNorm !== "" && (packRegex(g.kidsLine)?.test(nameNorm.trim()) ?? false)) return null;
    }
    return this.chart.fromTag(num);
  }

  /** The normalised customer text that says the number bare, or `null` (Desk `bareNumberInCustomerText`). */
  private bareNumberInCustomerText(raw: string, message: string, turns: readonly Turn[]): string | null {
    const g = this.cfg.bareTag;
    const depth = g.historyDepth > 0 ? g.historyDepth : 8;
    const rawRe = raw.replace(".", "\\.");
    const intPart = raw.replace(/\.5$/, "");
    const texts = [message, ...turns.filter((t) => t.role === "customer").slice(-depth).reverse().map((t) => t.text)];
    for (const text of texts) {
      const lower = text.toLowerCase();
      let n = normalize(text.replace(/(\d),(\d)/g, "$1.$2"));
      if (/\.5$/.test(raw)) n = n.replace(new RegExp(`(^|[^\\d.])${intPart}\\s*ruoi\\b`), `$1${intPart}.5`);
      if (!new RegExp(`(^|[^\\d.])${rawRe}(?!\\d)`).test(n)) continue;
      // On the original text: a date "28/9", "28-9", a percentage "28%", a time "28:00".
      if (new RegExp(`(^|[^\\d.,])${intPart}\\s*(?:[/\\-:]\\s*\\d|%)|\\d\\s*[/\\-]\\s*${intPart}(?![\\d])`).test(lower)) return null;
      if (g.unitAfter !== "" && !new RegExp(`(^|[^\\w.,/])${rawRe}${g.unitAfter}`).test(n)) return null;
      if (g.notBefore !== "" && new RegExp(`${g.notBefore}${rawRe}\\b`).test(n)) return null;
      if (g.footMeasure !== "" && new RegExp(`${g.footMeasure}${rawRe}\\b`).test(n)) return null;
      if (g.tagWord !== "" && new RegExp(`${g.tagWord}${rawRe}\\b|\\b${rawRe}\\s*cm\\b`).test(n)) return null;
      return n;
    }
    return null;
  }

  /**
   * The size the customer settled on in a recent message ("lay 37 1/3 va 38", "size 42,5"), so a
   * later address message does not lose it. Negated mentions ("khong lay 36") are skipped.
   */
  recoverSizeFromRecentCustomer(turns: readonly Turn[]): string {
    const re = packRegex(this.cfg.sizeRecoverPattern, "g");
    if (re === null) return "";
    const negation = packRegex(this.cfg.sizeRecoverNegation);
    const depth = this.cfg.sizeRecoverDepth > 0 ? this.cfg.sizeRecoverDepth : 6;
    const texts = turns.filter((t) => t.role === "customer").slice(-depth).map((t) => normalize(t.text.replace(/(\d),(\d)/g, "$1.$2")));
    for (let i = texts.length - 1; i >= 0; i -= 1) {
      const text = texts[i]!;
      re.lastIndex = 0;
      let last: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const before = text.slice(Math.max(0, m.index - 8), m.index);
        if (negation !== null && negation.test(before)) continue;
        last = m;
      }
      if (last?.[1]) return last[1].replace(/\s*\/\s*/g, "/").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
    }
    return "";
  }

  // ------------------------------------------------------------- the rest

  /** The first pack brand (or alias of one) said as a whole word. */
  brand(normalized: string): string {
    const direct = this.lexicon.brands.find((b) => hasKeyword(normalized, b));
    if (direct !== undefined) return direct;
    for (const [alias, target] of Object.entries(this.lexicon.aliases ?? {})) {
      if (this.lexicon.brands.includes(target) && hasKeyword(normalized, alias)) return target;
    }
    return "";
  }

  /** A product code in the message: the industry's shapes first, then Desk's generic upper-case fallback. */
  productCode(message: string): string {
    const ignored = new Set([...this.cfg.productCodeIgnore, ...this.lexicon.brands].map((s) => s.toUpperCase()));
    const notCode = this.cfg.productCodeNotCode.filter((p) => p !== "").map((p) => new RegExp(p, "i"));
    const accept = (code: string): boolean => !ignored.has(code.toUpperCase()) && !notCode.some((re) => re.test(code));
    for (const re of this.codePatterns) {
      re.lastIndex = 0;
      for (const m of message.matchAll(re)) if (m[1] && accept(m[1])) return m[1].toUpperCase();
    }
    const fallback = packRegex(this.cfg.productCodeFallback, "g");
    if (fallback === null) return "";
    for (const m of message.matchAll(fallback)) if (m[0] && accept(m[0])) return m[0];
    return "";
  }

  /** The message without the inbox's attachment placeholders (the dialogue config's and the built-in shapes). */
  stripPlaceholders(message: string): string {
    let out = String(message ?? "").replace(ATTACHMENT_PLACEHOLDER_RE, " ");
    for (const re of this.lexicon.placeholderRes ?? []) out = out.replace(re, " ");
    return out.replace(/\s{2,}/g, " ").trim();
  }

  /** Up to five meaningful words of the message that could be a product name (noise, sizes and the code removed). */
  productNameHint(normalized: string, brand: string, productCode: string): string {
    // "đơn của tôi đổi size 43" names an order, not a product: reading "don cua toi" as a model
    // name sent the finder after garbage and dragged an unrelated line in front of the customer.
    if (packRegex(this.cfg.orderTalk)?.test(normalized) ?? false) return "";
    const noise = new Set(this.cfg.nameNoiseWords.map(normalize));
    // Punctuation glued to a word ("khong,") would hide it from the stop list.
    let cleaned = normalized.replace(/[,;!?()"']+/g, " ");
    if (productCode !== "") cleaned = cleaned.split(normalize(productCode)).join(" ");
    const words = tokens(cleaned)
      .filter((t) => t.length >= 3 || t === normalize(brand))
      .filter((t) => !noise.has(t))
      .filter((t) => !/^(?:sz|size|eu|co|so)?\d{1,3}(?:[.,]\d)?$/.test(t))
      // Numbers, fractions, ranges and times ("1/3", "3-4", "4:30") name nothing (25/09/2026, kb2-19).
      .filter((t) => !/^[\d/.,:-]+$/.test(t));
    // What is left must still carry a word: a hint of stop words only ("sang duoc khong") is no hint.
    if (!words.some((t) => /\p{L}/u.test(t))) return "";
    return words.slice(0, 5).join(" ");
  }

  phone(normalized: string): string {
    const m = packRegex(this.cfg.phone)?.exec(normalized);
    return m ? m[0].replace(/[^\d+]/g, "") : "";
  }

  need(normalized: string): string {
    return this.cfg.needs.filter((n) => n !== "" && normalized.includes(normalize(n))).join(", ");
  }

  footForm(normalized: string): string {
    return Object.entries(this.cfg.footForms).filter(([, phrases]) => phrases.some((p) => p !== "" && normalized.includes(normalize(p)))).map(([key]) => key).join(", ");
  }

  gender(normalized: string): string {
    for (const [label, pattern] of Object.entries(this.cfg.genders)) {
      if (pattern !== "" && new RegExp(pattern).test(normalized)) return label;
    }
    return "";
  }

  /** "tam 1tr2", "duoi 2 trieu", "tu 1tr den 2tr" → {min, max} in đồng; 0 when not said (Desk `extractBudget`). */
  budget(normalized: string): { min: number; max: number } {
    const b = this.cfg.budget;
    if (!(packRegex(b.trigger)?.test(normalized) ?? false)) return { min: 0, max: 0 };
    const amountRe = packRegex(b.amount, "g");
    if (amountRe === null) return { min: 0, max: 0 };
    const million = new Set(b.millionUnits);
    const thousand = new Set(b.thousandUnits);
    const toMoney = (raw: string, unit: string): number => {
      const number = Number(raw.replace(",", "."));
      if (!Number.isFinite(number) || number <= 0) return 0;
      if (million.has(unit)) return Math.round(number * 1_000_000);
      if (thousand.has(unit)) return Math.round(number * 1_000);
      return number >= b.minValue ? Math.round(number) : 0;
    };
    // "1tr2" = one million two hundred thousand: the tenth after the unit, which Desk dropped.
    const text = normalized.replace(/\b(\d+)\s*(tr|trieu)\s*(\d)\b(?!\s*(?:k|nghin|ngan|\d))/g, (_m, whole: string, unit: string, tenth: string) => `${whole}.${tenth} ${unit}`);
    const values = [...text.matchAll(amountRe)].map((m) => toMoney(m[1] ?? "", (m[2] ?? "").toLowerCase())).filter((v) => v >= b.minValue);
    const first = values[0];
    if (first === undefined) return { min: 0, max: 0 };
    const second = values[1];
    if (second !== undefined && (packRegex(b.range)?.test(normalized) ?? false)) return { min: Math.min(first, second), max: Math.max(first, second) };
    if ((packRegex(b.from)?.test(normalized) ?? false) && !(packRegex(b.upTo)?.test(normalized) ?? false)) return { min: first, max: 0 };
    return { min: 0, max: first };
  }

  /** The address after "dia chi:" / "ship ve", or the text after a phone number (Desk `extractAddress`). */
  address(message: string): string {
    const marker = packRegex(this.cfg.address.markers, "i")?.exec(message);
    if (marker) return message.slice(marker.index + marker[0].length).trim();
    const phoneRe = packRegex(this.cfg.phone.replace(/\\b$/, ""));
    const phone = phoneRe?.exec(message);
    if (phone) {
      const after = message.slice(phone.index + phone[0].length).replace(/^[\s,.;:–-]+/, "").trim();
      if (after.length >= 5 && /[a-zA-ZÀ-ỹ]/.test(after)) return after;
    }
    return "";
  }

  /** The whole message is an address block ("145b/4 ap Bach Lam…"), so no number in it is a size (Desk `looksLikeAddressMessage`). */
  looksLikeAddress(message: string): boolean {
    const a = this.cfg.address;
    const normalized = normalize(message);
    if (normalized === "" || (a.maxLength > 0 && normalized.length > a.maxLength)) return false;
    let placeText = normalized;
    for (const p of a.notPlaceBigrams) if (p !== "") placeText = placeText.replace(new RegExp(p, "g"), " ");
    const hasPlaceWord = packRegex(a.placeWords)?.test(` ${placeText} `) ?? false;
    const hasHouseNumber = packRegex(a.houseNumber)?.test(normalized) ?? false;
    return hasPlaceWord && (hasHouseNumber || normalized.split(" ").length >= (a.minWords > 0 ? a.minWords : 5));
  }
}

/** The lexicon an extractor needs, from a pack's lexicon and dialogue config. */
export function entityLexiconOf(lexicon: { brands: string[]; aliases?: Record<string, string> | undefined }, dialogue: { productCodePatterns: string[]; imagePlaceholders?: string[] | undefined }): EntityLexicon {
  const placeholderRes = (dialogue.imagePlaceholders ?? []).filter((p) => p !== "").map((p) => { try { return new RegExp(p.replace(/^\^|\$/g, ""), "gi"); } catch { return null; } }).filter((re): re is RegExp => re !== null);
  return { brands: lexicon.brands, aliases: lexicon.aliases ?? {}, productCodePatterns: dialogue.productCodePatterns, placeholderRes };
}
