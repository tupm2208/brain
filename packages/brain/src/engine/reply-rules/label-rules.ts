/**
 * @file A variant label the reply names must come from the stock looked up this turn (05/10/2026, phiếu Desk
 * 01/09: the warehouse returned one label and the model wrote a range of other labels it inferred).
 *
 * Tier 1: the mechanism — every label the draft names (by the industry's label pattern) is checked against the
 * labels of this turn's stock results (items found, the stock tools' own sentences) and what the customer
 * said; a sentence naming any other label is cut, a reply left empty becomes the industry's note. Tier 2:
 * `cong-soat.json` `stockLabel.label` (how the industry writes such labels; group 1 = the label's key) and
 * `stockLabel.note`. No pattern = the rule is off.
 */

import { stripDiacritics } from "../text-analysis";
import { splitPieces } from "./size-rules";
import type { GateContext, ReplyRule, RuleResult } from "./support";

/** The keys the pattern reads in a text (accent-stripped, lower case): group 1 of every match. */
function keysIn(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of stripDiacritics(String(text ?? "")).toLowerCase().matchAll(g)) if (m[1]) out.add(m[1].replace(/\s+/g, ""));
  return out;
}

export class StockLabelRule implements ReplyRule {
  readonly id = "stockLabel";
  apply(reply: string, g: GateContext): RuleResult | null {
    const re = g.re(g.cfg.stockLabel.label, "i");
    if (re === null) return null;
    if (keysIn(reply, re).size === 0) return null;
    const known = new Set<string>();
    const add = (text: string): void => { for (const k of keysIn(text, re)) known.add(k); };
    for (const item of g.src.found) for (const row of item.cac_size) add(row.size);
    add(g.src.toolText ?? "");
    add(g.src.customerSaid);
    if (g.src.stockFacts !== null) add(`${g.src.stockFacts.requestedSize} ${g.src.stockFacts.stock?.size ?? ""}`);
    const pieces = splitPieces(reply);
    const kept = pieces.filter((piece) => [...keysIn(piece, re)].every((k) => known.has(k)));
    if (kept.length === pieces.length) return null;
    const rest = kept.join("").replace(/\s{2,}/g, " ").trim();
    const note = g.fill(g.cfg.stockLabel.note);
    return { reply: rest !== "" ? rest : note !== "" ? note : reply, trace: ["stock_label_not_looked_up"] };
  }
}
