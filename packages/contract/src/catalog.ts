/**
 * @file The catalog: the reduced view of merchant data the brain on Xeon is allowed to hold.
 *
 * DECISION 3 of the specification: the merchant keeps the source of truth, Xeon keeps only the
 * catalog. The catalog is what is already public on the storefront: name, code, brand,
 * attributes, selling price. NEVER stored: phone numbers, addresses, purchase history, cost price.
 *
 * The guard below started life as a deny-list of field names (regexes over keys). Review on
 * 09/09 broke it in both directions:
 *   - Leaks: `attributes.note = "Chi Lan 0968411655, 12 Hoai Duc"` passed untouched, because the
 *     guard only read KEYS and never VALUES, and `attributes` is exactly the free-form field that
 *     dirty data flows into.
 *   - False positives: `/tel\b/` blocked `hotel`; `/ward/` blocked `awards` and `rewardPoints`;
 *     `province` blocked both the warehouse province and product origin. A multi-industry
 *     platform that blocks like that gets its guard loosened, and a loosened guard is dead.
 *
 * This version is an ALLOW-LIST BY SHAPE: the catalog has a fixed set of fields and unknown keys
 * are rejected instead of guessed at, plus a scan of VALUES for phone numbers and e-mails that
 * sneak into free-text fields.
 */

import type { ItemId, TenantId, VariantId, WarehouseId } from "./ids";
import type { Money } from "./money";

export interface CatalogVariant {
  id: VariantId;
  /** Label shown to customers: "42", "500mg x 30 vien", "60 phut". The industry pack decides how to read it. */
  label: string;
  /** SELLING price. Never the cost price. */
  price: Money;
  /** Natural sort order (size 41 before 42) so the bot lists variants sensibly. */
  sort: number;
}

export interface CatalogItem {
  /** The brain serves many merchants, so every catalog row must know whose it is. */
  tenant: TenantId;
  id: ItemId;
  /** The product code the merchant uses day to day. */
  code: string;
  name: string;
  brand?: string | undefined;
  category?: string | undefined;
  /** Name of the variant axis for this industry: "size", "ham luong", "thoi luong", ... */
  variantAxis: string;
  variants: CatalogVariant[];
  /**
   * Free attributes defined by the industry pack: colour, gender, active ingredient, ...
   * Keys are free but VALUES are scanned; see `findCatalogIssues`.
   */
  attributes: Record<string, string>;
  images: string[];
  /** Storefront URL so the bot can send a link to the exact item. */
  url?: string | undefined;
  /** ISO timestamp of the last update; the loader uses it for incremental sync. */
  updatedAt: string;
}

/** Compact form used in search results; the bot never needs the image set. */
export interface CatalogItemLite {
  id: ItemId;
  code: string;
  name: string;
  brand?: string | undefined;
  priceFrom: Money;
  variantCount: number;
  url?: string | undefined;
}

/**
 * One real stock row, fetched live from the merchant server on every turn.
 * Never stored on Xeon, and it carries no `tenant` because the call already travels on one
 * merchant's link; a second copy of that fact would only create room for the two to disagree.
 */
