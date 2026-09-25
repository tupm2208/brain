/**
 * @file Which product the customer means, from the finder's results (Desk `retrieveCatalog`'s
 * verdict part, 25/09/2026): one match, several, or none — and whether the one match is PROVEN
 * (code / strong name / OCR code / image auto-match) or merely the best guess.
 *
 * `needVerify` is the flag the level-2 agent reads: a guess is answered with "mẫu X phải không ạ?"
 * before a price, a proof is answered outright. Pure: the caller ran `catalog.find` (in the order
 * `planStockCascade` gave) and hands the items in.
 */

import { CatalogScorer, emptyCatalogQuery, type CatalogCandidate, type CatalogQuery, type FoundItem } from "./catalog-score";
import type { LedgerProduct, ProductRef } from "./ledger";
import { normalize } from "./text-analysis";

export type CatalogStatus = "single_match" | "multiple_matches" | "not_found";

/** Evidence stronger than the text: the customer's photo was matched, or the code was read off a label. */
export type StrongEvidence = "ocr_code_exact" | "image_auto_match";

export interface CatalogResolution {
  status: CatalogStatus;
  selected: CatalogCandidate[];
  /** More than one (or none): the reply must ask which, not quote. */
  needsClarification: boolean;
  /** One candidate, but no strong reason (code / name_strong / OCR / image): confirm before quoting. */
  needVerify: boolean;
  /** Why: "code" / "name_strong" / "focus_code" / "guess" / "empty_query" / "no_items". */
  reason: string;
  /** The version the scorer looked for ("13"), "" when none. */
  requestedVersion: string;
  /** The query actually scored (the focus code may have been substituted). */
  query: CatalogQuery;
}

export interface ResolveInput {
  entities?: Partial<CatalogQuery> | undefined;
  query?: CatalogQuery | undefined;
  /** The items every `catalog.find` step returned, in cascade order. */
  found: readonly FoundItem[];
  /** The product in focus (page card / ledger): its code stands in when the message names nothing. */
  focused?: ProductRef | null | undefined;
  /** The ledger's products: a name the customer repeats is matched by code through them. */
  ledgerProducts?: readonly LedgerProduct[] | undefined;
  strongEvidence?: StrongEvidence | undefined;
}

const STRONG_REASONS = new Set(["code", "name_strong", "name_exact"]);

/** Turns the finder's items into a verdict with one industry's scorer. */
export class CatalogResolver {
  constructor(private readonly scorer: CatalogScorer) {}

  resolve(input: ResolveInput): CatalogResolution {
    let query = input.query ?? emptyCatalogQuery(input.entities ?? {});
    let reason = "";
    const empty = query.productCode === "" && query.productName === "" && query.productLine === "";
    if (empty) {
      const focus = input.focused;
      const ledgerHit = this.fromLedger(query, input.ledgerProducts ?? []);
      if (focus && (focus.code ?? "") !== "") { query = { ...query, productCode: focus.code ?? "" }; reason = "focus_code"; }
      else if (ledgerHit !== null) { query = { ...query, productCode: ledgerHit.code }; reason = "ledger_code"; }
      else return { status: "not_found", selected: [], needsClarification: true, needVerify: false, reason: "empty_query", requestedVersion: "", query };
    }
    if (input.found.length === 0) {
      return { status: "not_found", selected: [], needsClarification: true, needVerify: false, reason: reason || "no_items", requestedVersion: this.scorer.requestedVersion(query, []), query };
    }
    const selected = this.scorer.retrieve(input.found, query);
    const requestedVersion = this.scorer.requestedVersion(query, input.found);
    const strong = selected.filter((c) => c.reasons.some((r) => STRONG_REASONS.has(r)));
    const single = selected.length === 1 || strong.length === 1;
    const status: CatalogStatus = single ? "single_match" : selected.length > 0 ? "multiple_matches" : "not_found";
    const picked = strong.length === 1 ? strong : selected;
    const needVerify = status === "single_match" && strong.length === 0 && input.strongEvidence === undefined;
    if (reason === "") reason = strong.length === 1 ? (strong[0]?.reasons.includes("code") ? "code" : "name_strong") : input.strongEvidence ?? (status === "single_match" ? "guess" : status);
    return { status, selected: status === "single_match" ? picked.slice(0, 1) : selected, needsClarification: status !== "single_match", needVerify, reason, requestedVersion, query };
  }

  /** A ledger product whose name the (empty) query's size-less message repeats — not used when the query names anything. */
  private fromLedger(query: CatalogQuery, ledger: readonly LedgerProduct[]): LedgerProduct | null {
    const hint = normalize(query.productName);
    if (hint === "") return null;
    return ledger.find((p) => p.code !== "" && normalize(p.name) !== "" && hint.includes(normalize(p.name))) ?? null;
  }
}
