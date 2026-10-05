/**
 * @file What every reply rule reads: the sources of truth of one turn and the small text helpers
 * of Desk's gates (`gateNormalize`, `wordIn`, `splitReplySentences`, `gatePricesIn`).
 *
 * The rule of the whole gate, unchanged from Desk (27/08/2026): THE ONLY VALID SOURCES ARE WHAT A
 * PERSON ON DUTY WROTE, THE POLICY LOOKUP AND THE SHOP PROFILE. A number the customer said is not a
 * source; a sentence the bot itself wrote earlier is not a source either (`shopSaid` carries lines a
 * PERSON typed, never the bot's — Desk's `shopText` mixed both and the bot defended its own earlier
 * invention, case Duy Nam 31/08).
 */

import type { ShopProfile } from "@sp/contract";
import type { ReplyGateConfig, ReplyGatePronoun, SizeChartRow } from "../../pack/types";
import { inStockRows, priceOf, type FoundItem } from "../catalog-score";
import { fillText } from "../fill-text";
import type { StockFacts } from "../stock-facts";
import { escapeRe, stripDiacritics } from "../text-analysis";
import type { SizeHint, VariantRow } from "../size-advisor";

/** A product the pipeline named to the model (advice candidates, image matches). */
export interface GateProduct {
  code: string;
  name: string;
  price?: number | undefined;
  link?: string | undefined;
}

/** What the pipeline looked up this turn. `tracking` is the ACTIVE parcel of the customer's order. */
export interface GateLookups {
  orderLooked: boolean;
  tracking?: { url: string; code?: string | undefined; statusLabel?: string | undefined } | null | undefined;
  /** The order's exchange window (Desk v92: an order the warehouse has not bought yet can still change size). */
  exchange?: { allowed: boolean } | null | undefined;
}

/** Links the pipeline prepared for the model (group / line links, the storefront filter). */
export interface GateLinks {
  lineLinks?: { name: string; url: string; count?: number | undefined }[] | undefined;
  groupLink?: string | undefined;
  filterLink?: string | undefined;
}

