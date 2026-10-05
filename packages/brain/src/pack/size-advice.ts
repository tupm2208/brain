/**
 * @file The SHAPE of "a variant from the customer's measurements" (05/10/2026, phiếu Desk nhóm số đo).
 *
 * Tier 1 owns the mechanism (read the measurements the customer typed, pick the row of the industry's
 * table, ask for the missing ones before naming a variant); tier 2 owns everything that names a thing
 * of one industry: which measurements exist and the words customers use for them, their units and
 * plausible ranges, the rows, and the "systems" of the industry (a running shoe needs three
 * measurements, a court shoe only the length). The data lives in `nganh/<id>/bang-size.json` beside
 * the rows it reads, under `tuVan`; an industry without that block simply has no measurement advice.
 *
 * A pharmacy has no such table; a kids' clothing shop would have one by height and weight; a ring
 * shop one by circumference. Nothing here knows which.
 */

/** How a measurement picks a row. */
export type MeasureKind =
  /** The row carries ONE value of this measurement (a foot length): the first row at or above it wins (rounded up). */
  | "point"
  /** The row carries a band [min, max]: the first row whose band holds it. */
  | "band"
  /** The row carries a band: only compared with the band of the row the PRIMARY measurement chose (a margin, not a lookup). */
  | "buffer";

export interface MeasureDef {
  id: string;
  /** What the customer calls it ("dài", "rộng", "chu vi") — said back when asking for it. */
  name: string;
  /** The row field holding it. */
  column: string;
  kind: MeasureKind;
  /** Regex (accent-stripped, lower case) of the words that announce it; the number follows within a few letters. */
  label: string;
  /** Unit word → factor into the column's unit ("cm": 1, "mm": 0.1). */
  units: Record<string, number>;
  /** Plausible values in the column's unit. A reading outside is not this measurement. */
  range: [number, number];
  /** A number typed WITHOUT its unit right after the label still counts (range-checked, units tried). */
  unitless: boolean;
  /** A number WITH a unit and no label at all is this measurement (the first one only). */
  fallback: boolean;
  /** "band" / "buffer": steps away from the primary row from which a wider model is suggested (0 = never). */
  wideFrom: number;
  /** Steps away from which the customer is asked to measure again (0 = never). */
  recheckFrom: number;
}

/** One way the industry turns measurements into a variant (running shoe, court shoe, everyday shoe). */
export interface SizeSystem {
  id: string;
  name: string;
  /** Regex on the context (the customer's lines + the product in focus): this system applies. "" = only as the default. */
  when: string;
  /** Measurement ids needed before a variant may be named. The first is the primary one. */
  needs: string[];
  /** Added to the primary measurement before the lookup: [low, high]; equal ends = one variant, else a range. */
  shift: [number, number];
  /** At most this many rows up / down for the other measurements. */
  upMax: number;
  downMax: number;
}

/** One row of the table: the variant label, its link value (the tag), and every other column. */
export interface SizeAdviceRow {
  size: string;
  /** The value that joins this table to a brand's own chart (a shoe's tag centimetres); `null` = none. */
  link: number | null;
  cols: Record<string, number | [number, number]>;
}

export interface SizeAdviceConfig {
  rows: SizeAdviceRow[];
  /** Name of the link column (`tem`), for the notes. */
  linkName: string;
  measures: MeasureDef[];
  /** Regex: words between label and number that make it something else ("size", "tem"). */
  padding: string;
  /** Regex anchored after a UNITLESS number that makes it something else ("k", "tuổi", "%"). */
  afterNumber: string;
  /** Regex on the text BEFORE a unit-carrying, unlabelled number that makes it something else (a tag, a box). */
  notMeasure: string;
  /** Regex: the message names a variant of its own ("size 42") — a unitless number beside it is not a measurement. */
  ownVariant: string;
  /** Regex: the customer says they cannot measure (then the primary measurement alone is used). */
  cannotMeasure: string;
  systems: SizeSystem[];
  /** Id of the system used when no `when` matches; "" = unknown (every system's answers are acceptable, none is named). */
  defaultSystem: string;
  /** Brands whose labels ARE this table's labels (a brand with no chart of its own and not listed: no label is named). */
  ownBrands: string[];
  /** How many customer lines back the measurements are read. */
  history: number;
}

