/**
 * @file A variant from the customer's own measurements (05/10/2026, phiếu Desk nhóm số đo).
 *
 * Three lessons of the shoe shop, written as rules for ANY shop whose variants follow a body
 * measurement (a foot, a child's height, a finger):
 *
 * 1. A measurement is what the customer typed after the words for it, with or without its unit
 *    ("chân bé 25.5" is a length in cm: no shoe size is that small). Missing it made every later
 *    check blind (phiếu 06/09).
 * 2. One measurement is not enough when the industry says so: name no variant, ask for the rest
 *    (phiếu 26/09). Only a customer who says they cannot measure gets the primary-only answer.
 * 3. The answer comes from the TABLE, never from a model's arithmetic, and is said in the brand's own
 *    labels when the brand has a chart (the link value — a tag in centimetres — joins the two);
 *    a brand with no chart gets no label at all ("bảng quy đổi theo từng hãng").
 *
 * Every word, unit, range, row and system is tier 2 data (`pack/size-advice.ts`). Pure: no model, no disk.
 */

import type { MeasureDef, SizeAdviceConfig, SizeSystem } from "../pack/size-advice";
import { normalize } from "./text-analysis";

/** The measurements read from the customer's lines, in each column's unit. */
export interface MeasureReading {
  values: Record<string, number>;
  /** The number as the customer typed it ("25.5"), per measurement. */
  said: Record<string, string>;
  /** The measurement came without its unit. */
  unitless: Record<string, boolean>;
  /** The customer said they cannot measure. */
  cannotMeasure: boolean;
}

/** One row of a brand's own chart (from the landing): its label, its link value, other systems' labels ({ uk: "8" }). */
export interface BrandChartRow {
  label: string;
  link: number | null;
  alt: Record<string, string>;
}

export type SizeHintStatus =
  /** Every measurement the system needs is there: `size` is named. */
  | "du"
  /** Some are missing: NO variant may be named; ask for `missing`. */
  | "thieu"
  /** Missing, but the customer cannot measure: `size` from the primary measurement alone. */
  | "khong-do"
  /** The measurement is beyond the table: a person checks. */
  | "ngoai-bang"
  /** The context names no system: every system's answer is acceptable, none is named. */
  | "chua-ro-he";

export interface SizeHint {
  status: SizeHintStatus;
  systemId: string;
  systemName: string;
  measures: Record<string, number>;
  said: Record<string, string>;
  /** The primary measurement (the one that picks the row) and the number as the customer typed it. */
  primaryId: string;
  primarySaid: string;
  /** Names of the measurements given, in the table's order ("dài 25", "rộng 10.3"). */
  given: string[];
  /** Names of the measurements still needed. */
  missing: string[];
  /** The label to name ("" when none may be named). */
  size: string;
  /** The low end when the system gives a range ("41 1/3" of "41 1/3–42"). */
  sizeLow: string;
  /** The link value of `size` / `sizeLow` (the tag), `null` when the table has none. */
  link: number | null;
  linkLow: number | null;
  /** By the primary measurement alone (what "khong-do" names). */
  base: string;
  /** Suggest a wider model. */
  wide: boolean;
  /** Names of the measurements to take again. */
  recheck: string[];
  /** Labels a conversion sentence may name. */
  acceptable: string[];
  /** The brand is known and has no chart: no label is named, only the link value. */
  noChart: boolean;
  reasons: string[];
}

/** A row of the variant map the reply gate checks pairs against. */
export interface VariantRow {
  label: string;
  /** The tag value. */
  link: number | null;
  /** The primary body measurement that maps to it (a foot length). */
  body: number | null;
  alt: Record<string, string>;
}

const EPS = 1e-6;

/** "44 2/3" ≡ "44 2 / 3" ≡ "44-2/3"; "42,5" ≡ "42.5". */
export function sameVariantLabel(a: string, b: string): boolean {
  const n = (s: string): string => String(s ?? "").trim().toLowerCase().replace(/,/g, ".").replace(/\s*\/\s*/g, "/").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ");
  return n(a) !== "" && n(a) === n(b);
}