/** The sources of truth the gate compares the draft against. Strings are RAW text (diacritics kept). */
export interface GateSources {
  /** Lines a PERSON on duty wrote (who = "nguoi"), joined. Never the bot's own lines. */
  shopSaid: string;
  /** The customer's recent lines, the current message last. */
  customerSaid: string;
  /** The current message alone; defaults to the last line of `customerSaid`. */
  customerMessage?: string | undefined;
  /** The policy text the lookup returned ("" when none). */
  policy: string;
  hoSo: ShopProfile | null;
  /** What the catalog finder returned this turn. */
  found: FoundItem[];
  stockFacts: StockFacts | null;
  lookups: GateLookups;
  adviceCandidates?: GateProduct[] | undefined;
  links: GateLinks;
  /** The shoe the customer said they are wearing (context analysis `needBrief.currentShoe`). */
  currentShoe?: string | undefined;
  /** How the customer is addressed ("bác"). */
  pronoun: string;
  /** The uncertain-product gate said the item is not identified: a stock assertion is invented. */
  uncertainProduct: boolean;
  /** Money the pipeline itself computed (the deposit of the order form): a sourced amount. */
  moneyContext?: { deposit?: number | undefined } | undefined;
  /** The customer attached photos this turn. */
  hasImages?: boolean | undefined;
  /** The landing sends product CARDS (pictures) with this reply (Giai đoạn 7): the bot must not send the customer to a link for pictures. */
  cardsSent?: boolean | undefined;
  /** The turn is a closing (place_order): the system sends the order form, the bot must not ask for contact details. */
  closing?: boolean | undefined;
  /** A group chat with several customers: an order looked up may be someone else's, no tracking link. */
  inGroup?: boolean | undefined;
  /** The shop's public address ("toprun.site"), for `{site}` and the link check. */
  site?: string | undefined;
  tenShop?: string | undefined;
  /** Who takes over when the bot hands off ("người phụ trách" by default). */
  tenNguoiPhuTrach?: string | undefined;
  /** The industry's tag → size chart, for a size the bot converted from centimetres. */
  sizeChart?: readonly SizeChartRow[] | undefined;
  /**
   * 05/10/2026 (phiếu Desk nhóm số đo): what tier 1 concluded from the customer's measurements —
   * the measurements read even without their unit, whether a variant may be named yet, which ones a
   * conversion sentence may name. `null` / absent = the customer gave no measurement.
   */
  sizeHint?: SizeHint | null | undefined;
  /** 05/10/2026: what the stock tools answered IN WORDS this turn (a "hết size … size đang còn: …" sentence lists labels too). */
  toolText?: string | undefined;
  /** The variant map of the brand in focus (its own chart, or the industry table): label ↔ tag ↔ body measurement ↔ other systems. */
  variantRows?: readonly VariantRow[] | undefined;
  /** The brand's chart has separate women's labels (then a pair on a women's item is not checked). */
  variantWomenDiffer?: boolean | undefined;
  /** The brand `variantRows` belong to ("" = the industry table); a reply naming another brand is not checked against it. */
  variantBrand?: string | undefined;
  /**
   * Everything the PAGE said (bot and people), joined — never a SOURCE of a fact (see `shopSaid`), only
   * to know whether something was already ASKED ("đo giúp em đủ 3 thông số" once is enough).
   */
  pageSaid?: string | undefined;
  /**
   * 05/10/2026: the RUNNING orders certainly linked to the conversation (the landing's stage), for the
   * "already in your order" net. Empty / absent = the customer has no order the bot knows of.
   */
  runningOrders?: GateOrder[] | undefined;
  /** The customer's lines with their time, oldest first (who said "buy more" AFTER the order was placed). */
  customerLines?: { text: string; at: string }[] | undefined;
  /** The product code the turn is about (the focus), for "mẫu này". */
  focusCode?: string | undefined;
  /**
   * 05/10/2026: an order certainly linked to the conversation (slip tag / pinned, or found by the phone
   * the customer typed) carries a paid amount — the one data source that the customer paid.
   */
  paidEvidence?: boolean | undefined;
  /**
   * 05/10/2026: a customer photo is in play — sent this turn or in the last half-hour (the agent can
   * still look at it). Then a "this IS our item / the right colour" sentence is a guess said as a fact.
   */
  photoContext?: boolean | undefined;
  /**
   * 05/10/2026 (phiếu Desk "khách gửi ảnh rồi hỏi, bot vẫn xin ảnh"): the customer sent a photo within the
   * FRESH window (this turn's, or an earlier line of the thread / the memory) — asking for "a photo" again
   * is asking for what they just sent.
   */
  photoSent?: boolean | undefined;
  /** Codes PRINTED on the customer's photo (read as text): the code itself, not a look-alike. */
  photoCodesRead?: string[] | undefined;
  /** Codes the photo was matched to with confidence this turn (fingerprint / catalog comparison). */
  photoCodes?: string[] | undefined;
  /** Brand words of the industry's lexicon (tier 2 data): a clause naming another brand talks about another item. */
  brandWords?: string[] | undefined;
  /** A model / the router read a buying step (closing signals, ready to buy, place order). */
  buyingSignals?: boolean | undefined;
  /**
   * 05/10/2026 (phiếu Desk nhóm nhu cầu / tư vấn): regexes (accent-stripped) of the questions the consultation
   * profile says must not be asked this turn (item named, piece known, piece already asked this session).
   */
  consultNoAsk?: string[] | undefined;
}

/** A running order as the gate reads it. */
export interface GateOrder {
  maDon: string;
  giaiDoan: string;
  taoLuc: string;
  mon: { ma: string; ten: string; size: string }[];
}

/**
 * 05/10/2026 — a LANGUAGE rule, every shop: once accents are stripped the pronoun "anh" reads as
 * "ảnh" (a photo), so "cho anh hỏi…" became "xin ảnh". An occurrence typed WITHOUT its accent is the
 * pronoun, masked to `cfg.replacement`, unless the words around it are surely about a photo; one
 * right before an accented photo word is dropped ("Gửi anh ảnh với" = "Gửi ảnh với"). The word typed
 * WITH its accent ("ảnh") is never touched. Returns the raw text (accents kept), masked.
 */
