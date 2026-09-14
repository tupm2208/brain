/**
 * @file Industry pack: the replaceable part of the platform.
 *
 * The engine knows NOTHING about shoes, medicine or spas. All industry knowledge lives in a
 * profile of this shape. Selling to a new industry means writing a new pack, never touching
 * the engine.
 *
 * Version 2 (after the 09/09 review) opened four hard-coded places, because the first draft
 * required code changes for any industry not shaped like running shoes, which punctured the
 * sales promise:
 *   - ONE variant axis      -> many axes (a spa needs duration + time slot)
 *   - fixed placeholders    -> the pack declares extra placeholders
 *   - fixed gate rules      -> `forbidden_patterns` lets an industry declare its own rule
 *   - fixed slot names      -> the pack names slots after its axes
 */

import type { ToolName } from "@sp/contract";

// ----------------------------------------------------------------- 1. Identity
export interface PackIdentity {
  /** How the shop addresses the customer: "bac", "anh chi", "quy khach". */
  customerPronoun: string;
  /** How the shop refers to itself: "em", "shop", "ben minh". */
  selfPronoun: string;
  /** A few sentences describing the tone, fed to the model when rephrasing is enabled. */
  tone: string[];
  /** Phrases that must never be said. The `forbidden_phrases` gate reads this list. */
  neverSay: string[];
}

// ----------------------------------------------------------------- 2. Lexicon
export interface PackLexicon {
  /** Brands the shop carries. */
  brands: string[];
  /** Real brands the shop does NOT carry, so the bot can say so instead of asking around. */
  knownBrandsNotCarried: string[];
  /** Categories: "giay chay", "ao gio", ... A category question does not require a specific item. */
  categories: string[];
  /** Common misspellings -> canonical form. Keys are normalised (no diacritics, joined). */
  aliases: Record<string, string>;
  /** Generic words that alone do not identify an item. */
  genericTerms: string[];
  /**
   * FILLER words of follow-up questions: "size 43 THI SAO", "con loai khac nua khong". Never part
   * of an item name IN THIS INDUSTRY. The pack must declare them, because the same word can be an
   * item name elsewhere ("cam", "vang", "day", "moi"): hard-coding them in the engine would make
   * those items unsellable.
   */
  fillerWords?: string[];
}

// ------------------------------------------------------- 3. Item shape
export interface PackAxisCanonical {
  /** Regex run on the normalised label. */
  pattern: string;
  /** Replacement, `$1` refers to a group. */
  replace: string;
}

/**
 * One variant axis. Retail has one axis (size); services usually two (duration + time slot);
 * a pharmacy has two as well (strength + packaging).
 */
export interface PackAxis {
  /** Slot code, also used as slot name in `requiredSlots` and as placeholder in templates. */
  id: string;
  /** Human label: "size", "ham luong", "thoi luong". */
  label: string;
  /** Captures the value from what the customer typed, on NORMALISED text. Group 1 is the value. */
  pattern: string;
  /**
   * Reduces to a canonical form for MATCHING against warehouse labels.
   * "41 ruoi" -> "41.5": the customer and the warehouse spell differently and must still meet.
   * This is where the worst bug lived: a missed match was reported as "out of stock".
   */
  canonical: PackAxisCanonical[];
  /** Examples so the pack author can self-check. The engine runs them at load time. */
  examples: { text: string; expect: string | null }[];
  /** Whether stock can be answered without knowing this axis. */
  requiredForStock: boolean;
}

export interface PackItemShape {
  /** At least one axis. The first is the main axis (used for the default ask-back). */
  axes: PackAxis[];
}

// ------------------------------------------------------------- 4. Intents
/** Slot name. Two are built into the engine; the rest are named by the pack after its axes. */
export type SlotName = "item" | "phone" | (string & {});

export interface PackIntent {
  id: string;
  name: string;
  /** Keywords (no diacritics); each hit scores. */
  keywords: string[];
  /** Extra regexes on normalised text. Score higher than keywords. */
  patterns?: string[];
  /** Keywords that SUBTRACT score, to separate two intents that overlap. */
  negativeKeywords?: string[];
  /** Missing any of these means NO affirmative answer; the bot must ask back. */
  requiredSlots: SlotName[];
  /** Tools to call. Must be in `allowedTools`. */
  tools: ToolName[];
  /** Template when the answer is available. */
  template: string;
  /** Template when a slot is missing. */
  askBackTemplate: string;
  /** Self-check examples: each must resolve to this intent. */
  examples?: string[];
  /**
   * This intent ALWAYS hands off to a human; the bot never answers it itself.
   * A pharmacy uses it for dosage questions; a clinic for medical questions.
   */
  handoff?: boolean;
}

// --------------------------------------------------------------- 6. Gates
export type GateRule =
  /** No policy claim without a `policy.get` result. */
  | { kind: "require_source_for_claims"; topics: string[]; patterns?: string[] }
  /** No stock answer before the item is identified. */
  | { kind: "require_item_before_stock" }
  /** After asking back once within the window, the second time must hand off. */
  | { kind: "ask_back_once"; windowMinutes: number; maxTimes?: number }
  /** Every number in the reply must come from a tool result. */
  | { kind: "no_unsourced_numbers" }
  /** "We do not carry brand X" is only allowed when the catalog is large enough. */
  | { kind: "brand_not_carried_needs_catalog"; minItems: number }
  /** A sentence containing a forbidden phrase is not sent. */
  | { kind: "forbidden_phrases" }
  /**
   * Industry-specific rule as regexes. A pharmacy blocks dosage advice; a clinic blocks
   * promised treatment outcomes.
   */
  | { kind: "forbidden_patterns"; patterns: string[]; reason: string }
  /** No factual claims while the merchant server is offline. */
  | { kind: "no_facts_when_offline" };

// ---------------------------------------------------------------- 7. Templates
/** Templates every pack must define. Packs may add their own beyond this list. */
export const REQUIRED_TEMPLATES = [
  "greeting", "ask_item", "ask_slot", "handoff",
  "offline", "brand_not_carried", "out_of_stock", "in_stock"
] as const;
export type TemplateKey = (typeof REQUIRED_TEMPLATES)[number];

export interface IndustryPack {
  id: string;
  name: string;
  identity: PackIdentity;
  lexicon: PackLexicon;
  itemShape: PackItemShape;
  intents: PackIntent[];
  /**
   * Default intent when the customer ONLY names an item without asking anything specific.
   *
   * The first thing real customers type is "shop oi co Adizero Boston 13 khong": no keyword of
   * any intent, yet everyone understands it as a stock question. Without this field the bot only
   * greets, and the following "42" falls into the void. The pack declares it, because "what
   * naming an item means" is industry knowledge (at a pharmacy it is also a stock question; at a
   * service business it may be a booking).
   */
  intentWhenItemNamed?: string;
  /** Tools this pack may call. Intersected with the licence to get the real list. */
  allowedTools: ToolName[];
  gates: GateRule[];
  /**
   * Pack-specific placeholders WITH their static values.
   * Earlier only NAMES could be declared with no way to fill them, so using one turned every
   * reply into a handoff: a trap, and the validator's message pointed straight into it.
   */
  extraValues?: Record<string, string>;
  templates: Record<string, string>;
}
