/**
 * @file Bare numbers that denote a VARIANT ("size 42", "loai 650"), as opposed to quantities,
 * units, money, time or addresses.
 *
 * Two layers, and the second is an ALLOW-LIST:
 *   1. The word after the number must not be a quantity/unit/money/time word ("42 doi", "50 kg",
 *      "42.000d", "43 hom", "40 do").
 *   2. The word before the number MUST be a variant cue ("size 42", "loai 650", "con 650",
 *      "het 650", "em di 42"), or the number must open the message ("42 thi sao").
 *
 * Why an allow-list: the previous review round used a deny-list ("not after nang/cao/coc/...") and
 * it was never complete: "thu 5 em qua lay", "em o quan 3", "nha em o toa 43", "troi 40 do" all
 * slipped through, and the bot answered stock for the 5ml / 3ml / 43 / 40 variants of questions
 * that were not about variants at all. An allow-list fails towards "ask back"; a deny-list fails
 * towards "say something wrong".
 */

import type { IndustryPack, PackAxis } from "../pack/types";
import { labelValue } from "./axis";
import { normalize, tokens } from "./text-analysis";

/** Words after a number that mark it as a quantity, unit, money, time or degree. */
const NOT_AFTER_NUMBER =
  /^\s*(?:doi|cai|chiec|hop|vien|goi|chai|tuyp|lo|thung|bo|vi|ong|don|be|tep|bich|cap|tui|set|hu|kg|gr|gam|cm|km|nghin|ngan|tr|trieu|ty|vnd|tuoi|nam|thang|ngay|hom|bua|buoi|tuan|gio|phut|lan|nguoi|ng|do|k|g|m|d|%)(?![\p{L}])/u;

/** STRONG cues: a number right after one of these is almost certainly a variant. */
const STRONG_CUES = new Set([
  "size", "loai", "kieu", "mau", "dong", "het", "chon", "di", "mang", "chan",
  "ham", "luong", "quy", "cach", "kich", "thuoc"
]);

/**
 * WEAK cues: once diacritics are stripped they are HOMONYMS of ordinary words ("co" = have / is
 * there, "la" = kind / is, "con" = still / child). "em CO 2 be nho", "em CON 2 don chua nhan",
 * "cai nay LA 5 phai khong" are everyday sentences. With these the number must END the sentence
 * or be followed by punctuation or a question word ("con 650 KHONG", "can 650 NHE") to count.
 */
const WEAK_CUES = new Set(["co", "con", "la", "nay", "em", "anh", "chi", "minh"]);

/**
 * ORDERING VERBS. Their object is almost always a QUANTITY ("minh lay 2 nhe", "cho em 2", "em
 * mua 2 duoc khong", "em can 2 thoi"), while the object of "co/con/het" is a VARIANT. An earlier
 * round merged the two groups, and the most common closing line at a pharmacy counter, "minh lay
 * 2 nhe", was answered with the stock of the 2ml bottle. An ordering verb shortly BEFORE the
 * number vetoes every weak cue; that number is a quantity.
 */
const ORDERING_VERB = /(?:^|[^\p{L}])(?:lay|mua|can|cho|xin|dat|order|goi)(?:[^\p{L}]|$)/u;

/** List conjunctions: a number after one inherits the cue of the previous number ("650 hay 700"). */
const LIST_CONJUNCTIONS = new Set(["hay", "hoac", "va", "voi"]);

/**
 * After the number: punctuation or an INTERROGATIVE. NO affirmative particles (nhe, nha, thoi,
 * luon, a, di): "2 nhe", "2 thoi", "2 luon" belong to an ORDER, not a question; including them
 * turns "paracetamol 2 nhe shop" into "Con 4 hop 2ml".
 */
const QUESTION_TAIL =
  /^\s*(?:$|[?.!,;)]|con\b|khong\b|ko\b|k\b|thi\b|het\b|nua\b|duoc\b|dc\b|chua\b|hay\b|hoac\b|va\b|voi\b|nhi\b|ha\b|hong\b)/u;

/** An ordering verb only vetoes when it is at most this many tokens before the number. */
const ORDERING_WINDOW = 3;

/**
 * A number OPENING the message while the bot is not waiting for anything: it only counts as a
 * variant when followed by a STOCK question ("650 con khong", "42 het chua", "42 thi sao").
 * "2 duoc khong shop" or "2 nhe" with nothing pending is a quantity; asking back beats guessing.
 */
const STOCK_QUESTION_TAIL = /^\s*(?:con\b|khong\b|ko\b|het\b|chua\b|thi\b|nua\b)/u;