export interface StockRow {
  itemId: ItemId;
  variantId: VariantId;
  variantLabel: string;
  warehouseId: WarehouseId;
  warehouseName: string;
  qty: number;
  price: Money;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const ITEM_KEYS = new Set<string>([
  "tenant", "id", "code", "name", "brand", "category",
  "variantAxis", "variants", "attributes", "images", "url", "updatedAt"
]);
const VARIANT_KEYS = new Set<string>(["id", "label", "price", "sort"]);

/** A Vietnamese phone number inside free text. */
const VN_PHONE_RE = /(?:\+?84|0)(?:\d[ .-]?){8,10}\d/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** A long run of digits: bank card, national id, personal tracking number, ... */
const LONG_DIGITS_RE = /\d{11,}/;

export type CatalogIssueKind =
  | "not_object"
  | "unknown_key"
  | "wrong_type"
  | "phone_in_value"
  | "email_in_value"
  | "long_digits_in_value";

export interface CatalogCleanIssue {
  kind: CatalogIssueKind;
  path: string;
  /** Explanation for operators. Carries no actual value so that logs never contain personal data. */
  hint: string;
}

function scanText(text: string, path: string, out: CatalogCleanIssue[]): void {
  if (VN_PHONE_RE.test(text)) {
    out.push({ kind: "phone_in_value", path, hint: "Value looks like a phone number." });
  } else if (EMAIL_RE.test(text)) {
    out.push({ kind: "email_in_value", path, hint: "Value looks like an e-mail address." });
  } else if (LONG_DIGITS_RE.test(text)) {
    out.push({ kind: "long_digits_in_value", path, hint: "Unusually long digit run (card, national id?)." });
  }
}

function checkVariant(value: unknown, path: string, out: CatalogCleanIssue[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    out.push({ kind: "not_object", path, hint: "A variant must be an object." });
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!VARIANT_KEYS.has(key)) {
      out.push({ kind: "unknown_key", path: `${path}.${key}`, hint: "A variant may only have id, label, price, sort." });
      continue;
    }
    if (typeof val === "string") scanText(val, `${path}.${key}`, out);
  }
}

/** Scans one item (or an array of items). An empty result means clean. */
export function findCatalogIssues(value: unknown, path = "$"): CatalogCleanIssue[] {
  const out: CatalogCleanIssue[] = [];

  if (Array.isArray(value)) {
    value.forEach((child, i) => out.push(...findCatalogIssues(child, `${path}[${i}]`)));
    return out;
  }
  if (value === null || typeof value !== "object") {
    out.push({
      kind: "not_object",
      path,
      hint: "The catalog must be an object or an array of objects. A JSON string is not considered clean."
    });
    return out;
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${key}`;
    if (!ITEM_KEYS.has(key)) {
      out.push({
        kind: "unknown_key",
        path: at,
        hint: "Unknown catalog field. Add it to CatalogItem first if it is really needed."
      });
      continue;
    }
    if (key === "variants") {
      if (!Array.isArray(val)) {
        out.push({ kind: "wrong_type", path: at, hint: "variants must be an array." });
      } else {
        val.forEach((child, i) => checkVariant(child, `${at}[${i}]`, out));
      }
      continue;
    }
    if (key === "attributes") {
      if (val === null || typeof val !== "object" || Array.isArray(val)) {
        out.push({ kind: "wrong_type", path: at, hint: "attributes must be a string-to-string object." });
        continue;
      }
      // Keys are free (the industry pack names them) but VALUES are scanned: that is where leaks hide.
      for (const [attrKey, attrValue] of Object.entries(val as Record<string, unknown>)) {
        if (typeof attrValue === "string") scanText(attrValue, `${at}.${attrKey}`, out);
        else if (typeof attrValue !== "number" && typeof attrValue !== "boolean") {
          out.push({ kind: "wrong_type", path: `${at}.${attrKey}`, hint: "An attribute may only be a string, number or boolean." });
        }
      }
      continue;
    }
    if (key === "images") {
      if (!Array.isArray(val)) {
        out.push({ kind: "wrong_type", path: at, hint: "images must be an array of strings." });
      } else {
        val.forEach((child, i) => { if (typeof child === "string") scanText(child, `${at}[${i}]`, out); });
      }
      continue;
    }
    if (typeof val === "string") scanText(val, at, out);
  }

  return out;
}

/** Throws when the catalog is not clean. The loader MUST call this before pushing to Xeon. */
export function assertCatalogClean(value: unknown): void {
  const issues = findCatalogIssues(value);
  if (issues.length > 0) {
    const where = issues.slice(0, 8).map((i) => `${i.path} (${i.kind})`).join(", ");
    throw new Error(
      `Catalog sent to Xeon is not clean (${issues.length} issue(s)): ${where}. ` +
        `See DECISION 3 (QUYET DINH 3) in the specification: Xeon must not hold customer data or cost prices.`
    );
  }
}
