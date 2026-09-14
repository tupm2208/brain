/**
 * @file Customer personal data (PII): what may be stored where.
 *
 * DECISION 3: the merchant keeps the source data, Xeon keeps only the catalog.
 * `assertCatalogClean` guards the catalog; the functions here guard FREE TEXT (messages and
 * replies) before it is written down on Xeon.
 *
 * Three lessons from the 09/09 review:
 *
 * 1. Accept FREE TEXT ONLY. The first version accepted arbitrary objects, so a 16-digit Messenger
 *    conversation id, an EAN-13 product code and a numeric tenant id were all mistaken for
 *    personal data and every turn of those conversations died. The signature now takes strings
 *    only, turning a wrong call into a compile error instead of a runtime one.
 *
 * 2. REDACT and DETECT must be two DIFFERENT patterns. With a single shared regex, anything the
 *    redactor missed the detector missed identically, so the safety latch could never trip.
 *
 * 3. The surest protection is not better masking but NOT STORING. The brain never re-reads the
 *    customer's message text, so customer turns are stored with empty text. Addresses and
 *    recipient names, which no pattern can recognise reliably, therefore have nowhere to leak.
 */

export const REDACTED = "[da che]";

/**
 * REDACTION pattern: generous, accepting some over-masking in free text.
 * Any separator style is caught: `.` `_` `,` `-` `|` `*` `x` spaces, brackets.
 * NOT `/`: dates are the biggest source of false positives ("hen 01/09/2026 - 3.190.000" would be
 * read as a phone number and the bot would send a mangled sentence); phone numbers written with
 * slashes are very rare.
 * `(?!\d)` at the end: without it a 13-digit lot number is cut in half
 * ("ma lo 0234567890123" -> "ma lo [da che]3").
 * `(?<![\p{L}\d])` is mandatory: without it the `[oO]` branch eats the trailing "o" of the word
 * before ("zalo 0968..." -> "zal[da che]"), and the "0" in "40, 41" starts a fake phone number.
 *
 * The NETWORK PREFIX right after the leading 0 is mandatory too, and that was an expensive lesson:
 * without it the pattern also ate BANK ACCOUNT NUMBERS. Vietcombank `0011 0012 3456` and
 * Sacombank `0600...` are a zero followed by digits, and the bot told customers to transfer to
 * "Vietcombank [da che]", so the merchant could not get paid.
 *
 * The prefix list covers: mobile since 2018 (`03 05 07 08 09`), OLD mobile before 2018
 * (`012 016 018 019`) because carriers renumbered SUBSCRIBERS, not the merchant's historical
 * records, which are full of old prefixes, and landlines (`02x`).
 *
 * What prevents over-masking here: `policy.get` and other tools returning text the merchant wrote
 * about itself do NOT pass through the scanner (see the merchant-authored tool set on the server).
 * The distinction is made where the gate is placed, not in the pattern, because a merchant's bank
 * account and a customer's phone look identical when the merchant banks with MB Bank or TPBank.
 */
const REDACT_PHONE_RE =
  /(?<![\p{L}\d])(?:\+?84|00?84|[0oO])[\s._,|*x()\-]{0,3}(?:3|5|7|8|9|1[2689]|2)(?:[\s._,|*x()\-]{0,3}\d){7,10}(?!\d)/gu;

/**
 * DETECTION pattern: stricter, flagging only what really looks like a phone number so that
 * reports are not drowned in false alarms. It is not required to agree with the redactor.
 */
const DETECT_PHONE_RE =
  /(?<![\p{L}\d])(?:\+?84|0)[\s._,|*x()\-]{0,3}(?:3|5|7|8|9|1[2689]|2)(?:[\s._,|*x()\-]{0,3}\d){7,9}(?![\d])/u;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Redacts personal data in ONE piece of free text.
 *
 * Only what has a recognisable shape is redacted: phone numbers and e-mails. Addresses and
 * personal names have no reliable pattern, so they are handled by not storing them at all.
 *
 * Long digit runs are deliberately left alone: EAN-13 codes, order ids and the merchant's own
 * bank account are all legitimate digit strings, and masking them corrupts real data.
 */
export function redactPII(text: string): string {
  return String(text ?? "")
    .replace(new RegExp(EMAIL_RE.source, "gi"), REDACTED)
    .replace(REDACT_PHONE_RE, REDACTED);
}

export interface PIIFinding {
  index: number;
  kind: "phone" | "email";
}

/** Detects personal data in ONE piece of free text. */
export function findPIIInText(text: string): PIIFinding[] {
  const s = String(text ?? "");
  const out: PIIFinding[] = [];
  const email = new RegExp(EMAIL_RE.source, "i").exec(s);
  if (email !== null) out.push({ index: email.index, kind: "email" });
  const phone = new RegExp(DETECT_PHONE_RE.source, "u").exec(s);
  if (phone !== null) out.push({ index: phone.index, kind: "phone" });
  return out;
}

/**
 * Throws when the FREE TEXT about to be stored still contains personal data.
 *
 * Pass free text only; never conversation ids, product codes or tenant ids.
 * The signature accepts `string[]` so that a wrong call fails at compile time.
 */
export function assertNoStoredPII(texts: readonly string[]): void {
  const bad: string[] = [];
  texts.forEach((t, i) => {
    for (const finding of findPIIInText(t)) bad.push(`[${i}] ${finding.kind}`);
  });
  if (bad.length > 0) {
    throw new Error(
      `Text about to be stored still contains personal data (${bad.length} place(s)): ${bad.slice(0, 6).join(", ")}. ` +
        `See DECISION 3 (QUYET DINH 3): Xeon must not store customer phone numbers or e-mails.`
    );
  }
}
