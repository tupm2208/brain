/**
 * @file THE PRICE TABLE — the ONE place token prices live (Đ7, decided with the roadmap 17/09/2026).
 *
 * Every shop's Token AI screen converts tokens to đồng with this table; a copy on each landing would
 * drift the first time a provider changes a price. Defaults are Sales Desk's list prices
 * (`ai_usage_kit.js`, checked 15/09/2026, USD per million tokens); `bang-gia-ai.json` in the data
 * directory replaces the WHOLE table when it exists (Desk's `replaceAll`: a row deleted on the
 * screen means that model has no price any more, not "back to the default").
 *
 * Each ledger row stores the unit price it was charged at, so changing the table only affects calls
 * made after the change.
 */

import fs from "node:fs";
import path from "node:path";

export interface PriceRow {
  key: string;
  input: number;
  output: number;
  cacheRead?: number | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  from?: string | undefined;
  until?: string | undefined;
}

export interface Pricing {
  rateVndPerUsd: number;
  checkedAt?: string | undefined;
  models: PriceRow[];
}

export const PRICING_FILE = "bang-gia-ai.json";

export const DEFAULT_PRICING: Pricing = {
  rateVndPerUsd: 26120,
  checkedAt: "2026-09-15",
  models: [
    { key: "gemini-3.7-flash", input: 0.75, output: 3.75, cacheRead: 0.075, until: "2026-12-31" },
    { key: "gemini-3.7-flash", input: 1.5, output: 7.5, cacheRead: 0.15, from: "2027-01-01" },
    { key: "gemini-3.8-flash", input: 0.75, output: 3.75, cacheRead: 0.075, until: "2026-12-31" },
    { key: "gemini-3.8-flash", input: 1.5, output: 7.5, cacheRead: 0.15, from: "2027-01-01" },
    { key: "gemini-3.5-flash-lite", input: 0.3, output: 2.5, cacheRead: 0.03 },
    { key: "claude-sonnet-4-6", input: 3, output: 15, cacheRead: 0.3 },
    { key: "claude-sonnet-5", input: 2, output: 10, cacheRead: 0.2 },
    { key: "claude-opus-4-6", input: 5, output: 25, cacheRead: 0.5 },
    { key: "claude-opus-4-7", input: 5, output: 25, cacheRead: 0.5 },
    { key: "claude-opus-4-8", input: 5, output: 25, cacheRead: 0.5 },
    { key: "claude-opus-5", input: 5, output: 25, cacheRead: 0.5 }
  ]
};

/** Offset of Vietnam time: a day boundary (and a price change on 01/01) must not move with the server's zone. */
export const VN_OFFSET_MINUTES = 420;

