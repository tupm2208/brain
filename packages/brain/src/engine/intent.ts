/**
 * @file Intent detection and alias expansion, driven entirely by the industry pack.
 */

import type { IndustryPack, PackIntent } from "../pack/types";
import { hasWord, normalize } from "./text-analysis";

/** Normalises the text and expands the pack's aliases (common misspellings). */
export function applyAliases(pack: IndustryPack, text: string): string {
  let out = normalize(text);
  for (const [wrong, right] of Object.entries(pack.lexicon.aliases)) {
    const w = normalize(wrong);
    if (w === "" || w === normalize(right)) continue;
    out = out.split(w).join(normalize(right));
  }
  return out;
}

/**
 * Scores every intent of the pack against the sentence and returns the best one, or `null`.
 * Keywords score 2, patterns 3, negative keywords subtract 3. Ties keep the first declared intent.
 */
export function detectIntent(pack: IndustryPack, text: string): PackIntent | null {
  const n = applyAliases(pack, text);
  let best: { intent: PackIntent; score: number } | null = null;
  for (const intent of pack.intents) {
    let score = 0;
    for (const kw of intent.keywords) if (hasWord(n, kw)) score += 2;
    for (const p of intent.patterns ?? []) {
      try { if (new RegExp(p).test(n)) score += 3; } catch { /* PackValidator already reported it */ }
    }
    for (const kw of intent.negativeKeywords ?? []) if (hasWord(n, kw)) score -= 3;
    if (score > 0 && (best === null || score > best.score)) best = { intent, score };
  }
  return best?.intent ?? null;
}

/** Object-oriented wrapper for callers that prefer an instance bound to one pack. */
export class IntentDetector {
  constructor(private readonly pack: IndustryPack) {}

  normalizeWithAliases(text: string): string {
    return applyAliases(this.pack, text);
  }

  detect(text: string): PackIntent | null {
    return detectIntent(this.pack, text);
  }

  byId(id: string | undefined): PackIntent | null {
    if (id === undefined) return null;
    return this.pack.intents.find((i) => i.id === id) ?? null;
  }

  /**
   * The intent the rule router's verdict maps to: a pack intent with that exact id, or one that
   * lists it under `routerIntents`. `null` when the pack has no intent for it ("greeting",
   * "small_talk", "unknown"...), and the engine scores keywords as before.
   */
  byHint(hint: string | undefined): PackIntent | null {
    if (hint === undefined || hint === "") return null;
    return this.pack.intents.find((i) => i.id === hint || (i.routerIntents ?? []).includes(hint)) ?? null;
  }
}
