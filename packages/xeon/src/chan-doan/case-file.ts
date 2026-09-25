/**
 * @file ĐÓNG BÀI — turning a real bug into a test that runs forever.
 *
 * This is the compounding step. With many landings the same mistake comes back at another shop, so
 * every case someone had to debug once becomes a fixed case here and is replayed by
 * `luot-that.test.mts` on every `npm test`. A case that stops reproducing is a regression.
 *
 * TWO RULES, both learned from what the dossier is for:
 *
 * 1. THE CASE IS PSEUDONYMISED. A dossier lives 7 or 30 days and then goes; a case file lives in
 *    git forever. Phone numbers and e-mails are replaced by STABLE stand-ins (`pseudonymisePII`) —
 *    stable, not masked, so "the number the customer typed" and "the number the tool was asked
 *    about" stay the same number and the case still reproduces.
 * 2. A CASE IS ONLY SAVED IF IT STILL REPLAYS. `makeCase` replays the pseudonymised dossier before
 *    handing it back and refuses when the answer moved. A case file that does not reproduce the
 *    turn it was cut from is worse than none: it fails for its own reasons forever after.
 */

import path from "node:path";
import { pseudonymisePII } from "@sp/contract";
import { replayTurn } from "./replay";
import type { TurnDossier } from "./turn-dossier";

export const CASE_VERSION = 1;

/**
 * Where case files live: `packages/xeon/test/luot-that`. One source of truth for the tool that
 * writes them and the test that runs them — two copies of this path would drift and the tool would
 * quietly write cases nobody runs.
 */
export const CASE_DIRECTORY = path.join(__dirname, "..", "..", "test", "luot-that");

export interface CaseFile {
  version: typeof CASE_VERSION;
  /** File-name-safe id, also the test's name. */
  ten: string;
  /** Why this case was worth keeping — the one line a reader needs in a year. */
  ghiChu: string;
  taoLuc: string;
  /** Where it came from. The dossier itself is gone by the time anyone reads this. */
  nguon: { shop: string; maHoiThoai: string; stt: number; luc: string };
  /** What the turn must still produce. */
  mongDoi: { traLoi?: string | undefined; viSao?: string | undefined; buoc: string[] };
  luot: TurnDossier;
}

/** Same rule as a dossier folder: safe everywhere, and recognisable. */
export function caseName(value: string): string {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "luot";
}

/**
 * Replaces personal data everywhere in the dossier with stand-ins that line up across every field.
 * One map for the whole dossier: that is what keeps the case reproducing.
 */
export function pseudonymiseDossier(dossier: TurnDossier): TurnDossier {
  const map = new Map<string, string>();
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return pseudonymisePII(value, map);
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(walk);
    const out: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(value as Record<string, unknown>)) out[name] = walk(v);
    return out;
  };
  const clean = walk(dossier) as TurnDossier;
  // The channel id is the customer's handle on Facebook, not free text: give it a stand-in too.
  return { ...clean, nguoi: clean.nguoi === "" ? "" : `nguoi-${caseName(dossier.nguoi).slice(0, 12)}` };
}

export class CaseNotReproducible extends Error {}

/**
 * Cuts a case out of a dossier. Throws `CaseNotReproducible` when the pseudonymised turn no longer
 * replays — better to refuse than to commit a test that was born failing.
 */
export async function makeCase(dossier: TurnDossier, options: { ten?: string | undefined; ghiChu?: string | undefined; luc?: string | undefined } = {}): Promise<CaseFile> {
  if (dossier.agent === undefined) {
    throw new CaseNotReproducible(`Lượt ${dossier.shop}/${dossier.maHoiThoai}#${dossier.stt} do máy luật trả lời — chưa đóng bài được.`);
  }
  const clean = pseudonymiseDossier(dossier);
  const replay = await replayTurn(clean);
  if (!replay.giongNhau) {
    throw new CaseNotReproducible(
      `Sau khi thay dữ liệu cá nhân, lượt không diễn lại đúng nữa (${replay.khac.join("; ")}). `
      + `Không đóng bài: một bài test sinh ra đã sai thì về sau chỉ gây nhiễu.`
    );
  }
  const name = caseName(options.ten ?? `${dossier.shop}-${dossier.maHoiThoai}-${dossier.stt}`);
  return {
    version: CASE_VERSION,
    ten: name,
    ghiChu: options.ghiChu ?? "",
    taoLuc: options.luc ?? new Date().toISOString(),
    nguon: { shop: dossier.shop, maHoiThoai: dossier.maHoiThoai, stt: dossier.stt, luc: dossier.luc },
    mongDoi: { traLoi: replay.goc.traLoi, viSao: replay.goc.viSao, buoc: replay.goc.buoc },
    luot: clean
  };
}

export interface CaseOutcome {
  ten: string;
  dat: boolean;
  /** What differed, when it did. */
  khac: string[];
}

/** Replays one saved case and says whether it still produces what it was cut for. */
export async function runCase(file: CaseFile): Promise<CaseOutcome> {
  const replay = await replayTurn(file.luot);
  const khac: string[] = [...replay.khac];
  // The case also pins what the turn must produce, so an edit to the dossier format cannot quietly
  // change the thing being asserted.
  if (replay.dienLai.traLoi !== file.mongDoi.traLoi) khac.push("khác câu mong đợi");
  if (replay.dienLai.buoc.join(" › ") !== file.mongDoi.buoc.join(" › ")) khac.push("khác chuỗi bước mong đợi");
  return { ten: file.ten, dat: khac.length === 0, khac: [...new Set(khac)] };
}
