/**
 * @file A SHOP'S PRICE TABLE as Xeon sees it (02/10/2026): its shape, and the cleaning of a table
 * that came from a hand-edited JSON file or from a model.
 *
 * The table lives on the shop's landing (`landing_page/src/modules/hang-kho/price-table.ts` holds
 * the model and the evaluator) and Xeon never prices anything. Xeon touches a table in two places
 * only: the ready-made templates it serves (`price-templates.ts`) and the table a model writes from
 * the shop's own words (`price-rule-translator.ts`). Both must come back in the landing's shape, and
 * the landing cleans again with its own `cleanTable` — so this file mirrors that shape on purpose.
 *
 * What it adds on top of the landing's cleaning, because a MODEL may have written the table:
 *   - a type / brand / sport / gender value that is not in the shop's catalogue is dropped, and a
 *     condition left with no value drops its WHOLE rule. An empty list means "any item", and a
 *     condition the landing does not know is silently removed by it — keeping either would turn
 *     "this kind of item +X" into "every item +X";
 *   - a specific line hidden under a more general one (the first matching line wins) is moved above
 *     it, and a line that can never be reached (same conditions as one above) is removed;
 *   - each of those is said in one sentence, for the person who reviews the proposal. The template
 *     check treats the same sentences as authoring errors.
 *
 * Wire names stay Vietnamese: they are the landing's stored document.
 */

/** What a condition can look at. `giaTruoc` (price before rounding) exists only for rounding rules. */
export type ConditionField = "loai" | "hang" | "mon" | "gioiTinh" | "ma" | "giaGoc" | "giam" | "giaTruoc";
export const CONDITION_FIELDS: readonly ConditionField[] = ["loai", "hang", "mon", "gioiTinh", "ma", "giaGoc", "giam", "giaTruoc"];

/** The condition fields whose values come from the shop's own catalogue (never from code). */
export type CatalogField = "loai" | "hang" | "mon" | "gioiTinh";
export const CATALOG_FIELDS: readonly CatalogField[] = ["loai", "hang", "mon", "gioiTinh"];

/** How a line adds to the base price (see the landing's `PRICE_TABLE_GUIDE.kieu`). */
export type AddMode = "cong" | "tien" | "pt" | "tienpt" | "niemyet" | "giu" | "banglai" | "trong";
export const ADD_MODES: readonly AddMode[] = ["cong", "tien", "pt", "tienpt", "niemyet", "giu", "banglai", "trong"];

/** The rounding steps the landing accepts. */
export const ROUNDING_STEPS: readonly number[] = [1000, 10000, 50000, 100000];

export interface PriceCondition {
  f: ConditionField;
  /** loai / hang / mon / gioiTinh / ma: any of these values (empty = any). */
  v?: string[];
  /** giaGoc / giam: from (inclusive); null = no lower bound. */
  tu?: number | null;
  /** giaGoc / giam / giaTruoc: below (exclusive); null = no upper bound. */
  duoi?: number | null;
}

/**
 * One line. `phi` = a fixed cost per item (not margin), `giaThapNhat` / `giaCaoNhat` = the selling
 * price limits applied after rounding, `khongQuaNiemYet` = this line never sells above the list
 * price (04/10/2026, the "Tự làm công thức" screen).
 */
export interface LineBody { kieu: AddMode; tien: number; pt: number; phi: number; giaThapNhat: number | null; giaCaoNhat: number | null; khongQuaNiemYet: boolean }
export interface PriceLine extends LineBody { dk: PriceCondition[] }
export interface MarginFloor { dk: PriceCondition[]; tien: number; pt: number }
export interface RoundingRule { dk: PriceCondition[]; buoc: number; huong: "gan" | "len" | "xuong"; tru: number; tronTram: boolean }

/** The landing's `PriceTable` minus `suaLuc` (the landing stamps it). */
export interface PriceRuleTable {
  ma: string;
  ten: string;
  dong: PriceLine[];
  conLai: PriceLine;
  gioiHan: MarginFloor[];
  lamTron: RoundingRule[];
  khongQuaNiemYet: boolean;
  nguonMau: string;
}

/** The values the shop's catalogue offers for each catalogue field (the landing counts them). */
export interface CatalogChoices { loai: string[]; hang: string[]; mon: string[]; gioiTinh: string[] }

/** The landing's limits (`cleanTable`): beyond them it cuts, so Xeon cuts the same way. */
const MAX_LINES = 60;
const MAX_FLOORS = 20;
const MAX_ROUNDINGS = 20;
const MAX_CONDITIONS = 12;
const MAX_VALUES = 200;

