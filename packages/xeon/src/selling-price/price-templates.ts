/**
 * @file READY-MADE PRICE TABLES (02/10/2026) — what a shop can start its own price table from.
 *
 * Two layers, the three-tier rule applied to data:
 *   - tier 1, `loi-chung/mau-bang-gia.json`: generic templates every shop of every industry sees
 *     (an empty table, "add a percent", "add a fixed amount"), their numbers left at 0;
 *   - tier 2, `nganh/<id>/mau-bang-gia.json`: the industry's sample (e.g. the pricing ladder an
 *     older tool kept hidden in code, written as lines). Absent = the industry has none, not an error.
 *
 * A template is never applied by Xeon. The landing COPIES the chosen one into the shop's own table
 * (tier 3) and the shop edits it there; that is why an industry's sample numbers may sit in tier 2
 * while a shop's numbers may not.
 *
 * The files are written by a person, so they are checked at start-up like the industry packs
 * (`selfCheckSellingPriceFiles`): a broken file stops Xeon with the field named, instead of a
 * template that quietly prices every item. Requests read the files again, so an edit shows without
 * a restart; a file broken after start-up loses only its bad entries, and the log says which.
 */

import { checkBlocksFree } from "@sp/brain";
import { COMMON_DATA_FILES, INDUSTRY_FILES, industryIds, readCommonDataJson, readIndustryJson } from "../knowledge/industry-files";
import { cleanPriceRules, type PriceRuleTable } from "./price-rules";
import { priceRulePromptProblems } from "./price-rule-translator";

/** One template as `/kho/mau-bang-gia` serves it. Wire names: the landing reads them. */
export interface PriceTemplate {
  id: string;
  ten: string;
  moTa: string;
  bang: PriceRuleTable;
}

export interface TemplateList {
  mau: PriceTemplate[];
  /** What was wrong with the files, one sentence each. Empty = every entry was served. */
  problems: string[];
}

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

/**
 * Every string of a tier 1–2 file goes through the same checker as the bot's instruction blocks:
 * a shop's own number (a percent, a price written with separators, "n triệu") has no place in a
 * file every shop reads. The table's numbers are JSON NUMBERS — the sample the shop copies — so
 * they are data, not prose, and stay out of this check by construction.
 */
export function proseProblems(raw: unknown, where: string): string[] {
  const found: { id: string; loiDan: string }[] = [];
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") { if (value.trim() !== "") found.push({ id: at, loiDan: value }); return; }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${at}[${i}]`)); return; }
    if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, at === "" ? k : `${at}.${k}`);
  };
  walk(raw, "");
  return checkBlocksFree(found, where);
}

/**
 * The templates of one file. An entry with a problem is left out and its problem said; the
 * others are served. `taken` holds ids already used (platform before industry), so an industry
 * cannot shadow a platform template by reusing its id.
 */
export function parseTemplateFile(raw: unknown, where: string, taken: Set<string> = new Set()): TemplateList {
  if (raw === null || raw === undefined) return { mau: [], problems: [] };
  const file = asRecord(raw);
  if (!Array.isArray(file["mau"])) return { mau: [], problems: [`${where}: thiếu danh sách "mau".`] };
  const problems = proseProblems(raw, where);
  const mau: PriceTemplate[] = [];
  file["mau"].forEach((entry, i) => {
    const o = asRecord(entry);
    const id = text(o["id"], 64);
    const at = `${where}: mau[${i}]${id ? ` ("${id}")` : ""}`;
    const wrong: string[] = [];
    if (!TEMPLATE_ID.test(id)) wrong.push(`${at}: "id" phải là chữ thường, số, gạch ngang.`);
    else if (taken.has(id)) wrong.push(`${at}: "id" trùng một mẫu đã có.`);
    const ten = text(o["ten"], 120);
    if (ten === "") wrong.push(`${at}: thiếu "ten".`);
    if (Object.keys(asRecord(o["bang"])).length === 0) wrong.push(`${at}: thiếu "bang".`);
    const cleaned = cleanPriceRules({ ...asRecord(o["bang"]), ma: "", ten: text(asRecord(o["bang"])["ten"], 80) || ten, nguonMau: id });
    // A correction the cleaner had to make is an authoring error here: the file says something the
    // landing would not do (a hidden line, an unknown condition, a step it has no button for).
    for (const note of cleaned.ghiChu) wrong.push(`${at}: ${note}`);
    if (wrong.length > 0) { problems.push(...wrong); return; }
    taken.add(id);
    mau.push({ id, ten, moTa: text(o["moTa"], 600), bang: cleaned.bang });
  });
  return { mau, problems };
}

/** Reads the templates for one industry: the platform's, then the industry's. */
export class PriceTemplateLibrary {
  /** @param directory the `nganh/` folder; tier 1 is read from `<directory>/../loi-chung/`. */
  constructor(private readonly directory: string) {}

  /** The templates a shop of `industry` is offered. Empty industry = the platform's only. Throws only on unreadable JSON. */
  forIndustry(industry: string): TemplateList {
    const taken = new Set<string>();
    const platform = parseTemplateFile(readCommonDataJson(this.directory, COMMON_DATA_FILES.priceTemplates), `loi-chung/${COMMON_DATA_FILES.priceTemplates}`, taken);
    const own = industry === ""
      ? { mau: [], problems: [] }
      : parseTemplateFile(readIndustryJson(this.directory, industry, INDUSTRY_FILES.priceTemplates), `nganh/${industry}/${INDUSTRY_FILES.priceTemplates}`, taken);
    return { mau: [...platform.mau, ...own.mau], problems: [...platform.problems, ...own.problems] };
  }
}

/**
 * Start-up check of every price-table file: the platform's templates, each industry's, and the
 * prompt of `/kho/bang-gia/hieu-y`. Throws one error listing every problem, naming file and field.
 */
export function selfCheckSellingPriceFiles(directory: string): void {
  const library = new PriceTemplateLibrary(directory);
  const problems = new Set<string>();
  for (const id of ["", ...industryIds(directory)]) for (const p of library.forIndustry(id).problems) problems.add(p);
  const promptFile = `loi-chung/${COMMON_DATA_FILES.priceRulesPrompt}`;
  const prompt = readCommonDataJson(directory, COMMON_DATA_FILES.priceRulesPrompt);
  for (const p of [...priceRulePromptProblems(prompt, promptFile), ...(prompt == null ? [] : proseProblems(prompt, promptFile))]) problems.add(p);
  if (problems.size > 0) throw new Error(`Tep bang gia mau / loi dan bang gia sai:\n- ${[...problems].join("\n- ")}`);
}
