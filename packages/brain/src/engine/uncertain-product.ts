/**
 * @file The "not sure which product → ask, once" gate (Desk `uncertainProductReason` ~4256 +
 * `applyUncertainProductGate` ~4337, 25/09/2026).
 *
 * A customer asks the size / price of ONE item, or closes on it, and tier 1 cannot say which item:
 * no photo, no focus, no line named, the finder came back empty. Answering anyway means quoting a
 * guess. The gate asks back — with the RIGHT sentence:
 *   - a photo already sent (this turn or within the look-back) → ask for the name / code, never for
 *     a photo again (Duong Xuan, 08/09);
 *   - a video / voice note → "I looked but could not tell", not "I got your photo";
 *   - a brand the shop declares it does not carry → say so, it is an answer, not a question;
 *   - a carried brand with nothing in stock → "đang hết", never "chưa kinh doanh" (12/09);
 *   - a CATEGORY question about a non-primary type ("có quần dài không") anchored on a shoe → drop
 *     the anchor and give the type link, do not ask which shoe (Vu Pham, 09/09);
 *   - asked back once already and still lost → a person, not a second question (v93c).
 * Sentences come from `kich-ban.json` `hoiLai` through the caller's filler (the rule router's
 * `fillHoiLai`), so `{khach}` and `{banHang.…}` are the shop's; a sentence the shop cannot fill is
 * not sent — the agent drafts instead.
 */

import type { MatchingConfig } from "../pack/types";
import type { CatalogResolution } from "./catalog-resolver";
import type { CatalogScorer } from "./catalog-score";
import { findLine, type ProductLine } from "./dialogue-frame";
import { hoursBetween, packRegex } from "./fill-text";
import { normalize } from "./text-analysis";

export type UncertainReason =
  | "no_product" | "no_product_have_image" | "no_product_have_media"
  | "brand_not_carried" | "brand_out_of_stock"
  | "type_mismatch" | "type_mismatch_category" | "emoji_only_cold";

export interface UncertainState {
  /** The bot already asked this customer back (Desk `askedBackBefore`, or a positive `askBackCount`). */
  askedBackBefore?: boolean | undefined;
  askBackCount?: number | undefined;
  /** A customer photo within the look-back window (`hasRecentImageEvidence`). */
  hasRecentImageEvidence: boolean;
  lastPageAt?: string | undefined;
  lastCustomerAt?: string | undefined;
  episodeLastAt?: string | undefined;
}

export interface UncertainInput {
  message: string;
  intent: string;
  entities: { productCode: string; productName: string; brand: string; productType?: string | undefined };
  /** The model's analysis entities (`productName` as the model read it is trusted for the "one item" test, the local hint is noisy). */
  analysis?: { productName?: string | undefined; brand?: string | undefined; productType?: string | undefined } | undefined;
  resolution: CatalogResolution | null;
  /** This turn carries an image / a video or voice note. */
  hasImage: boolean;
  hasMedia?: boolean | undefined;
  /** Something already points at a product: the focus, the frame's product, a recognised image. */
  hasFocus: boolean;
  /** The stock cascade found an anchor or recognised a line outside the catalog. */
  cascadeFound?: boolean | undefined;
  /** The message continues the page's last question (a frame answer). */
  continuation?: boolean | undefined;
  stickerLike?: boolean | undefined;
  state: UncertainState;
  now: string;
  lexicon: { brands: readonly string[]; knownBrandsNotCarried: readonly string[]; aliases?: Readonly<Record<string, string>> | undefined };
  /** Whether the brand appears anywhere in the shop's catalog; `undefined` = unknown, so "hết" is never claimed. */
  brandInCatalog?: boolean | undefined;
  /** Brands in stock to offer instead (`{dsHang}`); the pack's brands minus the asked one when absent. */
  carriedBrands?: readonly string[] | undefined;
  /** Storefront link per product type ("quan" → …/?type=Quần áo), from the caller (the landing owns its URLs). */
  typeLinks?: Readonly<Record<string, string>> | undefined;
  /** The ask-back sentence for a `hoiLai` key, filled for this shop; `null` when absent or unfillable. */
  hoiLai: (key: string, vars: Record<string, string>) => string | null;
}

export type UncertainVerdict =
  | { action: "ask_clarification"; reason: `uncertain_product_ask_back:${UncertainReason}`; why: UncertainReason; reply: string; dropped: string[]; missingData: string[] }
  | { action: "human_handoff"; reason: `uncertain_product_twice:${UncertainReason}`; why: UncertainReason; reply: string; dropped: string[] }
  /** The category link, ready to send (Desk `type_mismatch_category_link`). */
  | { action: "script_reply"; reason: "type_mismatch_category_link"; why: "type_mismatch_category"; reply: string; productType: { type: string; label: string; link: string }; dropped: string[] }
  /** The anchor is wrong but no link is known: the agent answers the category with `LOAI_HANG`. */
  | { action: "drop_anchor"; reason: "type_mismatch_category"; why: "type_mismatch_category"; productType: { type: string; label: string; link: string }; dropped: string[] }
  /** The gate fired but the shop's profile cannot fill the sentence: the agent drafts with the reason as a hint. */
  | { action: "agent_draft"; reason: `uncertain_product_unfillable:${UncertainReason}`; why: UncertainReason; dropped: string[] };

