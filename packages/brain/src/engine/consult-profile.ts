/**
 * @file The consultation profile of one turn (05/10/2026, phiếu Desk nhóm NHU CẦU / TƯ VẤN).
 *
 * Three lessons of the shoe shop, written as rules for ANY shop:
 *
 * 1. A customer who NAMES an item (a code, a line, an item the catalog resolved, a matched photo, a card
 *    they replied to) has said what they want: the questions that pick an item for a need are not asked
 *    (phiếu 06/09: "<item> <variant>" was asked its profile).
 * 2. An EVERYDAY need ("for school, all-round") is answered with the everyday groups and never with a
 *    specialist's profile or specialist items — unless the session names a specialist need anywhere,
 *    which then wins (phiếu 03/09).
 * 3. A specialist need asks its profile ONCE a session: what the customer's lines (or an inference from their
 *    words) already give is known; what the page already asked is not asked again;
 *    the profile is read from the whole session, not from the message alone, so a short follow-up keeps
 *    it (phiếu 03/09 + 06/09).
 *
 * Every word lives in tier 2 (`pack/consult-profile.ts`, `thuc-the.json` → `hoSoTuVan`); the session is
 * the ONE session of `conversation-state.ts` (the caller passes its lines). Pure: no model, no disk.
 */

import type { ConsultNeed, ConsultNeedKind, ConsultProfileConfig } from "../pack/consult-profile";
import { escapeRe, stripDiacritics } from "./text-analysis";

export type ConsultStatus =
  /** The customer named an item: no profile question, no "which need". */
  | "dich-danh"
  /** An everyday need: offer the everyday groups, no specialist question. */
  | "pho-thong"
  /** A specialist need with every required piece known: offer items now, ask nothing more of it. */
  | "du"
  /** A specialist need with required pieces neither known nor asked yet: ask them (once). */
  | "thieu"
  /** A specialist need whose missing pieces the page ALREADY asked this session: do not ask again; offer by what is known. */
  | "da-hoi"
  /** No need known, and the page already asked which one this session: do not ask again. */
  | "da-hoi-nhu-cau"
  /** No need known, nothing asked yet: the industry's own advice applies (ask the need once). */
  | "chua-ro";

export interface ConsultPiece {
  id: string;
  name: string;
  /** What the customer said (or what the inference stands for). */
  said: string;
  /** The matrix band an inference maps to ("" = read it from `said`). */
  band: string;
  axis: string;
  by: "khach" | "suy-ra" | "phan-tich";
}

export interface ConsultVerdict {
  status: ConsultStatus;
  need: { id: string; name: string; kind: ConsultNeedKind; purpose: string } | null;
  known: ConsultPiece[];
  /** Required pieces neither known nor asked yet. */
  missing: { id: string; name: string }[];
  /** Required pieces not known that the page already asked this session. */
  asked: { id: string; name: string }[];
  /** Regex sources (accent-stripped): a reply sentence matching one asks what must not be asked this turn. */
  noAsk: string[];
  /** Matrix axis → what is known of it, for the line scorer. */
  axes: Record<string, { said: string; band: string }>;
}

export interface ConsultInput {
  /** The customer's lines of the current session, oldest first, the message being answered last. */
  customerLines: readonly string[];
  /** The page's lines (bot and person) of the current session, oldest first. */
  pageLines: readonly string[];
  /** The customer named an item (this turn, or earlier this session and still on it). */
  named: boolean;
  /** LLM#1's `needBrief`, when it ran. */
  analysis?: Readonly<Record<string, unknown>> | null | undefined;
  /** The industry's everyday words for the storefront's groups (`nhomHang.biDanh`): word → group label. */
  groupAliases?: Readonly<Record<string, string>> | undefined;
}

const plain = (text: string): string => stripDiacritics(String(text ?? "")).replace(/\s+/g, " ").trim();
const compile = (pattern: string, flags = ""): RegExp | null => {
  if (pattern === "") return null;
  try { return new RegExp(pattern, flags); } catch { return null; }
};

/** Reads the consultation profile of a turn with an industry's `hoSoTuVan`. */
export class ConsultProfiler {
  constructor(private readonly cfg: ConsultProfileConfig) {}

  get active(): boolean {
    return this.cfg.needs.length > 0;
  }