export function emptySizeAdviceConfig(): SizeAdviceConfig {
  return { rows: [], linkName: "", measures: [], padding: "", afterNumber: "", notMeasure: "", ownVariant: "", cannotMeasure: "", systems: [], defaultSystem: "", ownBrands: [], history: 0 };
}

const KINDS: Record<string, MeasureKind> = { moc: "point", dai: "band", vungDem: "buffer", point: "point", band: "band", buffer: "buffer" };

/**
 * Reads `bang-size.json` (`rows` + `tuVan`). No `tuVan` = no advice (empty config, no problem).
 * Returns the problems instead of throwing, so the registry reports them with the industry's id.
 */
export function parseSizeAdvice(raw: unknown, where: string): { config: SizeAdviceConfig; problems: string[] } {
  const problems: string[] = [];
  const config = emptySizeAdviceConfig();
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return { config, problems };
  const o = raw as Record<string, unknown>;
  const t = o["tuVan"];
  if (t === undefined || t === null) return { config, problems };
  if (typeof t !== "object" || Array.isArray(t)) return { config, problems: [`\`${where}.tuVan\` phai la mot khoi { }.`] };
  const tv = t as Record<string, unknown>;
  const str = (v: unknown, at: string, optional = true): string => {
    if (v === undefined || v === null) { if (!optional) problems.push(`\`${at}\` thieu.`); return ""; }
    if (typeof v !== "string") { problems.push(`\`${at}\` phai la chu.`); return ""; }
    return v;
  };
  const num = (v: unknown, at: string, fallback: number): number => {
    if (v === undefined || v === null) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v)) { problems.push(`\`${at}\` phai la mot con so.`); return fallback; }
    return v;
  };
  const pair = (v: unknown, at: string, fallback: [number, number]): [number, number] => {
    if (v === undefined || v === null) return fallback;
    if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) { problems.push(`\`${at}\` phai la [so, so].`); return fallback; }
    return [v[0] as number, v[1] as number];
  };
  const regex = (v: unknown, at: string): string => {
    const s = str(v, at);
    if (s !== "") { try { new RegExp(s); } catch { problems.push(`\`${at}\` khong phai bieu thuc chinh quy hop le.`); return ""; } }
    return s;
  };
  config.linkName = str(tv["noi"], `${where}.tuVan.noi`);
  // Rows: `size` + the link column + every number / [min, max] column.
  const rows = Array.isArray(o["rows"]) ? (o["rows"] as unknown[]) : [];
  rows.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { problems.push(`\`${where}.rows[${i}]\` phai la mot khoi { }.`); return; }
    const row = entry as Record<string, unknown>;
    const size = typeof row["size"] === "string" ? row["size"].trim() : "";
    if (size === "") { problems.push(`\`${where}.rows[${i}].size\` thieu.`); return; }
    const cols: Record<string, number | [number, number]> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "size" || key.startsWith("_")) continue;
      if (typeof value === "number" && Number.isFinite(value)) cols[key] = value;
      else if (Array.isArray(value) && value.length === 2 && value.every((x) => typeof x === "number" && Number.isFinite(x))) cols[key] = [value[0] as number, value[1] as number];
    }
    const link = config.linkName !== "" && typeof cols[config.linkName] === "number" ? (cols[config.linkName] as number) : null;
    config.rows.push({ size, link, cols });
  });
  const measures = Array.isArray(tv["soDo"]) ? (tv["soDo"] as unknown[]) : [];
  measures.forEach((entry, i) => {
    const at = `${where}.tuVan.soDo[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { problems.push(`\`${at}\` phai la mot khoi { }.`); return; }
    const m = entry as Record<string, unknown>;
    const kind = KINDS[str(m["kieu"], `${at}.kieu`, false)];
    if (kind === undefined) { problems.push(`\`${at}.kieu\` phai la "moc", "dai" hoac "vungDem".`); return; }
    const units: Record<string, number> = {};
    const rawUnits = m["donVi"];
    if (rawUnits !== undefined && (rawUnits === null || typeof rawUnits !== "object" || Array.isArray(rawUnits))) problems.push(`\`${at}.donVi\` phai la { "don vi": he so }.`);
    else for (const [unit, factor] of Object.entries((rawUnits ?? {}) as Record<string, unknown>)) {
      if (unit.startsWith("_")) continue;
      if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) problems.push(`\`${at}.donVi.${unit}\` phai la so duong.`);
      else units[unit] = factor;
    }
    const def: MeasureDef = {
      id: str(m["id"], `${at}.id`, false), name: str(m["ten"], `${at}.ten`, false), column: str(m["cot"], `${at}.cot`, false), kind,
      label: regex(m["nhan"], `${at}.nhan`), units, range: pair(m["khoang"], `${at}.khoang`, [0, 0]),
      unitless: m["khongDonVi"] === true, fallback: m["macDinh"] === true,
      wideFrom: num(m["rongTu"], `${at}.rongTu`, 0), recheckFrom: num(m["doLaiTu"], `${at}.doLaiTu`, 0)
    };
    if (def.label === "") problems.push(`\`${at}.nhan\` thieu.`);
    if (def.range[0] >= def.range[1]) problems.push(`\`${at}.khoang\` phai la [nho, lon].`);
    const sample = config.rows.find((r) => r.cols[def.column] !== undefined)?.cols[def.column];
    if (config.rows.length > 0 && sample === undefined) problems.push(`\`${at}.cot\` "${def.column}" khong co trong \`rows\`.`);
    else if (sample !== undefined && (def.kind === "point") !== (typeof sample === "number")) problems.push(`\`${at}.cot\` "${def.column}": kieu "${String(m["kieu"])}" can ${def.kind === "point" ? "mot so" : "[min, max]"} moi dong.`);
    config.measures.push(def);
  });
  const ids = new Set(config.measures.map((m) => m.id));
  const systems = Array.isArray(tv["he"]) ? (tv["he"] as unknown[]) : [];
  systems.forEach((entry, i) => {
    const at = `${where}.tuVan.he[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { problems.push(`\`${at}\` phai la mot khoi { }.`); return; }
    const s = entry as Record<string, unknown>;
    const needs = Array.isArray(s["can"]) ? (s["can"] as unknown[]).map((x) => String(x ?? "")) : [];
    if (needs.length === 0) problems.push(`\`${at}.can\` phai liet ke it nhat mot so do (so do dau la so do chinh).`);
    for (const id of needs) if (!ids.has(id)) problems.push(`\`${at}.can\`: khong co so do "${id}" trong \`soDo\`.`);
    const primary = config.measures.find((m) => m.id === needs[0]);
    if (primary !== undefined && primary.kind !== "point") problems.push(`\`${at}.can[0]\`: so do chinh phai co kieu "moc".`);
    const shift = pair(s["dich"], `${at}.dich`, [0, 0]);
    if (shift[0] > shift[1]) problems.push(`\`${at}.dich\` phai la [thap, cao].`);
    config.systems.push({
      id: str(s["id"], `${at}.id`, false), name: str(s["ten"], `${at}.ten`, false), when: regex(s["khi"], `${at}.khi`), needs, shift,
      upMax: num(s["lenToiDa"], `${at}.lenToiDa`, 1), downMax: num(s["luiToiDa"], `${at}.luiToiDa`, 1)
    });
  });
  config.padding = regex(tv["chen"], `${where}.tuVan.chen`);
  config.afterNumber = regex(tv["sauSo"], `${where}.tuVan.sauSo`);
  config.notMeasure = regex(tv["khongPhaiDo"], `${where}.tuVan.khongPhaiDo`);
  config.ownVariant = regex(tv["bienTheRieng"], `${where}.tuVan.bienTheRieng`);
  config.cannotMeasure = regex(tv["khongDo"], `${where}.tuVan.khongDo`);
  config.defaultSystem = str(tv["heMacDinh"], `${where}.tuVan.heMacDinh`);
  if (config.defaultSystem !== "" && !config.systems.some((s) => s.id === config.defaultSystem)) problems.push(`\`${where}.tuVan.heMacDinh\`: khong co he "${config.defaultSystem}".`);
  config.ownBrands = Array.isArray(tv["bangCuaHang"]) ? (tv["bangCuaHang"] as unknown[]).map((x) => String(x ?? "").trim().toLowerCase()).filter((x) => x !== "") : [];
  config.history = num(tv["soTinDoc"], `${where}.tuVan.soTinDoc`, 10);
  if (config.measures.length > 0 && config.systems.length === 0) problems.push(`\`${where}.tuVan.he\` phai co it nhat mot he.`);
  return { config, problems };
}