export function maskPronoun(raw: string, cfg: ReplyGatePronoun): string {
  const word = cfg.word.trim();
  if (word === "") return raw;
  const text = String(raw ?? "").normalize("NFC");
  // Typed with accents anywhere: a combining mark after decomposition, or the letter d-stroke.
  const typedWithMarks = /[̀-ͯ]/.test(text.normalize("NFD")) || /[đĐ]/.test(text);
  const re = (pattern: string, flags = ""): RegExp | null => { if (pattern === "") return null; try { return new RegExp(pattern, flags); } catch { return null; } };
  const photoAfter = re(cfg.photoAfter);
  const askBefore = re(cfg.askBefore);
  const askAfter = re(cfg.askAfter);
  const sendBefore = re(cfg.sendBefore);
  const sendAfter = re(cfg.sendAfter);
  const photoNext = re(cfg.photoNext, "iu");
  const occurrence = new RegExp(`(^|[^\\p{L}])(${escapeRe(word)})(?!\\p{L})`, "giu");
  return text.replace(occurrence, (match: string, before: string, _w: string, offset: number) => {
    const start = offset + before.length;
    const end = start + word.length;
    const after = gateNormalize(text.slice(end, end + 30));
    const prev = gateNormalize(text.slice(Math.max(0, start - 20), start));
    const photo = (photoAfter?.test(after) ?? false)
      || (!typedWithMarks && (askBefore?.test(prev) ?? false) && (askAfter?.test(after) ?? false))
      || (!typedWithMarks && (sendBefore?.test(prev) ?? false) && (sendAfter?.test(after) ?? false));
    if (photo) return match;
    // The pronoun right before the accented photo word: drop it, the request reads whole again.
    if (photoNext?.test(text.slice(end)) ?? false) return before;
    return `${before}${cfg.replacement}`;
  });
}

/** What one rule did to the draft. `null` from `apply` means the rule did not fire. */
export interface RuleResult {
  reply: string;
  trace?: string[] | undefined;
  needsHuman?: boolean | undefined;
  handoffReason?: string | undefined;
}

/** One rule of the gate (Strategy). `id` is the operator-facing name of the step. */
export interface ReplyRule {
  readonly id: string;
  apply(reply: string, gate: GateContext): RuleResult | null;
}

/** Desk `gateNormalize`: lower case, no diacritics, đ → d, one space. Keeps punctuation. */
export function gateNormalize(text: unknown): string {
  return stripDiacritics(String(text ?? "")).replace(/\s+/g, " ").trim();
}

/** Desk `splitReplySentences`. */
export function splitSentences(text: string): string[] {
  return String(text ?? "").split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

/** `needle` as a whole word inside `hay` (both already normalised). */
export function wordIn(hay: string, needle: string): boolean {
  if (needle === "") return false;
  return new RegExp("(^|[^a-z0-9])" + escapeRe(needle) + "([^a-z0-9]|$)").test(hay);
}

export function capitalizeFirst(text: string): string {
  const value = String(text ?? "").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** The reply still says something (three letters in a row), so it can be sent. */
export function hasLetters(text: string): boolean {
  return /[a-zA-ZÀ-ỹ]{3,}/.test(text);
}

/**
 * Desk `gatePricesIn`: the prices written in a normalised text (1.290.000 / 1.290k / 990k), 50k..30tr.
 * One change from Desk: a comma or full stop right AFTER the amount is punctuation ("cọc 300k, còn
 * lại…"), only a separator followed by a digit is part of the number — Desk's lookahead refused both.
 */
export function pricesIn(normText: string): Set<number> {
  const out = new Set<number>();
  const re = /(?<![\d.,])(\d{1,2}[.,]\d{3}[.,]\d{3}|\d{3,4}[.,]\d{3}|\d{3,4}\s?k\b)(?!\d|[.,]\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normText))) {
    let raw = m[1]!.replace(/[.,\s]/g, "");
    if (/k$/.test(raw)) raw = raw.slice(0, -1) + "000";
    const n = Number(raw);
    if (n >= 50000 && n <= 30000000) out.add(n);
  }
  return out;
}

