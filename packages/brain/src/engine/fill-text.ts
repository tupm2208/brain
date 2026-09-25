/**
 * @file Small text helpers shared by the ledger, the episode tracker, the dialogue frame and the
 * system note: filling `{placeholders}` in sentences that come from JSON, and the two time
 * formats Sales Desk prints in prompts.
 *
 * They live in one place because the four modules must format identically: the prompt is read
 * by a model, and "luc 24/09 15:30" in one block and "24/09/2026 15:30:00" in another would read
 * as two different events.
 */

/** Replaces every `{key}` with `vars[key]`; a missing key becomes an empty string, never "{key}". */
export function fillText(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{([A-Za-z0-9_.]+)\}/g, (_m, key: string) => {
    const value = vars[key];
    return value === undefined ? "" : String(value);
  });
}

/** "24/09 15:30" (local time, like Desk's `shortTime`); "" when the ISO string is not a date. */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(date.getDate())}/${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Milliseconds of an ISO string, or NaN. */
export function toMillis(iso: string | undefined): number {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : NaN;
}

/** Hours between two ISO strings (absolute), or NaN when either is not a date. */
export function hoursBetween(a: string | undefined, b: string | undefined): number {
  const x = toMillis(a);
  const y = toMillis(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(y - x) / 3600_000 : NaN;
}

/**
 * A gap for humans: "35 phút", "7 giờ", "3 ngày". The three unit words come from the pack's
 * texts (`minutes`, `hours`, `days`) so the sentence is data like the rest of the prompt.
 */
export function humanGap(hours: number, texts: Record<string, string>): string {
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return fillText(texts["minutes"] ?? "{n} phut", { n: Math.round(hours * 60) });
  if (hours < 48) return fillText(texts["hours"] ?? "{n} gio", { n: Math.round(hours) });
  return fillText(texts["days"] ?? "{n} ngay", { n: Math.round(hours / 24) });
}

/** "3.190.000đ" for a positive number, "" otherwise (Desk's `formatPrice`). */
export function formatPrice(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return number.toLocaleString("vi-VN") + "đ";
}

/** Builds a `RegExp` from a pack pattern, or `null` when the pattern is empty. */
export function packRegex(pattern: string, flags = ""): RegExp | null {
  return pattern === "" ? null : new RegExp(pattern, flags);
}

/** Whether any of the pack patterns matches `text`. Empty lists never match. */
export function anyMatch(patterns: readonly string[], text: string, flags = ""): boolean {
  return patterns.some((p) => p !== "" && new RegExp(p, flags).test(text));
}
