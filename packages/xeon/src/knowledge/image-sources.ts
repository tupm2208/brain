/**
 * @file Where a product photo came from, as a tier (04/10/2026 — báo ảnh sai, anh chốt mockup
 * JqdSZxWYSkeGKmsguZqX9K).
 *
 * Every photo the image tool finds carries the page it was taken from. The shop sees that page as a
 * label — Chính hãng / Đại lý / Trang khác — and the "máy nghi" list starts from "Trang khác". Which
 * domains are a brand's own and which are dealers is industry knowledge, so it lives in
 * `nganh/<id>/nguon-anh.json`, never in code; Xeon reads every industry's file and merges them,
 * because the photo library is shared by all shops.
 *
 * Patterns match like the image tool's (`cong-cu-anh/engine/search_images.py` `_url_matches_domain`):
 * from the start of the host or right after a dot, so "on.com" never matches "salomon.com".
 */

import { INDUSTRY_FILES, industryIds, readIndustryJson } from "./industry-files";

export type SourceTier = "chinh" | "daily" | "khac";
export const SOURCE_TIERS: readonly SourceTier[] = ["chinh", "daily", "khac"];

export interface SourceLists {
  /** Brand (lower case) → its own domains. */
  official: Record<string, string[]>;
  dealers: string[];
}

const PATTERN = /^[a-z0-9][a-z0-9.\-/]{1,80}$/;
const MAX_PATTERNS = 500;

/** Lower-case host + path of a URL, without `www.`, query or fragment. "" when it is not a URL. */
export function hostAndPath(url: string): string {
  let text = String(url ?? "").trim().toLowerCase();
  if (text.startsWith("//")) text = `https:${text}`;
  const at = text.indexOf("//");
  if (at < 0) return "";
  text = text.slice(at + 2).split(/[?#]/, 1)[0] ?? "";
  return text.startsWith("www.") ? text.slice(4) : text;
}

/** Lower-case host without `www.`; "" when it is not a URL. */
export function hostOf(url: string): string {
  return hostAndPath(url).split("/", 1)[0] ?? "";
}

export function matchesDomain(url: string, pattern: string): boolean {
  const text = hostAndPath(url);
  const p = pattern.toLowerCase();
  if (!text || !p) return false;
  let from = text.indexOf(p);
  while (from >= 0) {
    if (from === 0 || text[from - 1] === ".") return true;
    from = text.indexOf(p, from + 1);
  }
  return false;
}

/** One industry's file, cleaned. Unknown shapes are reported (start-up refuses a broken file). */
export function parseSourceLists(raw: unknown, where: string): { lists: SourceLists; problems: string[] } {
  const lists: SourceLists = { official: {}, dealers: [] };
  if (raw === null || raw === undefined) return { lists, problems: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { lists, problems: [`${where}: phai la mot doi tuong JSON.`] };
  const root = raw as Record<string, unknown>;
  const problems: string[] = [];
  const clean = (values: unknown, label: string): string[] => {
    if (values === undefined) return [];
    if (!Array.isArray(values)) { problems.push(`${where}: "${label}" phai la danh sach.`); return []; }
    const out: string[] = [];
    for (const value of values) {
      const p = String(value ?? "").trim().toLowerCase();
      if (!PATTERN.test(p)) { problems.push(`${where}: mau "${String(value)}" trong "${label}" khong hop le.`); continue; }
      out.push(p);
    }
    return out;
  };
  const official = root["chinhHang"];
  if (official !== undefined) {
    if (official === null || typeof official !== "object" || Array.isArray(official)) problems.push(`${where}: "chinhHang" phai la { hang: [mau ten mien] }.`);
    else for (const [brand, values] of Object.entries(official as Record<string, unknown>)) {
      const key = brand.trim().toLowerCase();
      if (!key) continue;
      lists.official[key] = clean(values, `chinhHang.${brand}`);
    }
  }
  lists.dealers = clean(root["daiLy"], "daiLy");
  const total = lists.dealers.length + Object.values(lists.official).reduce((n, v) => n + v.length, 0);
  if (total > MAX_PATTERNS) problems.push(`${where}: qua ${MAX_PATTERNS} mau ten mien.`);
  return { lists, problems };
}

/**
 * Every industry's source lists, merged. Re-read at most once a minute: the file is small, an edit
 * applies without a restart, and a burst of lookups does not hit the disk each time.
 */
export class ImageSourceDirectory {
  private cached: { at: number; lists: SourceLists } | null = null;

  constructor(private readonly directory: string | null, private readonly now: () => number = () => Date.now()) {}

  lists(): SourceLists {
    if (this.cached && this.now() - this.cached.at < 60_000) return this.cached.lists;
    const merged: SourceLists = { official: {}, dealers: [] };
    if (this.directory) {
      for (const id of industryIds(this.directory)) {
        let raw: unknown;
        try { raw = readIndustryJson(this.directory, id, INDUSTRY_FILES.imageSources); } catch { continue; }
        const { lists } = parseSourceLists(raw, `nganh/${id}/${INDUSTRY_FILES.imageSources}`);
        for (const [brand, patterns] of Object.entries(lists.official)) merged.official[brand] = [...new Set([...(merged.official[brand] ?? []), ...patterns])];
        merged.dealers = [...new Set([...merged.dealers, ...lists.dealers])];
      }
    }
    this.cached = { at: this.now(), lists: merged };
    return merged;
  }

  /** The tier the lists give a page, before any confirmed mistake lowers it. */
  baseTier(pageUrl: string): SourceTier {
    if (!hostAndPath(pageUrl)) return "khac";
    const lists = this.lists();
    for (const patterns of Object.values(lists.official)) if (patterns.some((p) => matchesDomain(pageUrl, p))) return "chinh";
    if (lists.dealers.some((p) => matchesDomain(pageUrl, p))) return "daily";
    return "khac";
  }
}

/** Start-up check: every industry's `nguon-anh.json` must read cleanly, or Xeon refuses to start. */
export function selfCheckImageSourceFiles(directory: string): void {
  const problems = industryIds(directory).flatMap((id) => parseSourceLists(readIndustryJson(directory, id, INDUSTRY_FILES.imageSources), `nganh/${id}/${INDUSTRY_FILES.imageSources}`).problems);
  if (problems.length > 0) throw new Error(`Danh sach trang nguon anh cua nganh co loi:\n- ${problems.join("\n- ")}`);
}
