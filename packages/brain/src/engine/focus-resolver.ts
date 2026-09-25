/**
 * @file Which product this turn is ABOUT when the message does not say (Desk `productFromLedger`
 * ~296, `dropStaleFocusOnImageTurn` ~286, the `contextProduct` chain ~496 — 25/09/2026).
 *
 * The trust order, each step a real conversation:
 *   1. the card a PERSON just sent / the message the customer replied to wins over everything;
 *   2. on a turn with a photo nobody recognised, a focus inherited from OUTSIDE the session is
 *      dropped — Desk's tab inferred it from any page message ever, and "còn size 40.5 không" under a
 *      new photo was answered for a 60k headband from three days before (Pham Thanh, v46 / v97);
 *   3. a proven catalog match of what the customer typed;
 *   4. the focus the caller carried over (only when the session still names it, see 2);
 *   5. the model's focus claim — accepted only when it names something in the pool, and a claim
 *      that merely DENIES the focus changes nothing (the AI once dropped JQ0764 while the customer
 *      was still asking about it, Do Quan 24/08);
 *   6. the episode's main item, then the newest ledger entry touched within the episode gap that is
 *      not already ordered.
 * Pure: takes the stored state and the clock as text.
 */

import type { CatalogResolution } from "./catalog-resolver";
import { EPISODE_GAP_HOURS } from "./conversation-state";
import type { Episode } from "./episode";
import { hoursBetween, toMillis } from "./fill-text";
import type { Ledger, ProductRef } from "./ledger";
import { normalize } from "./text-analysis";

export type FocusSource = "page_sent" | "catalog" | "customer_focus" | "ai" | "episode" | "ledger" | "none";

export interface FocusInput {
  now: string;
  episode?: Episode | null | undefined;
  ledger?: Ledger | undefined;
  /** The card the person on duty sent, or the product of the message the customer replied to. Wins. */
  pageSentProduct?: ProductRef | null | undefined;
  /** The focus the caller carried from the previous turn (Desk `input.focusedProduct`). */
  focusedProduct?: ProductRef | null | undefined;
  /** The model's claim about the focus this turn. */
  analysisFocus?: { product: string; changed: boolean } | null | undefined;
  resolution?: CatalogResolution | null | undefined;
  hasImage: boolean;
  /** The image pipeline named a product for this turn's photo (matched or OCR'd). */
  imageRecognised: boolean;
  /** Texts of the current SESSION (customer and page), oldest first: what "this session names" means. */
  sessionTexts?: readonly string[] | undefined;
  /** When the current session started (ISO); an episode last touched before it is not "this session". */
  sessionStartAt?: string | undefined;
  /** Products the model's free text may refer to, beyond the ledger's. */
  pool?: readonly ProductRef[] | undefined;
  gapHours?: number | undefined;
}

export interface FocusResolution {
  product: ProductRef | null;
  source: FocusSource;
  /** Why an inherited focus was dropped ("stale_focus_image_turn", "episode_before_session"). */
  dropped?: string | undefined;
}

function hasIdentity(p: ProductRef | null | undefined): p is ProductRef {
  return p !== null && p !== undefined && ((p.code ?? "") !== "" || (p.name ?? "") !== "");
}

/** A name that identifies something: at least 4 characters and not the code itself (Desk `hasUsableProductName`). */
function usableName(p: { code?: string | undefined; name?: string | undefined }): boolean {
  const name = (p.name ?? "").trim();
  if (name.length < 4) return false;
  return normalize(name) !== normalize(p.code ?? "");
}