/** Per-turn hints that refine what counts as a variant number. */
export interface VariantNumberHints {
  /**
   * Words of the NAME/CODE of the item being discussed. "paracetamol 650", "boston 43": the item
   * name right before a number is the most common form in both industries, and "item just
   * mentioned + a number" is the strongest evidence that the number is a variant. Still must pass
   * the question tail check.
   */
  extraCues?: ReadonlySet<string> | undefined;
  /**
   * Numbers that are PART OF THE ITEM NAME the customer typed in THIS sentence ("13" in "adizero
   * boston 13 nhe", "500" in "co vitamin c 500 khong"). Otherwise "13" becomes a bare number
   * matching no label, the gate un-pins the size 42 just given, and the customer who answered with
   * the exact item name is asked for the size again, then handed off.
   * ONLY when the item name was typed this turn: "500 con khong shop" (no name) is an answer about
   * strength, not a name.
   */
  itemNameNumbers?: ReadonlySet<string> | undefined;
  /** The bot JUST asked for this axis: a number opening the message is the answer, any particle allowed. */
  answeringAskedAxis?: boolean | undefined;
}

/** Finds bare variant numbers in a sentence and guesses axis values from them. */
export class VariantNumberScanner {
  private readonly strongCues: Set<string>;

  constructor(private readonly pack: IndustryPack) {
    // The pack's axis ids and labels are strong cues too ("size", "ham luong").
    this.strongCues = new Set(STRONG_CUES);
    for (const axis of pack.itemShape.axes) {
      this.strongCues.add(normalize(axis.id));
      for (const t of tokens(normalize(axis.label))) this.strongCues.add(t);
    }
  }

  /** Bare numbers in the sentence that denote a variant, in order of appearance. */
  bareNumbers(text: string, hints: VariantNumberHints = {}): number[] {
    const extraCues = hints.extraCues ?? new Set<string>();
    const itemNameNumbers = hints.itemNameNumbers ?? new Set<string>();
    const answering = hints.answeringAskedAxis === true;
    const found: number[] = [];
    // `,` and `.` are only a DECIMAL when followed by a digit: "650, gio 700" has two numbers, not one.
    for (const m of text.matchAll(/(?<!\d|\d[.,])(\d+(?:[.,]\d+)?)(?!\d|[.,]\d)/g)) {
      const index = m.index ?? 0;
      if (itemNameNumbers.has(m[1] ?? "")) continue;
      const before = text.slice(0, index).replace(/[\s:,.\-]+$/u, "");
      const after = text.slice(index + m[0].length);
      if (NOT_AFTER_NUMBER.test(after)) continue;
      const wordBefore = /(\p{L}+)$/u.exec(before)?.[1];
      const opensMessage = before === "";
      // "650 HAY 700", "42 HOAC 43": a number after a list conjunction inherits the cue of the
      // previous number. Without this, "loai 650 hay 700 con khong" yields ONE bare number (700 is
      // dropped because "hay" is not a cue), the engine guesses 650 and answers half the question.
      const continuesList = wordBefore !== undefined && LIST_CONJUNCTIONS.has(wordBefore) && found.length > 0;
      // The ordering veto only within the NEAR window: "minh lay 2" (distance 1) and "cho em 2"
      // (distance 2) veto; "cho em hoi paracetamol con 650 khong" (distance 4) does not, because
      // "cho em hoi" and "xin hoi" are the most common openers in the inbox and scanning the whole
      // sentence would ask back unfairly.
      const near = tokens(before).slice(-ORDERING_WINDOW).join(" ");
      const ordering = ORDERING_VERB.test(near);
      const isQuestion = QUESTION_TAIL.test(after);
      const accepted = continuesList
        || (opensMessage && (answering || STOCK_QUESTION_TAIL.test(after)))
        || (wordBefore !== undefined && this.strongCues.has(wordBefore))
        || (wordBefore !== undefined && extraCues.has(wordBefore) && !ordering && isQuestion)
        || (wordBefore !== undefined && WEAK_CUES.has(wordBefore) && !ordering && isQuestion);
      if (!accepted) continue;
      found.push(Number((m[1] ?? "").replace(",", ".")));
    }
    return found;
  }

  /**
   * Guesses an axis value from ONE bare number, checked against REAL warehouse labels.
   *
   * "loai 650 con khong": the strength pattern requires a unit (650mg), so the bare "650" is not
   * extracted and the bot would ask for the drug name while it just answered about that drug. But
   * the shelf only has 500mg and 650mg: "650" can only mean 650mg.
   *
   * Three latches, all NARROWING:
   *   - the sentence has EXACTLY one bare number (see `bareNumbers`); two are ambiguous;
   *   - the number matches EXACTLY one label; two or none means no guess;
   *   - the guess lives only in this turn and is never stored (see the caller).
   * Asking back beats a wrong guess.
   */
  guessAxisValue(
    axis: PackAxis, rows: readonly { variantLabel: string }[], text: string, hints: VariantNumberHints
  ): string | null {
    const numbers = this.bareNumbers(text, hints);
    if (numbers.length !== 1) return null;
    const matches = new Set<string>();
    for (const row of rows) {
      const value = labelValue(axis, row.variantLabel);
      const leading = /^\d+(?:[.,]\d+)?/.exec(value)?.[0];
      if (leading === undefined) continue;
      if (Number(leading.replace(",", ".")) === numbers[0]) matches.add(value);
    }
    return matches.size === 1 ? ([...matches][0] ?? null) : null;
  }

  get industryPack(): IndustryPack {
    return this.pack;
  }
}
