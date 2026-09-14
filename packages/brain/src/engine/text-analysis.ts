/**
 * @file Text helpers specific to the brain.
 *
 * The core normalisation functions moved to the CONTRACT (`@sp/contract`) because all three
 * parts must normalise IDENTICALLY: the merchant server stores normalised names for search and
 * the brain normalises customer text to match against them. One character of drift and a
 * warehouse label never meets a customer sentence.
 *
 * What stays here is KNOWLEDGE about how Vietnamese people text, not pure normalisation.
 */

export {
  normalize, soft, stripDiacritics, squash, tokens, tight,
  escapeRe, hasWord, overlap, coverage, mentionsBrand
} from "@sp/contract";

import { normalize, tokens } from "@sp/contract";

/**
 * Words too common to point at any item on their own.
 *
 * NOTE: this is Vietnamese retail knowledge sitting inside the engine. By the principle "every
 * difference lives in the pack" it should be declared by the industry pack. It has not moved
 * because both existing packs use exactly the same list; when a third industry needs a different
 * list, move it into the pack.
 */
const STOPWORDS = new Set([
  "shop", "em", "minh", "ban", "co", "khong", "ko", "cho", "cua", "nay", "do", "oi",
  "con", "gia", "bao", "nhieu", "size", "loai", "mau", "the", "nao", "voi", "duoc",
  "hoi", "xin", "vay", "nhe", "nha", "hom", "toi", "anh", "chi", "bac"
]);

/**
 * Words that could be an item name: long enough, not generic, not a stopword.
 *
 * `filler` are the FILLER words the INDUSTRY PACK declares ("thi", "sao", "roi", ...): in
 * "size 43 thi sao", treating "thi"/"sao" as specific words would wipe the focus item. The pack
 * must own that list rather than the engine: "cam", "vang", "day", "moi" are fillers here but
 * PART OF AN ITEM NAME elsewhere (orange juice, wine, necklace, lipstick). `specificTokens` is
 * the ONLY door to the catalog, so a word swallowed here is an item that can never be sold.
 */
export function specificTokens(text: string, generic: string[], filler: readonly string[] = []): string[] {
  // Multi-word generic terms ("san pham", "do the thao") must be SPLIT: the filter compares single
  // tokens, so "san pham nay con khong" with "san pham" listed as a phrase would still leak "san"
  // and "pham" as two specific words, and the focus would be wiped.
  const blocked = new Set([...generic, ...filler].flatMap((x) => [normalize(x), ...tokens(normalize(x))]));
  return tokens(text).filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !blocked.has(t));
}