/** Reads the customer's measurements with an industry's `tuVan` config. */
export class MeasureReader {
  private readonly unitAlt: Map<string, string>;

  constructor(private readonly cfg: SizeAdviceConfig) {
    this.unitAlt = new Map(cfg.measures.map((m) => [m.id, Object.keys(m.units).map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")]));
  }

  get active(): boolean {
    return this.cfg.measures.length > 0 && this.cfg.rows.length > 0;
  }

  /** The measurements of several lines, oldest first: a later line overrides an earlier one. */
  read(lines: readonly string[]): MeasureReading {
    const out: MeasureReading = { values: {}, said: {}, unitless: {}, cannotMeasure: false };
    if (!this.active) return out;
    const cannot = this.cfg.cannotMeasure === "" ? null : new RegExp(this.cfg.cannotMeasure);
    for (const line of lines) {
      const one = this.readOne(line);
      for (const [id, r] of Object.entries(one)) { out.values[id] = r.value; out.said[id] = r.said; out.unitless[id] = r.unitless; }
      if (cannot !== null && cannot.test(prepare(line))) out.cannotMeasure = true;
    }
    return out;
  }

  /** The measurements of one line. */
  readOne(line: string): Record<string, { value: number; said: string; unitless: boolean }> {
    const text = prepare(line);
    if (text === "") return {};
    const padding = this.cfg.padding === "" ? null : new RegExp(this.cfg.padding);
    const after = this.cfg.afterNumber === "" ? null : new RegExp(this.cfg.afterNumber);
    const ownVariant = this.cfg.ownVariant !== "" && new RegExp(this.cfg.ownVariant).test(text);
    type Hit = { def: MeasureDef; numStart: number; labelStart: number; pad: number; value: number; said: string; unitless: boolean };
    const hits: Hit[] = [];
    for (const def of this.cfg.measures) {
      const units = this.unitAlt.get(def.id) ?? "";
      const re = new RegExp(`(?:^|[^a-z0-9])(?:${def.label})([^0-9]{0,12}?)(\\d{1,3}(?:\\.\\d{1,2})?)(?![\\d]|\\.\\d)\\s*${units !== "" ? `(${units})?` : "()?"}(?![a-z])`, "gd");
      for (const m of text.matchAll(re)) {
        const pad = m[1] ?? "";
        if (padding !== null && padding.test(pad)) continue;
        const said = m[2]!;
        const raw = Number(said);
        const numStart = m.indices?.[2]?.[0] ?? (m.index ?? 0);
        const unit = m[3] ?? "";
        let value: number | null = null;
        let unitless = false;
        if (unit !== "") {
          const v = raw * (def.units[unit] ?? 1);
          if (inRange(v, def.range)) value = v;
        } else if (def.unitless && !ownVariant) {
          const rest = text.slice(numStart + said.length);
          if (after !== null && after.test(rest)) continue;
          unitless = true;
          if (inRange(raw, def.range)) value = raw;
          else for (const factor of Object.values(def.units)) { const v = raw * factor; if (inRange(v, def.range)) { value = v; break; } }
        }
        if (value === null) continue;
        hits.push({ def, numStart, labelStart: m.index ?? 0, pad: pad.length, value: round2(value), said, unitless });
      }
    }
    // One number is one measurement: the label nearest to it wins, then the longer (earlier) label.
    const byNumber = new Map<number, Hit>();
    for (const h of hits) {
      const prev = byNumber.get(h.numStart);
      if (prev === undefined || h.pad < prev.pad || (h.pad === prev.pad && h.labelStart < prev.labelStart)) byNumber.set(h.numStart, h);
    }
    const out: Record<string, { value: number; said: string; unitless: boolean }> = {};
    for (const h of [...byNumber.values()].sort((a, b) => a.numStart - b.numStart)) {
      if (out[h.def.id] === undefined) out[h.def.id] = { value: h.value, said: h.said, unitless: h.unitless };
    }
    // A number WITH a unit and no label: the fallback measurement, unless the words before it make it a tag / a box.
    const fallback = this.cfg.measures.find((m) => m.fallback);
    if (fallback !== undefined && out[fallback.id] === undefined) {
      const units = this.unitAlt.get(fallback.id) ?? "";
      if (units !== "") {
        const notMeasure = this.cfg.notMeasure === "" ? null : new RegExp(this.cfg.notMeasure);
        const labels = this.cfg.measures.map((m) => new RegExp(`(?:${m.label})[^0-9]{0,12}$`));
        for (const m of text.matchAll(new RegExp(`(?<![\\d.a-z])(\\d{1,3}(?:\\.\\d{1,2})?)\\s*(${units})(?![a-z])`, "g"))) {
          const start = m.index ?? 0;
          if (byNumber.has(start)) continue;
          const lead = text.slice(Math.max(0, start - 18), start);
          if (notMeasure !== null && notMeasure.test(lead)) continue;
          if (labels.some((re) => re.test(lead))) continue;
          const v = Number(m[1]) * (fallback.units[m[2]!] ?? 1);
          if (!inRange(v, fallback.range)) continue;
          out[fallback.id] = { value: round2(v), said: m[1]!, unitless: false };
          break;
        }
      }
    }
    return out;
  }
}

/** Turns a reading into a hint with an industry's table and systems. */
export class SizeAdvisor {
  constructor(private readonly cfg: SizeAdviceConfig) {}

  /** The system the context names, the default one, or `null` (unknown). */
  systemFor(context: string): SizeSystem | null {
    const text = normalize(context);
    for (const s of this.cfg.systems) if (s.when !== "" && new RegExp(s.when).test(text)) return s;
    return this.cfg.systems.find((s) => s.id === this.cfg.defaultSystem) ?? null;
  }

  /**
   * The hint for a reading. `brand` = the brand in focus ("" when unknown); `brandRows` = its chart
   * from the landing (`null` / empty = none). `null` when the primary measurement is not there.
   */
  advise(reading: MeasureReading, ctx: { context: string; brand?: string | undefined; brandRows?: readonly BrandChartRow[] | null | undefined }): SizeHint | null {
    if (this.cfg.systems.length === 0 || this.cfg.rows.length === 0) return null;
    const brand = String(ctx.brand ?? "").trim().toLowerCase();
    const brandRows = (ctx.brandRows ?? []).filter((r) => r.label !== "");
    const noChart = brand !== "" && brandRows.length === 0 && !this.cfg.ownBrands.includes(brand);
    const labelOf = (rowIndex: number): string => {
      const row = this.cfg.rows[rowIndex];
      if (row === undefined) return "";
      if (brandRows.length > 0) return row.link === null ? "" : nearestLabel(brandRows, row.link);
      return noChart ? "" : row.size;
    };
    const system = this.systemFor(ctx.context);
    if (system === null) {
      // Unknown system: what every system would answer is acceptable; nothing is named.
      const results = this.cfg.systems.map((s) => this.compute(s, reading, true)).filter((r): r is Computed => r !== null);
      if (results.length === 0) return null;
      const first = results[0]!;
      const acceptable = unique(results.flatMap((r) => r.acceptable.map(labelOf)));
      return this.hint("chua-ro-he", { id: "", name: "" }, reading, first, labelOf, acceptable, noChart, results.flatMap((r) => r.reasons), "");
    }
    const c = this.compute(system, reading, false);
    if (c === null) return null;
    const status: SizeHintStatus = c.beyond ? "ngoai-bang" : c.missing.length > 0 ? (reading.cannotMeasure ? "khong-do" : "thieu") : "du";
    const acceptable = status === "thieu" ? [] : unique(c.acceptable.map(labelOf));
    return this.hint(status, system, reading, c, labelOf, acceptable, noChart, c.reasons, status === "thieu" ? "" : labelOf(c.index));
  }

  /** The variant map for the reply gate: the brand's labels when it has a chart, the table's otherwise. */
  variantRows(brand: string, brandRows: readonly BrandChartRow[] | null | undefined): VariantRow[] {
    const primary = this.primaryColumn();
    const body = (link: number | null): number | null => {
      if (link === null || primary === "") return null;
      const row = this.cfg.rows.find((r) => r.link !== null && Math.abs(r.link - link) < 0.26);
      const v = row?.cols[primary];
      return typeof v === "number" ? v : null;
    };
    const rows = (brandRows ?? []).filter((r) => r.label !== "");
    if (rows.length > 0) return rows.map((r) => ({ label: r.label, link: r.link, body: body(r.link), alt: { ...r.alt } }));
    const key = brand.trim().toLowerCase();
    if (key !== "" && !this.cfg.ownBrands.includes(key)) return [];
    return this.cfg.rows.map((r) => ({ label: r.size, link: r.link, body: body(r.link), alt: {} }));
  }

  private primaryColumn(): string {
    const id = (this.cfg.systems.find((s) => s.id === this.cfg.defaultSystem) ?? this.cfg.systems[0])?.needs[0] ?? "";
    return this.cfg.measures.find((m) => m.id === id)?.column ?? "";
  }

  private hint(status: SizeHintStatus, system: { id: string; name: string }, reading: MeasureReading, c: Computed, labelOf: (i: number) => string, acceptable: string[], noChart: boolean, reasons: string[], size: string): SizeHint {
    const named = this.cfg.measures.filter((m) => reading.values[m.id] !== undefined);
    const ranged = size !== "" && c.low !== c.index;
    return {
      status, systemId: system.id, systemName: system.name,
      measures: { ...reading.values }, said: { ...reading.said },
      primaryId: c.primaryId, primarySaid: reading.said[c.primaryId] ?? "",
      given: named.map((m) => `${m.name} ${reading.said[m.id] ?? reading.values[m.id]}`),
      missing: c.missing, size,
      sizeLow: ranged ? labelOf(c.low) : "",
      link: status === "thieu" || status === "chua-ro-he" ? null : this.cfg.rows[c.index]?.link ?? null,
      linkLow: ranged ? this.cfg.rows[c.low]?.link ?? null : null,
      base: labelOf(c.baseIndex),
      wide: c.wide, recheck: c.recheck, acceptable, noChart, reasons
    };
  }

  /** One system on one reading: the row, the range, the steps. `ignoreNeeds` = the primary measurement only. */
  private compute(system: SizeSystem, reading: MeasureReading, ignoreNeeds: boolean): Computed | null {
    const primary = this.cfg.measures.find((m) => m.id === system.needs[0]);
    if (primary === undefined) return null;
    const value = reading.values[primary.id];
    if (value === undefined) return null;
    const rows = this.cfg.rows;
    const col = (i: number, def: MeasureDef): number | [number, number] | undefined => rows[i]?.cols[def.column];
    const point = (i: number): number => { const v = col(i, primary); return typeof v === "number" ? v : NaN; };
    const firstAtOrAbove = (v: number): number => { for (let i = 0; i < rows.length; i += 1) if (point(i) >= v - EPS) return i; return -1; };
    const reasons: string[] = [];
    let high = firstAtOrAbove(value + system.shift[1]);
    let low = firstAtOrAbove(value + system.shift[0]);
    const step0 = rows.length > 1 ? point(1) - point(0) : 0;
    const beyond = high < 0 || (step0 > 0 && value + system.shift[1] < point(0) - step0);
    if (high < 0) high = rows.length - 1;
    if (low < 0) low = high;
    reasons.push(`${primary.name} ${value} → ${rows[high]?.size ?? "?"}`);
    const baseIndex = high;
    let index = high;
    let wide = false;
    const recheck: string[] = [];
    const steps: number[] = [];
    if (!beyond && !ignoreNeeds) {
      for (const id of system.needs.slice(1)) {
        const def = this.cfg.measures.find((m) => m.id === id);
        const v = def === undefined ? undefined : reading.values[def.id];
        if (def === undefined || v === undefined) continue;
        let step = 0;
        if (def.kind === "band") {
          let at = -1;
          for (let i = 0; i < rows.length; i += 1) { const b = col(i, def); if (Array.isArray(b) && v >= b[0] - EPS && v <= b[1] + EPS) { at = i; break; } }
          if (at < 0) { const lastBand = col(rows.length - 1, def); at = Array.isArray(lastBand) && v > lastBand[1] ? rows.length - 1 : 0; }
          step = at - high;
        } else if (def.kind === "buffer") {
          const b = col(high, def);
          if (Array.isArray(b) && v > b[1] + EPS) {
            step = 1;
            while (high + step < rows.length) { const nb = col(high + step, def); if (Array.isArray(nb) && v <= nb[1] + EPS) break; step += 1; }
          } else if (Array.isArray(b) && v < b[0] - EPS) {
            step = -1;
            while (high + step >= 0) { const nb = col(high + step, def); if (Array.isArray(nb) && v >= nb[0] - EPS) break; step -= 1; }
          }
        } else continue;
        steps.push(step);
        if (def.wideFrom > 0 && step >= def.wideFrom) wide = true;
        if (def.recheckFrom > 0 && Math.abs(step) >= def.recheckFrom) recheck.push(def.name);
        reasons.push(`${def.name} ${v} → ${step > 0 ? "+" : ""}${step}`);
      }
      if (steps.length > 0) {
        const up = Math.max(...steps);
        const down = Math.min(...steps);
        if (up > 0) index = Math.min(rows.length - 1, high + Math.min(up, Math.max(0, system.upMax)));
        else if (down < 0) index = Math.max(0, high - Math.min(-down, Math.max(0, system.downMax)));
      }
    }
    if (low > index) low = index;
    const missing = ignoreNeeds ? [] : system.needs.filter((id) => reading.values[id] === undefined).map((id) => this.cfg.measures.find((m) => m.id === id)?.name ?? id);
    const acceptable: number[] = [];
    if (beyond) acceptable.push(index);
    else if (low < index) for (let i = low; i <= index; i += 1) acceptable.push(i);
    else for (const i of [index, index - 1, index + 1]) if (i >= 0 && i < rows.length) acceptable.push(i);
    return { primaryId: primary.id, index, low: low < index ? low : index, baseIndex, beyond, wide, recheck, missing, acceptable, reasons };
  }
}

interface Computed {
  primaryId: string;
  index: number;
  low: number;
  baseIndex: number;
  beyond: boolean;
  wide: boolean;
  recheck: string[];
  missing: string[];
  acceptable: number[];
  reasons: string[];
}

/** The brand's label whose link is nearest (within a quarter step), "" when none. */
export function nearestLabel(rows: readonly BrandChartRow[], link: number): string {
  let best: BrandChartRow | null = null;
  for (const r of rows) {
    if (r.link === null) continue;
    if (best === null || Math.abs(r.link - link) < Math.abs((best.link ?? Infinity) - link)) best = r;
  }
  return best !== null && best.link !== null && Math.abs(best.link - link) < 0.26 ? best.label : "";
}

function prepare(line: string): string {
  return normalize(String(line ?? "").replace(/(\d),(\d)/g, "$1.$2"));
}

function inRange(v: number, range: [number, number]): boolean {
  return Number.isFinite(v) && v >= range[0] - EPS && v <= range[1] + EPS;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function unique(list: string[]): string[] {
  return [...new Set(list.filter((x) => x !== ""))];
}