const LINE_FIELDS: readonly ConditionField[] = ["loai", "hang", "mon", "gioiTinh", "ma", "giaGoc", "giam"];
const ROUND_FIELDS: readonly ConditionField[] = ["loai", "hang", "mon", "gioiTinh", "giaTruoc"];

const FIELD_LABELS: Record<ConditionField, string> = {
  loai: "loại", hang: "hãng", mon: "môn", gioiTinh: "giới tính", ma: "mã", giaGoc: "giá gốc", giam: "giảm", giaTruoc: "giá trước làm tròn"
};

const str = (v: unknown, max = 120): string => String(v ?? "").trim().slice(0, max);
const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nonNegative = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const bound = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** Upper-case, no diacritics, one space — "nữ", "Nữ" and "NU" are the same value. */
export function valueKey(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").replace(/\s+/g, " ").trim().toUpperCase();
}

/** 1200000 → "1.200.000", the way the screen writes money. */
function money(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** The conditions in words, for a sentence the shop reads ("<value>, giảm từ <n>%"). */
export function describeConditions(dk: readonly PriceCondition[]): string {
  if (dk.length === 0) return "mọi hàng";
  return dk.map((c) => {
    switch (c.f) {
      case "giaGoc":
      case "giaTruoc": {
        const parts = [c.tu != null ? `${FIELD_LABELS[c.f]} từ ${money(c.tu)}` : "", c.duoi != null ? `${FIELD_LABELS[c.f]} dưới ${money(c.duoi)}` : ""].filter(Boolean);
        return parts.length > 0 ? parts.join(", ") : `${FIELD_LABELS[c.f]} bất kỳ`;
      }
      case "giam": {
        const parts = [c.tu != null ? `giảm từ ${c.tu}%` : "", c.duoi != null ? `giảm dưới ${c.duoi}%` : ""].filter(Boolean);
        return parts.length > 0 ? parts.join(", ") : "giảm bất kỳ";
      }
      default: {
        const values = c.v ?? [];
        if (values.length === 0) return `${FIELD_LABELS[c.f]} bất kỳ`;
        return `${c.f === "ma" ? "mã " : ""}${values.join("/")}`;
      }
    }
  }).join(", ");
}

/** What a line does, in words ("cộng 200.000"). */
function describeAdd(line: LineBody): string {
  const fee = line.phi > 0 ? ` + phí ${money(line.phi)}` : "";
  switch (line.kieu) {
    case "cong": return `cộng ${[line.pt > 0 ? `${line.pt}%` : "", line.tien > 0 ? money(line.tien) : ""].filter(Boolean).join(" + ") || "0"}${fee}`;
    case "banglai": return "theo bảng lãi";
    case "tien": return `cộng ${money(line.tien)}`;
    case "pt": return `cộng ${line.pt}%`;
    case "tienpt": return `cộng ${money(line.tien)} rồi ${line.pt}%`;
    case "niemyet": return `giá niêm yết trừ ${line.pt}%`;
    case "giu": return "giữ giá gốc";
    default: return "chưa định giá";
  }
}

// ------------------------------------------------------------------------- generality

/** Whether every item meeting ALL of `dk` also meets `c`. Syntactic, so it errs towards "no". */
function implies(dk: readonly PriceCondition[], c: PriceCondition): boolean {
  const same = dk.filter((d) => d.f === c.f);
  switch (c.f) {
    case "giaGoc": {
      const lo = Math.max(-Infinity, ...same.map((d) => d.tu ?? -Infinity));
      const hi = Math.min(Infinity, ...same.map((d) => d.duoi ?? Infinity));
      return (c.tu == null || lo >= c.tu) && (c.duoi == null || hi <= c.duoi);
    }
    case "giam": {
      const lo = Math.max(-Infinity, ...same.map((d) => d.tu ?? -Infinity));
      const hi = Math.min(Infinity, ...same.map((d) => d.duoi ?? Infinity));
      return (c.tu == null || lo >= c.tu) && (c.duoi == null || hi <= c.duoi);
    }
    case "giaTruoc": {
      if (c.duoi == null) return true;
      return Math.min(Infinity, ...same.map((d) => d.duoi ?? Infinity)) <= c.duoi;
    }
    default: {
      const wanted = (c.v ?? []).map(valueKey);
      if (wanted.length === 0) return true;
      return same.some((d) => (d.v ?? []).length > 0 && (d.v ?? []).every((x) => wanted.includes(valueKey(x))));
    }
  }
}

/** Whether a rule with `general` conditions catches every item a rule with `specific` conditions catches. */
export function coversConditions(general: readonly PriceCondition[], specific: readonly PriceCondition[]): boolean {
  return general.every((c) => implies(specific, c));
}

/**
 * Orders "first match wins" rules so that no rule sits under a more general one: a hidden rule is
 * moved just above the first rule that hides it, and a rule with the same conditions as one above
 * (never reachable) is removed. Rules that merely overlap keep the order they were written in.
 */
export function orderSpecificFirst<T extends { dk: PriceCondition[] }>(rules: readonly T[], what: string, describe: (rule: T) => string): { rules: T[]; notes: string[] } {
  const ordered: T[] = [];
  const notes: string[] = [];
  for (const rule of rules) {
    const at = ordered.findIndex((above) => coversConditions(above.dk, rule.dk) && !coversConditions(rule.dk, above.dk));
    if (at < 0) { ordered.push(rule); continue; }
    notes.push(`Đưa ${what} “${describeConditions(rule.dk)}” lên trước “${describeConditions(ordered[at]!.dk)}”: ${what} chung hơn đứng trên sẽ che mất nó.`);
    ordered.splice(at, 0, rule);
  }
  const kept: T[] = [];
  for (const rule of ordered) {
    if (kept.some((above) => coversConditions(above.dk, rule.dk))) {
      notes.push(`Bỏ ${what} “${describeConditions(rule.dk)}” (${describe(rule)}): trùng điều kiện với ${what} phía trên nên không bao giờ được dùng.`);
      continue;
    }
    kept.push(rule);
  }
  return { rules: kept, notes };
}

// ------------------------------------------------------------------------- cleaning

type ConditionsOutcome = { ok: true; dk: PriceCondition[] } | { ok: false; why: string };

/**
 * One rule's conditions. A condition on a field the rule cannot use, or whose every value is
 * missing from the catalogue, fails the whole rule (see the file header for why).
 */
function cleanConditions(raw: unknown, allowed: readonly ConditionField[], choices: CatalogChoices | undefined, droppedValues: string[]): ConditionsOutcome {
  const dk: PriceCondition[] = [];
  for (const item of asArray(raw).slice(0, MAX_CONDITIONS)) {
    const o = asRecord(item);
    const f = str(o["f"], 40);
    if (!(allowed as readonly string[]).includes(f)) return { ok: false, why: `điều kiện “${f || "?"}” không dùng được ở đây` };
    const field = f as ConditionField;
    if (field === "giaGoc") { dk.push({ f: field, tu: bound(o["tu"]), duoi: bound(o["duoi"]) }); continue; }
    if (field === "giaTruoc") { dk.push({ f: field, tu: null, duoi: bound(o["duoi"]) }); continue; }
    if (field === "giam") { dk.push({ f: field, tu: bound(o["tu"]), duoi: bound(o["duoi"]) }); continue; }
    const written = [...new Set(asArray(o["v"]).map((x) => str(x, 80)).filter(Boolean))].slice(0, MAX_VALUES);
    if (field === "ma") { dk.push({ f: field, v: written.map((x) => x.toUpperCase()) }); continue; }
    if (choices === undefined) { dk.push({ f: field, v: written }); continue; }
    const offered = choices[field];
    const kept: string[] = [];
    for (const value of written) {
      const match = offered.find((choice) => valueKey(choice) === valueKey(value));
      if (match === undefined) droppedValues.push(`“${value}” (${FIELD_LABELS[field]})`);
      else if (!kept.includes(match)) kept.push(match);
    }
    if (written.length > 0 && kept.length === 0) return { ok: false, why: `không ${FIELD_LABELS[field]} nào có trong danh mục của shop` };
    dk.push({ f: field, v: kept });
  }
  return { ok: true, dk };
}

function cleanAdd(o: Record<string, unknown>, notes: string[]): LineBody {
  const raw = o["kieu"];
  const known = (ADD_MODES as readonly string[]).includes(String(raw));
  if (!known && raw !== undefined) notes.push(`Cách cộng “${str(raw, 40)}” không có — dòng đó để “chưa định giá”.`);
  const body: LineBody = {
    kieu: known ? (String(raw) as AddMode) : "trong", tien: nonNegative(o["tien"]), pt: Math.min(1000, nonNegative(o["pt"])),
    phi: nonNegative(o["phi"]), giaThapNhat: bound(o["giaThapNhat"]), giaCaoNhat: bound(o["giaCaoNhat"]), khongQuaNiemYet: o["khongQuaNiemYet"] === true
  };
  if (body.giaThapNhat !== null && body.giaCaoNhat !== null && body.giaThapNhat > body.giaCaoNhat) {
    notes.push(`Một dòng (${describeAdd(body)}) có giá thấp nhất ${money(body.giaThapNhat)} cao hơn giá cao nhất ${money(body.giaCaoNhat)} — anh xem lại.`);
  }
  return body;
}

export interface CleanOptions {
  /**
   * The shop's catalogue values. Given (a model's table): a value not among them is dropped.
   * Absent (a template file): values are kept as written — there is no shop yet.
   */
  choices?: CatalogChoices | undefined;
}

export interface CleanedTable {
  bang: PriceRuleTable;
  /** Every correction, one sentence each, in the order made. Empty = taken as written. */
  ghiChu: string[];
}

/**
 * A table cleaned into the landing's shape. Never throws: a malformed piece is dropped (and said),
 * not the table. A missing "Còn lại" = not priced, exactly as on the landing.
 */
export function cleanPriceRules(raw: unknown, options: CleanOptions = {}): CleanedTable {
  const o = asRecord(raw);
  const notes: string[] = [];
  const droppedValues: string[] = [];
  const choices = options.choices;

  const lines: PriceLine[] = [];
  for (const item of asArray(o["dong"]).slice(0, MAX_LINES)) {
    const r = asRecord(item);
    const add = cleanAdd(r, notes);
    const dk = cleanConditions(r["dk"], LINE_FIELDS, choices, droppedValues);
    if (!dk.ok) { notes.push(`Bỏ một dòng (${describeAdd(add)}): ${dk.why}.`); continue; }
    lines.push({ dk: dk.dk, ...add });
  }
  const orderedLines = orderSpecificFirst(lines, "dòng", describeAdd);

  const floors: MarginFloor[] = [];
  for (const item of asArray(o["gioiHan"]).slice(0, MAX_FLOORS)) {
    const r = asRecord(item);
    const tien = nonNegative(r["tien"]);
    const pt = Math.min(1000, nonNegative(r["pt"]));
    const dk = cleanConditions(r["dk"], LINE_FIELDS, choices, droppedValues);
    if (!dk.ok) { notes.push(`Bỏ một giới hạn lãi (ít nhất ${money(tien)} / ${pt}%): ${dk.why}.`); continue; }
    floors.push({ dk: dk.dk, tien, pt });
  }

  const roundings: RoundingRule[] = [];
  for (const item of asArray(o["lamTron"]).slice(0, MAX_ROUNDINGS)) {
    const r = asRecord(item);
    const step = Number(r["buoc"]);
    const buoc = ROUNDING_STEPS.includes(step) ? step : 10000;
    if (!ROUNDING_STEPS.includes(step) && r["buoc"] !== undefined) notes.push(`Bước làm tròn “${str(r["buoc"], 20)}” không có — dùng ${money(buoc)}.`);
    const huong = r["huong"] === "len" || r["huong"] === "xuong" ? r["huong"] : "gan";
    const rule = { buoc, huong, tru: nonNegative(r["tru"]), tronTram: r["tronTram"] === true } as const;
    const dk = cleanConditions(r["dk"], ROUND_FIELDS, choices, droppedValues);
    if (!dk.ok) { notes.push(`Bỏ một cách làm tròn (bước ${money(buoc)}): ${dk.why}.`); continue; }
    roundings.push({ dk: dk.dk, ...rule });
  }
  const orderedRoundings = orderSpecificFirst(roundings, "cách làm tròn", (r) => `bước ${money(r.buoc)}`);

  const unknown = [...new Set(droppedValues)];
  const ghiChu = [
    ...(unknown.length > 0 ? [`Bỏ ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? ` và ${unknown.length - 8} giá trị khác` : ""}: không có trong danh mục của shop.`] : []),
    ...notes, ...orderedLines.notes, ...orderedRoundings.notes
  ];
  const conLai: LineBody = o["conLai"] === undefined
    ? { kieu: "trong", tien: 0, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false }
    : cleanAdd(asRecord(o["conLai"]), ghiChu);
  return {
    bang: {
      ma: str(o["ma"], 64),
      ten: str(o["ten"], 80),
      dong: orderedLines.rules,
      conLai: { dk: [], ...conLai },
      gioiHan: floors,
      lamTron: orderedRoundings.rules,
      khongQuaNiemYet: o["khongQuaNiemYet"] === true,
      nguonMau: str(o["nguonMau"], 64)
    },
    ghiChu
  };
}

/** Whether a table says anything at all (a line, a limit, a rounding, a priced "Còn lại"). */
export function tableSaysSomething(table: PriceRuleTable): boolean {
  return table.dong.length > 0 || table.gioiHan.length > 0 || table.lamTron.length > 0 || table.conLai.kieu !== "trong" || table.khongQuaNiemYet;
}