export function localDay(value: Date | number | string): string {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + VN_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

/** `ag/gemini-3.7-flash-low` → `gemini-3.7-flash`: gateway prefix and thinking level are not a different price. */
export function normalizeModelKey(model: string): string {
  let key = String(model ?? "").trim().toLowerCase();
  key = key.replace(/^models\//, "").replace(/^[a-z0-9]{1,6}\//, "");
  key = key.replace(/-thinking$/, "").replace(/-\d{8}$/, "");
  if (key.startsWith("gemini-")) key = key.replace(/-(minimal|low|medium|high)$/, "");
  return key;
}

export interface UnitPrice {
  key: string;
  input: number;
  output: number;
  cacheRead: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a table typed on a screen; returns the clean table or the first problem. */
export function cleanPricing(raw: unknown): { ok: true; pricing: Pricing } | { ok: false; viSao: string } {
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rate = Number(o["rateVndPerUsd"]);
  if (!Number.isFinite(rate) || rate < 1000 || rate > 1_000_000) return { ok: false, viSao: "Tỉ giá phải từ 1.000 đến 1.000.000 đồng / USD." };
  const list = Array.isArray(o["models"]) ? o["models"] : [];
  if (list.length > 200) return { ok: false, viSao: "Bảng giá tối đa 200 dòng." };
  const models: PriceRow[] = [];
  for (const [i, item] of list.entries()) {
    const r = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const key = normalizeModelKey(String(r["key"] ?? ""));
    const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
    if (key === "" && blank(r["input"]) && blank(r["output"])) continue;
    if (key === "" || key.length > 80) return { ok: false, viSao: `Dòng ${i + 1}: thiếu tên model.` };
    const input = Number(r["input"]);
    const output = Number(r["output"]);
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) return { ok: false, viSao: `Dòng ${i + 1} (${key}): giá vào/ra phải là số không âm.` };
    const row: PriceRow = { key, input, output };
    if (!blank(r["cacheRead"])) {
      const cache = Number(r["cacheRead"]);
      if (!Number.isFinite(cache) || cache < 0) return { ok: false, viSao: `Dòng ${i + 1} (${key}): giá đọc cache phải là số không âm.` };
      row.cacheRead = cache;
    }
    for (const edge of ["from", "until"] as const) {
      const value = String(r[edge] ?? "").trim();
      if (value === "") continue;
      if (!DAY_RE.test(value)) return { ok: false, viSao: `Dòng ${i + 1} (${key}): ngày phải dạng 2027-01-01.` };
      row[edge] = value;
    }
    models.push(row);
  }
  return { ok: true, pricing: { rateVndPerUsd: Math.round(rate), checkedAt: new Date().toISOString().slice(0, 10), models } };
}

export class PriceTable {
  private cache: { pricing: Pricing; source: "default" | "file" } | null = null;

  /** @param directory the data directory; `null` keeps the table in memory only (tests). */
  constructor(private readonly directory: string | null) {}

  read(): { pricing: Pricing; source: "default" | "file" } {
    if (this.cache !== null) return this.cache;
    let result: { pricing: Pricing; source: "default" | "file" } = { pricing: DEFAULT_PRICING, source: "default" };
    if (this.directory !== null) {
      try {
        const cleaned = cleanPricing(JSON.parse(fs.readFileSync(path.join(this.directory, PRICING_FILE), "utf8")));
        if (cleaned.ok) result = { pricing: cleaned.pricing, source: "file" };
      } catch { /* no file = defaults */ }
    }
    this.cache = result;
    return result;
  }

  /** Replaces the whole table (atomic write). */
  save(pricing: Pricing): void {
    if (this.directory !== null) {
      fs.mkdirSync(this.directory, { recursive: true });
      const file = path.join(this.directory, PRICING_FILE);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(pricing, null, 2), "utf8");
      fs.renameSync(tmp, file);
    }
    this.cache = { pricing, source: "file" };
  }

  /** The price of `model` on the day of `at`, or `null`: an unknown model is never guessed. */
  priceFor(model: string, at: Date): UnitPrice | null {
    const key = normalizeModelKey(model);
    if (key === "") return null;
    const day = localDay(at);
    const hit = this.read().pricing.models.find((row) => normalizeModelKey(row.key) === key && (!row.from || day >= row.from) && (!row.until || day <= row.until));
    if (!hit) return null;
    return { key, input: hit.input, output: hit.output, cacheRead: hit.cacheRead ?? hit.input };
  }

  rate(): number {
    return this.read().pricing.rateVndPerUsd || DEFAULT_PRICING.rateVndPerUsd;
  }
}

/** Đồng for one call; `null` when the model has no price. Cache reads are charged at their own price. */
export function costVnd(tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number }, price: UnitPrice | null, rate: number): number | null {
  if (price === null) return null;
  const cacheRead = Math.min(tokens.cacheReadTokens, tokens.inputTokens);
  const usd = ((tokens.inputTokens - cacheRead) * price.input + cacheRead * price.cacheRead + tokens.outputTokens * price.output) / 1e6;
  return Math.round(usd * rate * 100) / 100;
}
