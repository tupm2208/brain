/**
 * @file LINE DNA — which product line a customer means, what it is for, and which lines to offer
 * for a stated speed × distance (Đ9, ported from Sales Desk `line_dna.js` + `line_fit.js`).
 *
 * This is INDUSTRY KNOWLEDGE, so it lives on Xeon inside a knowledge pack (`industry-packs.ts`);
 * the landing only asks. The engine here is generic: a line has aliases, a purpose, a pace table
 * and a distance table. Running shoes fill them; another industry ships another pack (or none).
 *
 * Rules carried over from Desk, each one a real conversation that went wrong:
 *   - the LONGEST alias wins ("adios pro" beats "adios"), matched on word borders;
 *   - a weak axis makes the whole fit weak: score = min(pace, distance), never an average;
 *   - a size ("size 42") and money ("500k") are never read as a distance;
 *   - a beginner is never offered race / super-trainer lines;
 *   - on a tie, real daily trainers come first, and a list of three keeps one budget line.
 */

export interface LineDna {
  id: string;
  name: string;
  aliases?: string[];
  brand?: string;
  purpose?: string;
  plate?: string;
  level?: string;
  note?: string;
  styleNote?: string;
  equivalents?: string[];
  beginnerAlternative?: string[];
  profile?: string;
  priceTier?: number;
  pace?: Record<string, number>;
  distance?: Record<string, number>;
}

export interface CustomerNeed {
  paceText?: string;
  paceMinutes?: number;
  paceBand?: string;
  distanceText?: string;
  distanceBand?: string;
  /** "new" = just started running. */
  level?: string;
  budgetTier?: number;
  sport?: string;
}

export interface LinePick {
  id: string;
  name: string;
  brand: string;
  score: number;
  priceTier: number;
  note: string;
  plate: string;
  purpose: string;
}

export interface Recommendation {
  picks: LinePick[];
  paceBand: string | null;
  distanceBand: string | null;
  considered: number;
  reason?: string;
}