/** "2.790.000" for 2790000 (the way sellers write it). */
export function dotted(value: number): string {
  return String(Math.round(value)).replace(/(\d)(?=(\d{3})+$)/g, "$1.");
}

/** The host of a link without `www.`, "" when it is not a link. `site` may come without a scheme. */
export function hostOf(url: string): string {
  const value = String(url ?? "").trim();
  if (value === "") return "";
  try {
    return new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Collapses the spaces a cut leaves behind, and the space before punctuation. */
export function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

/**
 * The normalised sources of one turn, built once and read by every rule. Also carries the traces
 * of the rules that already ran (a later rule may look at them, as Desk's ETA rule skipped a
 * reply the deposit rule had already cut).
 */
export class GateContext {
  /** What a person on duty said, normalised. */
  readonly shop: string;
  /** The customer's recent lines + the current message, normalised. */
  readonly cust: string;
  /** The current message alone, normalised. */
  readonly custNow: string;
  /** The current message with a pronoun that reads like "ảnh" masked (`daiTu`), normalised: what the photo rules read. */
  readonly custNowPhoto: string;
  readonly policy: string;
  /** The shop profile's policy sentences as text (lead time, exchange, warranty, deposit rate). */
  readonly profileText: string;
  /** shop + policy + profile: what a policy claim may be sourced from. */
  readonly source: string;
  /** Codes, names, sizes and prices of what the finder returned, normalised. */
  readonly catalog: string;
  /** Every price the turn's data carries (found items, stock facts, advice candidates, the deposit). */
  readonly knownPrices: Set<number>;
  readonly vars: Record<string, string>;
  readonly trace: string[] = [];
  private readonly filler: Set<string>;

  constructor(readonly cfg: ReplyGateConfig, readonly src: GateSources) {
    this.shop = gateNormalize(src.shopSaid);
    this.cust = gateNormalize(src.customerSaid);
    const lines = String(src.customerSaid ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    this.custNow = gateNormalize(src.customerMessage ?? lines[lines.length - 1] ?? "");
    this.custNowPhoto = gateNormalize(maskPronoun(src.customerMessage ?? lines[lines.length - 1] ?? "", cfg.daiTu));
    this.policy = gateNormalize(src.policy);
    this.profileText = gateNormalize(profileSentences(src.hoSo).join(" \n "));
    this.source = `${this.shop} \n ${this.policy} \n ${this.profileText}`;
    const bits: string[] = [];
    for (const item of src.found) {
      bits.push(item.ma, item.ten, ...item.cac_size.map((s) => `${s.size} ${s.gia}`));
      if (item.link !== undefined) bits.push(item.link);
    }
    if (src.stockFacts !== null) bits.push(JSON.stringify(src.stockFacts));
    if (src.adviceCandidates !== undefined) bits.push(JSON.stringify(src.adviceCandidates));
    this.catalog = gateNormalize(bits.join(" "));
    this.knownPrices = collectPrices(src);
    const pronoun = (src.pronoun ?? "").trim() || "mình";
    this.vars = {
      khach: pronoun, Khach: capitalizeFirst(pronoun),
      shop: src.hoSo?.xungHo.shop.trim() || "em",
      site: (src.site ?? "").trim(), tenShop: (src.tenShop ?? "").trim() || "shop",
      // 25/09/2026: the caller's value first, then the shop profile's `tenNguoiPhuTrach` (tier 3), then neutral.
      tenNguoiPhuTrach: (src.tenNguoiPhuTrach ?? "").trim() || String(src.hoSo?.tenNguoiPhuTrach ?? "").trim() || "người phụ trách"
    };
    this.filler = new Set(cfg.evidence.fillerWords.map(gateNormalize));
  }

  /** Fills `{khach}` and friends plus the rule's own slots. */
  fill(text: string, extra: Record<string, string | number | undefined> = {}): string {
    return fillText(text, { ...this.vars, ...extra });
  }

  /** A pack regex, or `null` when the pattern is empty (the rule is off). */
  re(pattern: string, flags = ""): RegExp | null {
    if (pattern === "") return null;
    try { return new RegExp(pattern, flags); } catch { return null; }
  }

  test(pattern: string, text: string, flags = ""): boolean {
    const re = this.re(pattern, flags);
    return re !== null && re.test(text);
  }

  /** The bot fragment appears whole in what a person said (stock assertions: whole phrase). */
  echoedPhrase(fragment: string): boolean {
    return wordIn(this.shop, gateNormalize(fragment));
  }

  /** The fragment's distinctive words all appear in what a person said (order status: "dang cho shiper giao" ~ "shiper dang giao"). */
  echoedInShop(fragment: string): boolean {
    const tokens = gateNormalize(fragment).split(/\s+/).filter((t) => t.length >= 3 && !this.filler.has(t));
    if (tokens.length === 0) return this.echoedPhrase(fragment);
    return tokens.every((t) => wordIn(this.shop, t));
  }

  /** Product codes written in the reply, upper case, unique. */
  codesIn(text: string): string[] {
    const re = this.re(this.cfg.evidence.codePattern, "g");
    if (re === null) return [];
    return Array.from(new Set(text.toUpperCase().match(re) ?? []));
  }

  /** The hosts a link in the reply may point to: the shop's site, the always-allowed ones, the carriers, and every link the data carries. */
  allowedHosts(): Set<string> {
    const hosts = new Set<string>();
    const add = (url: string | undefined): void => { const h = hostOf(url ?? ""); if (h !== "") hosts.add(h); };
    add(this.src.site);
    this.cfg.link.allowedHosts.forEach((h) => add(h));
    this.cfg.link.carrierHosts.forEach((h) => add(h));
    this.src.found.forEach((it) => add(it.link));
    (this.src.links.lineLinks ?? []).forEach((l) => add(l.url));
    add(this.src.links.groupLink); add(this.src.links.filterLink);
    add(this.src.lookups.tracking?.url);
    (this.src.adviceCandidates ?? []).forEach((p) => add(p.link));
    return hosts;
  }

  /** The shop's product links in a text (`https://<site>/product/…`), "" pattern when no site is known. */
  productLinkRe(): RegExp | null {
    const host = hostOf(this.src.site ?? "");
    if (host === "") return null;
    return new RegExp(`https?:\\/\\/(www\\.)?${escapeRe(host)}\\/product[^\\s)]*`, "gi");
  }
}

/** The profile's policy sentences the gate may treat as a source. */
function profileSentences(hoSo: ShopProfile | null): string[] {
  if (hoSo === null) return [];
  const b = hoSo.banHang;
  const out = [b.thoiGianOrder, b.doiTraHangOrder, b.doiSizeDonDaDat, hoSo.camKetHang, hoSo.cuaHang, b.macCa.chiTiet, String(hoSo.tenNguoiPhuTrach ?? "")].filter((t) => t.trim() !== "");
  if (b.tiLeCoc !== null) out.push(`${b.tiLeCoc}%`);
  return out;
}

function collectPrices(src: GateSources): Set<number> {
  const out = new Set<number>();
  const add = (v: unknown): void => { const n = Number(v); if (Number.isFinite(n) && n > 0) out.add(n); };
  for (const item of src.found) {
    add(priceOf(item));
    inStockRows(item).forEach((row) => add(row.gia));
  }
  if (src.stockFacts !== null) { add(src.stockFacts.price); add(src.stockFacts.colorwayAlternative?.price); src.stockFacts.variantsAvailable.forEach((v) => add(v.price)); }
  (src.adviceCandidates ?? []).forEach((p) => add(p.price));
  add(src.moneyContext?.deposit);
  return out;
}