  assess(input: ConsultInput): ConsultVerdict {
    const verdict: ConsultVerdict = { status: "chua-ro", need: null, known: [], missing: [], asked: [], noAsk: [], axes: {} };
    if (!this.active) return verdict;
    const history = this.cfg.history > 0 ? this.cfg.history : 12;
    const raw = input.customerLines.map((l) => String(l ?? "")).filter((l) => l.trim() !== "").slice(-history);
    const strip = compile(this.cfg.strip, "g");
    const lines = raw.map((l) => { const p = plain(l); return strip !== null ? p.replace(strip, " ").replace(/\s+/g, " ").trim() : p; });
    const page = input.pageLines.map(plain).filter((l) => l !== "");
    const askNeed = compile(this.cfg.askNeed);
    const specialistAsks = this.cfg.needs.filter((n) => n.kind === "chuyen-mon").flatMap((n) => n.fields.map((f) => f.ask)).filter((a) => a !== "");
    const need = this.detectNeed(raw, lines, input.groupAliases ?? {});
    if (need !== null) verdict.need = { id: need.id, name: need.name, kind: need.kind, purpose: need.purpose };

    // 1. A named item: nothing of any profile is asked, nor which need.
    if (input.named) {
      verdict.status = "dich-danh";
      verdict.noAsk = unique([this.cfg.askNeed, ...specialistAsks]);
      return verdict;
    }
    if (need === null) {
      if (askNeed !== null && page.some((l) => askNeed.test(l))) {
        verdict.status = "da-hoi-nhu-cau";
        verdict.noAsk = unique([this.cfg.askNeed]);
      }
      return verdict;
    }
    // 2. An everyday need: the everyday groups, no specialist question.
    if (need.kind === "pho-thong") {
      verdict.status = "pho-thong";
      verdict.noAsk = unique([this.cfg.askNeed, ...specialistAsks]);
      return verdict;
    }
    // 3. A specialist need: what is known, what was asked, what is missing.
    const known = new Map<string, { said: string; band: string; by: "khach" | "suy-ra" | "phan-tich" }>();
    for (const field of need.fields) {
      const re = compile(field.read);
      if (re === null) continue;
      for (const line of lines) { const m = re.exec(line); if (m !== null && m[0].trim() !== "") known.set(field.id, { said: m[0].trim(), band: "", by: "khach" }); }
    }
    const session = lines.join(" \n ");
    for (const inference of need.inferences) {
      const when = compile(inference.when);
      const unless = compile(inference.unless);
      if (when === null || !when.test(session) || (unless !== null && unless.test(session))) continue;
      for (const [fid, value] of Object.entries(inference.sets)) {
        const had = known.get(fid);
        // An inference names the band of a piece the customer gave in words the matrix cannot read.
        if (had === undefined) known.set(fid, { said: value.said, band: value.band, by: "suy-ra" });
        else if (had.band === "" && value.band !== "" && !/\d/.test(had.said)) known.set(fid, { ...had, band: value.band });
      }
    }
    const brief = input.analysis ?? null;
    for (const field of need.fields) {
      if (known.has(field.id) || field.fromAnalysis === "" || brief === null) continue;
      const v = brief[field.fromAnalysis];
      const said = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
      if (said !== "" && !/^(unknown|khong ro|chua ro|none|null)$/i.test(said)) known.set(field.id, { said, band: "", by: "phan-tich" });
    }
    const noAsk: string[] = [this.cfg.askNeed];
    for (const field of need.fields) {
      const k = known.get(field.id);
      const ask = compile(field.ask);
      const pageAsked = ask !== null && page.some((l) => ask.test(l));
      if (k !== undefined) {
        verdict.known.push({ id: field.id, name: field.name, said: k.said, band: k.band, axis: field.axis, by: k.by });
        if (field.axis !== "") verdict.axes[field.axis] = { said: k.said, band: k.band };
        noAsk.push(field.ask);
        continue;
      }
      if (pageAsked) {
        if (field.required) verdict.asked.push({ id: field.id, name: field.name });
        noAsk.push(field.ask);
      } else if (field.required) {
        verdict.missing.push({ id: field.id, name: field.name });
      }
    }
    verdict.status = verdict.missing.length > 0 ? "thieu" : verdict.asked.length > 0 ? "da-hoi" : "du";
    verdict.noAsk = unique(noAsk);
    return verdict;
  }

  /**
   * The need of the session: a specialist need mentioned ANYWHERE in the session wins over an everyday one
   * (the latest-mentioned specialist when there are several); an everyday need only when none is.
   */
  private detectNeed(raw: readonly string[], lines: readonly string[], aliases: Readonly<Record<string, string>>): ConsultNeed | null {
    let specialist: { need: ConsultNeed; at: number } | null = null;
    let everyday: ConsultNeed | null = null;
    for (const need of this.cfg.needs) {
      const when = compile(need.when);
      const words = groupWords(need.groups, aliases);
      let at = -1;
      lines.forEach((line, i) => {
        const original = String(raw[i] ?? "").normalize("NFC").toLowerCase();
        if ((when !== null && when.test(line)) || words.some((w) => w.test(w.flags.includes("u") ? original : line))) at = i;
      });
      if (at < 0) continue;
      if (need.kind === "chuyen-mon") { if (specialist === null || at >= specialist.at) specialist = { need, at }; }
      else if (everyday === null) everyday = need;
    }
    return specialist?.need ?? everyday;
  }
}

/**
 * The words of the storefront groups a need is said with: each label (accent-stripped, on the stripped
 * line), and every everyday word of `nhomHang` that points at one of them — a word typed with accents is
 * matched on the line as typed, one without accents too (an unaccented word never reads its accented look-alike).
 */
function groupWords(groups: readonly string[], aliases: Readonly<Record<string, string>>): RegExp[] {
  if (groups.length === 0) return [];
  const labels = new Set(groups.map(plain).filter((g) => g !== ""));
  const out: RegExp[] = [...labels].map((l) => new RegExp(`(^|[^a-z0-9])${escapeRe(l)}(?![a-z0-9])`));
  for (const [word, target] of Object.entries(aliases)) {
    if (word.startsWith("_") || !labels.has(plain(target))) continue;
    const w = word.normalize("NFC").toLowerCase().trim();
    if (w === "") continue;
    out.push(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "u"));
  }
  return out;
}

function unique(xs: readonly string[]): string[] {
  return [...new Set(xs.filter((x) => x !== ""))];
}