export function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
    .replace(/[^\w\s.:',/-]/g, " ").replace(/\s+/g, " ").trim();
}

/** "pace 6:30", "6'30", "6 phut 30", "pace tam 6" -> minutes per km. */
export function parsePaceMinutes(text: unknown): number | null {
  const t = normalize(text);
  const m = /(\d{1,2})\s*[:'h]\s*(\d{2})(?!\s*k)/.exec(t) ?? /(\d{1,2})\s*(?:phut|p|')\s*(\d{1,2})?/.exec(t);
  if (m) {
    const min = Number(m[1]);
    const sec = m[2] ? Number(m[2]) : 0;
    if (min >= 3 && min <= 12) return min + sec / 60;
  }
  const r = /pace[^0-9]{0,10}(\d{1,2})(?:[.,](\d))?/.exec(t);
  if (r) {
    const v = Number(r[1]) + (r[2] ? Number(r[2]) / 10 : 0);
    if (v >= 3 && v <= 12) return v;
  }
  return null;
}

const EASY_JOG = /(nhe nhang|nhe thoi|chay nhe|chay cham|cham thoi|cham cham|chay thoi|\d\s*(?:km|k)\s*thoi|the duc|thu gian|giu suc khoe|ren luyen suc khoe|giam can|buoi sang|sang som|di bo|hoi phuc|chay dao|dao bo|chay choi|cho khoe|vua chay vua di)/;
const SPEED_CUE = /(pace|tempo|\bgiai\b|\bdua\b|thi dau|\bsub\s*\d|chay nhanh|toc do|interval|bien toc|\bhm\b|\bfm\b|half|marathon|(?<![\d.,])(?:[6-9]|[1-9]\d{1,2})\s*km(?![a-z\d])|(?<![\d.,])(?:10|15|21|42)\s*k(?![a-z\d]))/;

/** "chạy nhẹ nhàng 5km" is exercise jogging: no pace question, treated as the slowest band. */
export function isEasyJog(text: unknown): boolean {
  const t = normalize(text);
  if (!t || SPEED_CUE.test(t)) return false;
  return EASY_JOG.test(t);
}

export function paceBand(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  if (minutes >= 7) return "p7plus";
  if (minutes >= 6) return "p6_7";
  if (minutes >= 5) return "p5_6";
  if (minutes >= 4.5) return "p430_5";
  if (minutes >= 4) return "p4_430";
  return "sub4";
}

/** Target distance band. Sizes and money are removed first: "size 42" is not a marathon, "500k" is not 500 km. */
export function distanceBand(text: unknown): string | null {
  const t = normalize(text).replace(/\b(size|sz|co|cd)\s*\d{2}(\s*[12]\s*\/?\s*3|[.,]5)?/g, " ");
  const money = t
    .replace(/\b(gia|ship|coc|phi|tien|freeship|con|chi|bot|giam)\s*[^0-9]{0,6}\d[\d.,]*\s*k?\b/g, " ")
    .replace(/\b\d[\d.,]*\s*(d|dong|vnd)\b/g, " ");
  const num = (v: string) => new RegExp(`(?<![\\d.,])${v}\\s*(?:km|k)(?![a-z\\d])`);
  const km = (v: string) => new RegExp(`(?<![\\d.,])${v}\\s*km(?![a-z\\d])`);
  if (/\bfm\b|full marathon|marathon/.test(money) && !/half|ban marathon/.test(money)) return "fm";
  if (num("42").test(money) || /42[.,]195/.test(money)) return "fm";
  if (/\bhm\b|half|ban marathon/.test(money) || num("21").test(money)) return "hm";
  if (num("10").test(money)) return "k10";
  if (num("5").test(money) || num("3").test(money)) return "k5";
  if (/(long ?run|chay dai)/.test(money) || km("20").test(money) || km("25").test(money) || km("30").test(money)) return "long";
  if (/(di bo|hoi phuc|recovery|nhe nhang|walking)/.test(t)) return "easy";
  return null;
}

/** 0..5: the weaker axis decides; a small tie-break by the sum. */
export function fitScore(line: LineDna, pb: string | null, db: string | null): number | null {
  const p = pb ? Number(line.pace?.[pb] ?? 0) : null;
  const d = db ? Number(line.distance?.[db] ?? 0) : null;
  if (p === null && d === null) return null;
  if (p === null) return d;
  if (d === null) return p;
  return Math.min(p, d) + (p + d) / 100;
}

const PURPOSE_RANK: Record<string, number> = { daily: 0, max_cushion: 1, stability: 1, tempo: 2, budget_daily: 3 };
const rankOf = (purpose: string): number => PURPOSE_RANK[purpose] ?? 4;

export class LineKnowledge {
  private readonly lines: LineDna[];

  constructor(lines: readonly LineDna[], private readonly labels: { purpose: Record<string, string>; plate: Record<string, string>; level: Record<string, string> } = { purpose: {}, plate: {}, level: {} }) {
    this.lines = lines.filter((l) => l && typeof l.id === "string" && l.id !== "");
  }

  size(): number {
    return this.lines.length;
  }

  all(): readonly LineDna[] {
    return this.lines;
  }

  byId(id: string): LineDna | null {
    return this.lines.find((l) => l.id === id) ?? null;
  }

  /** The line named in a text: longest alias on word borders. */
  findByText(text: unknown): LineDna | null {
    const padded = ` ${normalize(text)} `;
    if (padded.trim() === "") return null;
    let best: { line: LineDna; length: number } | null = null;
    for (const line of this.lines) {
      for (const alias of [line.name, ...(line.aliases ?? [])]) {
        const a = normalize(alias);
        if (a.length < 3 || !padded.includes(` ${a} `)) continue;
        if (best === null || a.length > best.length) best = { line, length: a.length };
      }
    }
    return best?.line ?? null;
  }

  /** The line with its equivalents and beginner alternatives resolved. */
  resolve(line: LineDna): { line: LineDna; equivalents: LineDna[]; beginnerAlternatives: LineDna[] } {
    const ids = (xs: string[] | undefined) => (xs ?? []).map((id) => this.byId(id)).filter((x): x is LineDna => x !== null);
    return { line, equivalents: ids(line.equivalents), beginnerAlternatives: ids(line.beginnerAlternative) };
  }

  describe(line: LineDna): string {
    const parts = [`${line.name} | nhóm: ${this.labels.purpose[line.purpose ?? ""] ?? line.purpose ?? ""} | ${this.labels.plate[line.plate ?? ""] ?? line.plate ?? ""} | ${this.labels.level[line.level ?? ""] ?? line.level ?? ""}`];
    if (line.note) parts.push(`  ${line.note}`);
    if (line.styleNote) parts.push(`  Góc thời trang: ${line.styleNote}`);
    return parts.join("\n");
  }

  /** Line ids that have stock, from the names of items that still have a size in stock. */
  inStockIds(names: readonly string[]): Set<string> {
    const blob = ` ${names.map(normalize).join(" || ")} `;
    const out = new Set<string>();
    for (const line of this.lines) {
      if ((line.aliases ?? [line.name]).some((a) => { const n = normalize(a); return n.length >= 3 && blob.includes(n); })) out.add(line.id);
    }
    return out;
  }

  /** Lines for a need, only lines with stock, best first (Desk `recommendLines`). */
  recommend(need: CustomerNeed, inStockNames: readonly string[], limit = 2): Recommendation {
    let pb = need.paceBand || paceBand(need.paceMinutes ?? parsePaceMinutes(need.paceText ?? ""));
    if (!pb && isEasyJog(need.paceText || need.distanceText || "")) pb = "p7plus";
    const db = need.distanceBand || distanceBand(need.distanceText ?? "");
    if (!pb && !db) return { picks: [], paceBand: null, distanceBand: null, considered: 0, reason: "chưa có pace/cự ly" };
    const stock = this.inStockIds(inStockNames);
    const scored: LinePick[] = [];
    for (const line of this.lines) {
      if (!line.pace || !line.distance) continue;
      if (line.profile === "casual" || line.purpose === "casual") continue;
      if (need.sport && need.sport !== "running" && line.purpose !== "trail") continue;
      if (!stock.has(line.id)) continue;
      if (need.level === "new" && line.level === "advanced") continue;
      if (need.level === "new" && ["short_race", "race_carbon", "super_trainer"].includes(String(line.purpose))) continue;
      if (need.budgetTier && Number(line.priceTier) > Number(need.budgetTier)) continue;
      const s = fitScore(line, pb, db);
      if (s === null || s < 3) continue;
      scored.push({ id: line.id, name: line.name, brand: line.brand ?? "", score: Math.round(s * 100) / 100, priceTier: Number(line.priceTier ?? 0), note: line.note ?? "", plate: line.plate ?? "", purpose: line.purpose ?? "" });
    }
    scored.sort((a, b) => b.score - a.score || rankOf(a.purpose) - rankOf(b.purpose));
    const picks = scored.slice(0, limit);
    if (limit >= 3 && picks.length === limit && !picks.some((p) => p.purpose === "budget_daily")) {
      const budget = scored.find((p) => p.purpose === "budget_daily");
      if (budget) picks[picks.length - 1] = budget;
    }
    return { picks, paceBand: pb, distanceBand: db, considered: scored.length };
  }

  /** A line out of stock → nearest lines in stock by score vector (Desk `similarInStock`). */
  similarInStock(lineId: string, inStockNames: readonly string[], limit = 2): { id: string; name: string; brand: string; distance: number; priceTier: number; note: string }[] {
    const base = this.byId(lineId);
    if (!base?.pace || !base.distance) return [];
    const stock = this.inStockIds(inStockNames);
    const keysP = Object.keys(base.pace);
    const keysD = Object.keys(base.distance);
    const dist = (l: LineDna): number => {
      let s = 0;
      for (const k of keysP) s += (Number(base.pace?.[k]) - Number(l.pace?.[k] ?? 0)) ** 2;
      for (const k of keysD) s += (Number(base.distance?.[k]) - Number(l.distance?.[k] ?? 0)) ** 2;
      if (String(l.plate) !== String(base.plate)) s += 4;
      if (String(l.level) !== String(base.level)) s += 2;
      return s;
    };
    return this.lines
      .filter((l) => l.id !== lineId && l.pace && l.distance && stock.has(l.id) && l.purpose !== "casual")
      .map((l) => ({ id: l.id, name: l.name, brand: l.brand ?? "", distance: dist(l), priceTier: Number(l.priceTier ?? 0), note: l.note ?? "" }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }
}