/** Applies Desk's uncertain-product gate with one industry's patterns. */
export class UncertainProductGate {
  private readonly cfg: MatchingConfig;

  constructor(private readonly scorer: CatalogScorer, private readonly lines: readonly ProductLine[] = []) {
    this.cfg = scorer.cfg;
  }

  /** Desk `uncertainProductReason`: "" when the product is clear enough (or the question is not about one item). */
  reason(input: UncertainInput): UncertainReason | "" {
    if (input.stickerLike === true) return "";
    const u = this.cfg.uncertain;
    const intent = input.intent;
    const message = input.message;
    const selected = input.resolution?.selected ?? [];
    const askProduct = new Set(u.askProductIntents);
    const productTalk = new Set([...u.askProductIntents, ...u.productTalkIntents]);
    const nonPrimary = new Set(this.cfg.types.nonPrimaryTypes);
    const primary = new Set(this.cfg.types.primaryTypes);
    const saidName = input.analysis?.productName ?? "";

    // (a) The type the customer said (shirt / trousers…) is not the type of the anchor (a shoe).
    const requestedType = this.scorer.canonicalType(input.entities.productType ?? input.analysis?.productType ?? "");
    if (requestedType !== "" && nonPrimary.has(requestedType) && productTalk.has(intent) && input.entities.productCode === "") {
      const anchorKinds = selected.map((c) => this.scorer.typeOf(c.item));
      if (anchorKinds.some((k) => primary.has(k))) {
        const categoryQuestion = intent !== "place_order" && !this.refersToSpecificItem(message, saidName, requestedType);
        return categoryQuestion ? "type_mismatch_category" : "type_mismatch";
      }
    }

    // (b) A question about ONE item that nothing identifies.
    const askedType = requestedType !== "" ? requestedType : this.typeInMessage(message);
    const categoryTypeQuestion = askedType !== "" && nonPrimary.has(askedType) && intent !== "place_order" && !this.refersToSpecificItem(message, saidName, askedType);
    const specific = (["place_order", "ask_product_confirmation"].includes(intent) || this.refersToSpecificItem(message, saidName, askedType)) && !categoryTypeQuestion;
    const lineNamed = findLine(message, this.lines) !== null || findLine(input.entities.productName, this.lines) !== null;
    if (askProduct.has(intent) && specific && selected.length === 0 && !input.hasImage && !input.hasFocus
      && input.continuation !== true && input.cascadeFound !== true && !lineNamed) {
      const brand = this.brandKey(input.analysis?.brand || input.entities.brand);
      if (brand !== "" && this.brandNotCarried(brand, input.lexicon)) return "brand_not_carried";
      if (brand !== "" && input.brandInCatalog === false && this.brandCarried(brand, input.lexicon)) return "brand_out_of_stock";
      if (input.state.hasRecentImageEvidence) return "no_product_have_image";
      if (input.hasMedia === true) return "no_product_have_media";
      return "no_product";
    }

    // (c) A bare emoji after both sides went quiet, with no open episode.
    const bare = message.replace(/[^\p{L}\p{N}]/gu, "");
    if (message.trim() !== "" && bare === "" && !input.hasImage && input.hasMedia !== true && !input.hasFocus) {
      const cold = u.coldHours > 0 ? u.coldHours : 6;
      const gap = (at: string | undefined): number => hoursBetween(at, input.now);
      const pageCold = !(gap(input.state.lastPageAt) < cold);
      const customerCold = !(gap(input.state.lastCustomerAt) < cold);
      const episodeOpen = gap(input.state.episodeLastAt) < cold;
      if (pageCold && customerCold && !episodeOpen) return "emoji_only_cold";
    }
    return "";
  }

