/**
 * @file Reading variant axis values (size, strength, ...) from text and from warehouse labels.
 */

import type { PackAxis } from "../pack/types";
import { normalize } from "./text-analysis";

/** Extracts the axis value from a sentence, or `null` when the pattern does not match. */
export function extractAxis(axis: PackAxis, text: string): string | null {
  try {
    const m = new RegExp(axis.pattern).exec(normalize(text));
    return m?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Reduces a value to its canonical form for MATCHING. */
export function canonicalValue(axis: PackAxis, value: string): string {
  let out = normalize(value);
  for (const rule of axis.canonical) {
    try { out = out.replace(new RegExp(rule.pattern), rule.replace); } catch { /* reported by the validator */ }
  }
  return out.trim();
}

/**
 * Extracts this axis's value from a WAREHOUSE LABEL, then canonicalises it.
 *
 * Warehouse labels are often compound: "500 mg x 30 vien", "EU 42", "US 8.5 / EU 42".
 * Canonicalising the whole string would never let anchored rules (`^...$`) apply, and the bot
 * would report OUT OF STOCK for an item on the shelf: the worst bug ever seen in this system.
 */
export function labelValue(axis: PackAxis, rowLabel: string): string {
  const direct = canonicalValue(axis, rowLabel);
  const extracted = extractAxis(axis, rowLabel);
  return extracted === null ? direct : canonicalValue(axis, extracted);
}

/** Whether a warehouse label matches the value the customer asked for. */
export function labelMatches(axis: PackAxis, requested: string, rowLabel: string): boolean {
  const req = canonicalValue(axis, requested);
  if (req === "") return false;
  if (labelValue(axis, rowLabel) === req) return true;
  // NO prefix matching: "42 2/3" starts with "42 " and size 42 would look in stock while the shelf
  // only has the one-third system. `labelValue` already extracted the right value.
  return canonicalValue(axis, rowLabel) === req;
}
