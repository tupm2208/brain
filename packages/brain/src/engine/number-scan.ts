/**
 * @file Reading numbers out of a Vietnamese sentence.
 *
 * Used by the gates to make sure every number the bot says can be traced back to a tool result.
 */

import { normalize, soft } from "./text-analysis";

const SCALE: Record<string, number> = {
  k: 1_000, nghin: 1_000, ngan: 1_000,
  tr: 1_000_000, trieu: 1_000_000,
  ty: 1_000_000_000
};

/**
 * STRUCTURED tokens: times, dates, percentages. They must be compared AS A WHOLE, not split into
 * loose numbers, otherwise "14h30" becomes 14 and 30 and every appointment sentence is blocked.
 * A service industry could not use the bot at all.
 *
 * A time must be written joined ("14h30", "9h") with no letter attached after it, otherwise
 * "12 hop" reads as 12 o'clock and an ordinary stock sentence is blocked.
 */
const STRUCTURED_RE = /\d{1,2}h\d{0,2}(?![\p{L}0-9])|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d+\s*%/gu;

/**
 * "2tr5" = 2,500,000 and "3tr190" = 3,190,000: the most common way to text a price.
 * The part after the unit is the FRACTION, read by digit count: "2tr5" is 2.5 million, "3tr190"
 * is 3.190 million, "2tr50" is 2.50 million. An earlier version took a single digit, so "3tr190"
 * became 3,000,000 and 190, both wrong.
 */
const COMPOUND_MONEY_RE = /(\d+)\s*(tr|trieu|ty)\s*(\d{1,3})(?![\d])/g;

export interface NumberScan {
  numbers: number[];
  /** Structured tokens, kept in normalised form. */
  structured: string[];
}

/**
 * Currency signs glued to a number: `3.190.000đ`, `25.000₫`, `500k VND`.
 *
 * They must be removed BEFORE diacritics are stripped, and that is a real trap: `normalize`
 * turns `đ` into `d`, which is a letter, and a letter right after a number makes the scanner back
 * off one notch looking for a boundary, so `"gia 3.190.000đ"` was read as **3190**. That number
 * has no source, the bot was blocked by its own gate, and the customer got nothing.
 */
const CURRENCY_RE = /(?<=\d)\s*(?:₫|đ|Đ|vn[đĐdD])(?![\p{L}])|(?<=\d)[dD](?![\p{L}])/gu;

/** Extracts all numbers and structured tokens from a sentence. */
export function scanNumbers(text: string): NumberScan {
  let n = normalize(String(text ?? "").replace(CURRENCY_RE, " "));
  const structured: string[] = [];
  const numbers: number[] = [];

  n = n.replace(STRUCTURED_RE, (m) => {
    structured.push(m.replace(/\s+/g, ""));
    return " ";
  });

  n = n.replace(COMPOUND_MONEY_RE, (_m, a: string, unit: string, b: string) => {
    const scale = SCALE[unit] ?? 1;
    numbers.push(Number(a) * scale + Number(b) * (scale / 10 ** b.length));
    return " ";
  });

  // `(?![a-z])` after the unit is mandatory: without it "con 3 kieu" reads as 3000 (the "k" of
  // "kieu" taken as thousands) and the real number vanishes from the gate.
  for (const m of n.matchAll(/(\d[\d.,]*)\s*(k|nghin|ngan|tr|trieu|ty)?(?![a-z])/g)) {
    const raw = (m[1] ?? "").replace(/[.,](?=\d{3}(\D|$))/g, "");
    const base = Number(raw.replace(/,/g, "."));
    if (!Number.isFinite(base)) continue;
    const unit = m[2];
    numbers.push(unit === undefined ? base : base * (SCALE[unit] ?? 1));
  }
  return { numbers, structured };
}

/** Convenience: only the numeric part of `scanNumbers`. */
export function numbersIn(text: string): number[] {
  return scanNumbers(text).numbers;
}

/**
 * Quantities written in WORDS next to a classifier: "con ba doi", "vai hop".
 *
 * Checked on the DIACRITIC form. Without diacritics "sau" (after) and "sáu" (six) collapse into
 * one word, and perfectly normal sentences like "quay lai sau buoi dau tien" would be blocked;
 * one blocked sentence is a lost conversation.
 */
const WORD_NUMBERS = [
  "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín", "mười",
  "vài", "chục", "dăm"
];
const CLASSIFIERS = [
  "đôi", "cái", "chiếc", "hộp", "viên", "gói", "chai", "bộ", "chỗ", "suất", "buổi",
  "ngày", "tuần", "tháng", "giờ", "phút", "lần", "sản phẩm", "mẫu"
];

export function wordQuantityClaims(text: string): string[] {
  const n = soft(text);
  const out: string[] = [];
  for (const w of WORD_NUMBERS) {
    for (const c of CLASSIFIERS) {
      if (new RegExp(`(^|[^\\p{L}])${w}\\s+${c}([^\\p{L}]|$)`, "u").test(n)) out.push(`${w} ${c}`);
    }
  }
  return out;
}
