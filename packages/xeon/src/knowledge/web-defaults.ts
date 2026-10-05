/**
 * @file The INDUSTRY's default wording on a shop's website (tier 2, 02/10/2026).
 *
 * A shop that has not written its own sentence for a spot on its website (the "ask us" block, the
 * word for one unit…) gets its industry's sentence, and only then the platform's neutral one. The
 * words live in `nganh/<id>/mac-dinh-web.json`, never in code, so a shoe shop reads about feet and
 * pace while a pharmacy reads nothing of the kind.
 *
 * Xeon only READS and checks the file: which fields exist is the landing's business
 * (`page-content.ts`), so a field added there needs no change here. A broken file stops Xeon at
 * start-up with the file named (`selfCheckWebDefaultFiles`), like every other industry file.
 */

import { checkBlocksFree } from "@sp/brain";
import { INDUSTRY_FILES, industryIds, readIndustryJson } from "./industry-files";

/** A field name the landing could declare: a short identifier, nothing else. */
const FIELD = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const MAX_FIELDS = 40;
const MAX_CHARS = 1000;
/** A Vietnamese phone number, spaces and dots removed: one shop's, never an industry's. */
const PHONE = /(?:\+?84|0)\d{9}(?!\d)/;

export interface WebDefaults {
  /** Field → the industry's sentence. Empty when the industry has no file. */
  noiDungWeb: Record<string, string>;
  /** What is wrong with the file, field by field (start-up refuses a file with problems). */
  problems: string[];
}

/** The industry's web wording, cleaned: string values only, bounded, unknown shapes reported. */
export function parseWebDefaults(raw: unknown, where: string): WebDefaults {
  if (raw === null || raw === undefined) return { noiDungWeb: {}, problems: [] };
  const problems: string[] = [];
  const root = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (root === null) return { noiDungWeb: {}, problems: [`${where}: phai la mot doi tuong JSON.`] };
  const block = root["noiDungWeb"];
  if (block === undefined) return { noiDungWeb: {}, problems: [] };
  if (block === null || typeof block !== "object" || Array.isArray(block)) return { noiDungWeb: {}, problems: [`${where}: "noiDungWeb" phai la mot doi tuong { truong: "cau" }.`] };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    if (!FIELD.test(key)) { problems.push(`${where}: ten truong "${key}" khong hop le.`); continue; }
    if (typeof value !== "string") { problems.push(`${where}: truong "${key}" phai la chu.`); continue; }
    const text = value.trim();
    if (text.length > MAX_CHARS) { problems.push(`${where}: truong "${key}" dai qua ${MAX_CHARS} ky tu.`); continue; }
    if (Object.keys(out).length >= MAX_FIELDS) { problems.push(`${where}: qua ${MAX_FIELDS} truong.`); break; }
    if (text) out[key] = text;
  }
  // The same checker the agent blocks go through: no one shop's number may hide in an industry sentence —
  // and no phone number either (it checks money and percentages only).
  problems.push(...checkBlocksFree(Object.entries(out).map(([id, loiDan]) => ({ id, loiDan })), where));
  for (const [key, value] of Object.entries(out)) {
    if (PHONE.test(value.replace(/[\s.\-]/g, ""))) problems.push(`${where}: truong "${key}" chua so dien thoai — so cua shop nam o Thong tin shop, khong o nganh.`);
  }
  return { noiDungWeb: out, problems };
}

/** Reads the web wording of each industry, every call (the file is small; an edit applies at once). */
export class WebDefaultsLibrary {
  constructor(private readonly directory: string) {}

  forIndustry(industry: string): WebDefaults {
    if (!industry) return { noiDungWeb: {}, problems: [] };
    return parseWebDefaults(readIndustryJson(this.directory, industry, INDUSTRY_FILES.webDefaults), `nganh/${industry}/${INDUSTRY_FILES.webDefaults}`);
  }
}

/** Start-up check: every industry's file must read cleanly, or Xeon refuses to start and names it. */
export function selfCheckWebDefaultFiles(directory: string): void {
  const library = new WebDefaultsLibrary(directory);
  const problems = industryIds(directory).flatMap((id) => library.forIndustry(id).problems);
  if (problems.length > 0) throw new Error(`Cau chu mac dinh cua nganh tren web co loi:\n- ${problems.join("\n- ")}`);
}
