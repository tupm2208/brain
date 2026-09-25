/**
 * @file Reading warehouse size labels against what the customer asked (Desk `normalizeSize`,
 * `apparelSizeKey`, `sameSize`, `nearestSizeStock`, `stockIsWeak` — 25/09/2026).
 *
 * Every rule here is one real mismatch: "A/L" is "L" (adidas apparel prefix, 26/08); "XXL" and
 * "2XL" are one size (v68, 02/09); 42.5 and 42 2/3 are one step (adidas has no half sizes); two
 * steps equally far (42 2/3 vs 43 1/3 for 43) pick the step UP — a tight shoe is worse than a loose
 * one (05/09); a bare "88" is a waist, never a shoe (13/09). The numbers live in the pack
 * (`MatchingConfig.sizes`); this class only knows how to compare.
 */

import type { SizeReading } from "../pack/types";
import { packRegex } from "./fill-text";
import { sizeToNumber } from "./entities";

/** A stock row as the finder returns it: the label, the price and (when the landing says) the real quantity. */
export interface SizeRow {
  size: string;
  gia?: number | undefined;
  so_luong?: number | undefined;
  loai?: string | undefined;
  dk?: string | undefined;
  kho?: string | undefined;
}

/** What the customer's size resolved to: the warehouse label, the quantity when known, and whether it is a neighbouring step. */
export interface SizeStock {
  size: string;
  qty: number | undefined;
  /** The label differs from the size asked (a 1/3 step away): say so to the customer, never close on it silently. */
  approximate: boolean;
  row: SizeRow;
}

/** Compares size labels with the industry's reading rules. */
export class SizeMatcher {
  private readonly prefix: RegExp | null;
  private readonly letter: RegExp | null;

  constructor(private readonly cfg: SizeReading) {
    this.prefix = packRegex(cfg.apparelPrefix, "i");
    this.letter = packRegex(cfg.letterSize, "i");
  }

  /** "A/88" → "88", "A/XL" → "XL", "XXL" → "2XL", "42,5" → "42.5" (Desk `normalizeSize` + `apparelSizeKey`). */
  key(label: string): string {
    let raw = String(label ?? "").trim().toUpperCase();
    if (this.prefix !== null) raw = raw.replace(this.prefix, "");
    raw = raw.replace(/\s+/g, "").replace(/^(X{2,5})([SL])$/, (_m, xs: string, l: string) => `${xs.length}X${l}`);
    if (this.isLetter(raw)) return raw;
    return raw.replace(",", ".");
  }

  isLetter(label: string): boolean {
    return this.letter !== null && this.letter.test(String(label ?? "").trim().toUpperCase().replace(/^A\//, ""));
  }

  /** Number of a label, NaN for letters; "44 2/3" → 44.667. A bare number at or above `apparelMin` is not a shoe size. */
  toNumber(label: string): number {
    // The key has no spaces ("442/3"): `sizeToNumber` reads the two-digit size greedily, then the third.
    return sizeToNumber(this.key(label));
  }

  /** The two labels name one size: same key, or numbers closer than the tolerance (Desk `sameSize` + `sizeMatches`). */
  same(a: string, b: string): boolean {
    const ka = this.key(a);
    const kb = this.key(b);
    if (ka === kb) return true;
    const na = this.toNumber(a);
    const nb = this.toNumber(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    return Math.abs(na - nb) <= this.tolerance();
  }

  /** Rows whose label is the requested size (numbers within tolerance; apparel keys as text). */
  matches<T extends SizeRow>(rows: readonly T[], requested: string): T[] {
    const target = this.toNumber(requested);
    const apparel = !Number.isFinite(target) || (this.cfg.apparelMin > 0 && target >= this.cfg.apparelMin);
    if (apparel) {
      const key = this.key(requested);
      return key === "" ? [] : rows.filter((row) => this.key(row.size) === key);
    }
    const numeric = rows.filter((row) => {
      const value = this.toNumber(row.size);
      return Number.isFinite(value) && Math.abs(value - target) <= this.tolerance();
    });
    return numeric;
  }

  /**
   * The in-stock row closest to the requested size: the exact label first; otherwise the nearest
   * step within the tolerance, ties going UP, flagged `approximate` (Desk `nearestSizeStock`).
   */
  nearest<T extends SizeRow>(rows: readonly T[], requested: string): (SizeStock & { row: T }) | null {
    const list = rows.filter((row) => row.so_luong === undefined || row.so_luong > 0);
    if (list.length === 0 || String(requested ?? "").trim() === "") return null;
    const wanted = this.key(requested);
    const exact = list.find((row) => this.key(row.size) === wanted);
    if (exact !== undefined) return { size: exact.size, qty: exact.so_luong, approximate: false, row: exact };
    const target = this.toNumber(requested);
    if (!Number.isFinite(target)) return null;
    if (this.cfg.apparelMin > 0 && target >= this.cfg.apparelMin) return null;
    let best: { row: T; distance: number; value: number } | null = null;
    for (const row of list) {
      const value = this.toNumber(row.size);
      if (!Number.isFinite(value)) continue;
      const distance = Math.abs(value - target);
      if (distance > this.tolerance()) continue;
      if (distance < 1e-9) return { size: row.size, qty: row.so_luong, approximate: false, row };
      const better = best === null || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) < 1e-9 && value > best.value);
      if (better) best = { row, distance, value };
    }
    return best === null ? null : { size: best.row.size, qty: best.row.so_luong, approximate: true, row: best.row };
  }

  /** No stock, or only a step DOWN from what was asked: keep looking for a colourway with a better step. */
  isWeak(stock: SizeStock | null, requested: string): boolean {
    if (stock === null) return true;
    if (!stock.approximate) return false;
    const target = this.toNumber(requested);
    const value = this.toNumber(stock.size);
    return Number.isFinite(target) && Number.isFinite(value) && value < target;
  }

  private tolerance(): number {
    return this.cfg.tolerance > 0 ? this.cfg.tolerance : 0.01;
  }
}
