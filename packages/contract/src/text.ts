/**
 * @file Vietnamese text normalisation, shared by every part of the platform.
 *
 * Why this lives in the contract instead of inside the brain: the merchant server stores a
 * normalised copy of product names for searching, and the brain normalises what customers
 * type in order to match against it. If the two sides normalised differently by even one
 * character, a warehouse label would never meet a customer sentence, and the bot would
 * report "out of stock" while the shelf is full.
 *
 * A real lesson from the TopRun message archive: about 0.6% of stored messages were in NFD
 * form (base letters and combining marks stored separately). The old normaliser handled only
 * one of the two forms, so 1,224 real messages such as "doi nay con 42 ko" slipped past intent
 * detection unnoticed.
 */

/**
 * Strips diacritics, lower-cases, collapses whitespace. Use for MATCHING, never for display.
 *
 * Commas are kept on purpose: "3,19 trieu" split into "3" and "19 trieu" would make the
 * number scanner read a completely different amount and block a correct sentence.
 */
export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s.,/+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lower-cases but KEEPS diacritics. Used by the gates that inspect the bot's own sentences.
 *
 * This must exist next to `normalize`: once diacritics are stripped, "đôi" (the counter word
 * for a pair of shoes) and "đổi" (to exchange) become the same string. An ordinary sales
 * sentence like "còn 7 đôi size 42" would then be read as an exchange promise and blocked.
 */
export function soft(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Removes ONLY diacritics; every other character (including regex metacharacters) is kept.
 * Used to compare a diacritic-aware regex pattern against text typed without diacritics.
 */
export function stripDiacritics(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC").normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Flattens to letters and digits only, keeping diacritics. Used to match forbidden phrases
 * even when punctuation is inserted between the words: "rẻ nhất - thị trường" must still hit.
 */
export function squash(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Splits into normalised words, dropping single-character tokens. */
export function tokens(value: unknown): string[] {
  return normalize(value).split(" ").filter((t) => t.length > 1);
}

/** Removes all whitespace, dots and dashes so that "NewBalance" matches "new balance". */
export function tight(value: unknown): string {
  return normalize(value).replace(/[\s.-]/g, "");
}

/** Escapes a string for literal use inside a `RegExp`. */
export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `haystack` contains `word` as a whole word (normalised on both sides). */
export function hasWord(haystack: string, word: string): boolean {
  const h = normalize(haystack);
  const w = normalize(word);
  if (w === "") return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`).test(h);
}

/** Token overlap between two strings in 0..1, divided by the longer side. */
export function overlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = tokens(b);
  if (left.size === 0 || right.length === 0) return 0;
  let hit = 0;
  for (const t of right) if (left.has(t)) hit += 1;
  return hit / Math.max(left.size, right.length);
}

/**
 * How much of a PRODUCT NAME the customer's sentence covers, in 0..1.
 *
 * Unlike `overlap` this does not divide by the length of the query. `overlap` punishes
 * talkative customers: "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi" would
 * score lower than "boston 13 con 42 khong" although both name exactly one product.
 */
export function coverage(query: string, target: string): number {
  const q = new Set(tokens(query));
  const t = tokens(target);
  if (q.size === 0 || t.length === 0) return 0;
  let hit = 0;
  for (const w of t) if (q.has(w)) hit += 1;
  return hit / t.length;
}

/**
 * Whether the text mentions a brand.
 *
 * Word boundaries are required rather than substring search: the brand "On" is two letters,
 * and a substring test would flag "con hang khong" as mentioning it. Brands of five letters or
 * more are additionally matched with whitespace removed ("newbalance").
 */
export function mentionsBrand(text: string, brand: string): boolean {
  const b = normalize(brand);
  if (b === "") return false;
  if (hasWord(text, b)) return true;
  if (b.replace(/\s/g, "").length >= 5) return tight(text).includes(tight(b));
  return false;
}