/** Resolves the product in focus for one turn. Stateless. */
export class FocusResolver {
  resolve(input: FocusInput): FocusResolution {
    const gap = input.gapHours ?? EPISODE_GAP_HOURS;
    const dropped: string[] = [];

    // 1) A person's card / the replied-to product.
    if (hasIdentity(input.pageSentProduct) && (input.pageSentProduct.code ?? "") !== "") {
      return { product: input.pageSentProduct, source: "page_sent" };
    }

    // 2) An unrecognised photo: only what THIS session names is still "đôi này".
    const unrecognisedImage = input.hasImage && !input.imageRecognised;
    let focused = hasIdentity(input.focusedProduct) ? input.focusedProduct : null;
    let episode = input.episode ?? null;
    if (unrecognisedImage) {
      const session = normalize((input.sessionTexts ?? []).join(" "));
      if (focused !== null && (focused.code ?? "") !== "" && !session.includes(normalize(focused.code))) { focused = null; dropped.push("stale_focus_image_turn"); }
      const start = toMillis(input.sessionStartAt);
      const last = toMillis(episode?.lastAt);
      if (episode !== null && Number.isFinite(start) && Number.isFinite(last) && last < start) { episode = null; dropped.push("episode_before_session"); }
    }

    // 3) A proven match of what the customer typed.
    const resolution = input.resolution ?? null;
    if (resolution !== null && resolution.status === "single_match" && !resolution.needVerify) {
      const c = resolution.selected[0];
      if (c !== undefined) return { product: { code: c.code, name: c.name, brand: c.brand, price: c.price }, source: "catalog", ...(dropped.length > 0 ? { dropped: dropped.join(",") } : {}) };
    }

    // 4) The focus carried over, still named by the session.
    if (focused !== null) return { product: focused, source: "customer_focus", ...(dropped.length > 0 ? { dropped: dropped.join(",") } : {}) };

    // 5) The model's claim, only when it names something in the pool. A denial changes nothing.
    const ledgerProducts = input.ledger?.products ?? [];
    const claim = input.analysisFocus;
    if (claim && claim.changed && claim.product.trim() !== "") {
      const pool: ProductRef[] = [
        ...(input.pool ?? []),
        ...ledgerProducts.map((p) => ({ code: p.code, name: p.name, brand: p.brand })),
        ...(resolution?.selected ?? []).map((c) => ({ code: c.code, name: c.name, brand: c.brand, price: c.price }))
      ];
      const n = normalize(claim.product);
      const hit = pool.find((p) => (p.code ?? "") !== "" && n.includes(normalize(p.code)))
        ?? pool.find((p) => (p.name ?? "") !== "" && (n.includes(normalize(p.name)) || normalize(p.name).includes(n)));
      if (hit !== undefined) return { product: hit, source: "ai", ...(dropped.length > 0 ? { dropped: dropped.join(",") } : {}) };
    }

    // 6) Desk `productFromLedger`: the episode's main item, then the newest ledger entry within the gap.
    const fromLedger = this.productFromLedger(episode, ledgerProducts, input.now, gap);
    if (fromLedger !== null) return { ...fromLedger, ...(dropped.length > 0 ? { dropped: dropped.join(",") } : {}) };
    return { product: null, source: "none", ...(dropped.length > 0 ? { dropped: dropped.join(",") } : {}) };
  }

  /** The episode's focus (when the episode is not cold), else the newest ledger product touched within the gap that is not ordered. */
  productFromLedger(episode: Episode | null, ledgerProducts: readonly Ledger["products"][number][], now: string, gapHours: number = EPISODE_GAP_HOURS): FocusResolution | null {
    const focus = episode?.focus ?? null;
    if (focus !== null && focus.code !== "" && !(hoursBetween(episode?.lastAt, now) >= gapHours)) {
      const hit = ledgerProducts.find((p) => normalize(p.code) === normalize(focus.code));
      const product: ProductRef = hit !== undefined && usableName(hit) ? { code: hit.code, name: hit.name, brand: hit.brand } : { code: focus.code, name: focus.name, brand: focus.brand };
      if (usableName(product) || hit === undefined) return { product, source: "episode" };
    }
    const anchor = toMillis(now);
    const cutoff = Number.isFinite(anchor) ? anchor - gapHours * 3600_000 : NaN;
    for (let i = ledgerProducts.length - 1; i >= 0; i -= 1) {
      const entry = ledgerProducts[i];
      if (entry === undefined || entry.code === "" || entry.status === "da_dat") continue;
      const touched = toMillis(entry.lastAt || entry.firstAt);
      if (Number.isFinite(touched) && Number.isFinite(cutoff) && touched < cutoff) continue;
      if (!usableName(entry)) continue;
      return { product: { code: entry.code, name: entry.name, brand: entry.brand }, source: "ledger" };
    }
    return null;
  }
}