  /** Desk `applyUncertainProductGate`: `null` when the product is clear, else what to do and what to drop. */
  apply(input: UncertainInput): UncertainVerdict | null {
    const why = this.reason(input);
    if (why === "") return null;
    const selected = input.resolution?.selected ?? [];
    const dropped = [...new Set([selected[0]?.code, input.entities.productCode].filter((c): c is string => typeof c === "string" && c !== ""))];
    const saidName = (input.analysis?.productName ?? "").trim();

    if (why === "type_mismatch_category") {
      const askedType = this.scorer.canonicalType(input.entities.productType ?? input.analysis?.productType ?? "") || this.typeInMessage(input.message);
      const label = this.cfg.types.labels[askedType] ?? askedType;
      const link = input.typeLinks?.[askedType] ?? "";
      const productType = { type: askedType, label, link };
      const reply = link !== "" ? input.hoiLai("linkLoaiHang", { loai: label.toLowerCase(), link }) : null;
      if (reply !== null) return { action: "script_reply", reason: "type_mismatch_category_link", why, reply, productType, dropped };
      return { action: "drop_anchor", reason: "type_mismatch_category", why, productType, dropped };
    }

    const brand = (input.analysis?.brand || input.entities.brand || "").trim();
    const carried = (input.carriedBrands ?? input.lexicon.brands.filter((b) => this.brandKey(b) !== this.brandKey(brand))).slice(0, 4);
    const vars = { hang: brand, dsHang: carried.join(", "), ten: saidName };
    const reply = why === "brand_not_carried" ? input.hoiLai("hangKhongBan", vars)
      : why === "brand_out_of_stock" ? input.hoiLai("hangHetHang", vars)
      : why === "no_product_have_media" ? (input.hoiLai("daCoVideo", vars) ?? input.hoiLai("tenMau", vars))
      : (why === "no_product_have_image" || input.state.hasRecentImageEvidence)
        ? ((saidName !== "" ? input.hoiLai("daCoAnhTen", vars) : null) ?? input.hoiLai("daCoAnh", vars) ?? input.hoiLai("tenMau", vars))
        : (input.hoiLai("sanPham", vars) ?? input.hoiLai("chung", vars));
    const isAnswer = why === "brand_not_carried" || why === "brand_out_of_stock";
    const askedBefore = input.state.askedBackBefore === true || (input.state.askBackCount ?? 0) > 0;
    if (askedBefore && !isAnswer) {
      const handoff = input.hoiLai("sauHoiLai", vars) ?? "";
      return { action: "human_handoff", reason: `uncertain_product_twice:${why}`, why, reply: handoff, dropped };
    }
    if (reply === null) return { action: "agent_draft", reason: `uncertain_product_unfillable:${why}`, why, dropped };
    return { action: "ask_clarification", reason: `uncertain_product_ask_back:${why}`, why, reply, dropped, missingData: isAnswer ? [] : ["product_identity"] };
  }

  /**
   * The customer points at ONE item ("đôi này", "mẫu vừa giới thiệu", a distinctive name) rather than
   * asking generally ("giày chạy nam size 42 có không") — Desk `refersToSpecificItem`.
   */
  refersToSpecificItem(message: string, saidName: string, requestedType: string): boolean {
    const u = this.cfg.uncertain;
    const raw = message.normalize("NFC");
    const norm = normalize(message);
    if (packRegex(u.specificItem)?.test(norm) ?? false) return true;
    if ((packRegex(u.specificItemDiacritic, "iu")?.test(raw) ?? false) || (packRegex(u.specificItemNoun)?.test(norm) ?? false)) return true;
    if (requestedType !== "" && this.cfg.types.nonPrimaryTypes.includes(requestedType)) {
      const category = packRegex(u.categoryQuestion)?.test(norm) ?? false;
      const size = packRegex(u.sizeHint)?.test(norm) ?? false;
      return !(category && !size);
    }
    const said = normalize(saidName);
    if (said === "" || said.length < 4) return false;
    const generic = new Set(u.genericItemTokens.map(normalize));
    return said.split(" ").some((t) => t !== "" && !generic.has(t) && !/^\d+$/.test(t));
  }

  /** A product type named in the message ("có quần dài không" → "quan"), by the pack's aliases as whole words. */
  typeInMessage(message: string): string {
    const norm = ` ${normalize(message)} `;
    let best: { kind: string; length: number } | null = null;
    for (const [alias, kind] of Object.entries(this.cfg.types.aliases)) {
      const a = normalize(alias);
      if (a === "" || !norm.includes(` ${a} `)) continue;
      if (best === null || a.length > best.length) best = { kind, length: a.length };
    }
    return best?.kind ?? "";
  }

  private brandKey(value: string | undefined): string {
    return normalize(value ?? "").replace(/[^a-z0-9]/g, "");
  }

  private brandNotCarried(key: string, lexicon: UncertainInput["lexicon"]): boolean {
    if (key.length < 3) return false;
    const canonical = this.canonicalBrand(key, lexicon);
    return lexicon.knownBrandsNotCarried.some((b) => this.brandKey(b) === canonical);
  }

  private brandCarried(key: string, lexicon: UncertainInput["lexicon"]): boolean {
    if (key.length < 3) return false;
    const canonical = this.canonicalBrand(key, lexicon);
    return lexicon.brands.some((b) => this.brandKey(b) === canonical);
  }

  private canonicalBrand(key: string, lexicon: UncertainInput["lexicon"]): string {
    for (const [alias, target] of Object.entries(lexicon.aliases ?? {})) if (this.brandKey(alias) === key) return this.brandKey(target);
    return key;
  }
}
