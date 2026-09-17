/**
 * @file SAMPLE PROFILES — the reference profile of each product line, and everything Sales Desk did
 * to them (Đ9, ported from `app.js` sampleProfile* / applyResearchTextToSampleProfile /
 * publishSampleProfilesToCatalog). Pure functions over plain objects: the store and the HTTP door
 * are elsewhere.
 *
 * What is industry-specific (the model names that carry a version, the nine evaluation tables of a
 * running shoe, the research prompt) comes from the knowledge pack; the mechanics are shared.
 *
 * Kept from Desk on purpose:
 *   - merging keeps the TARGET's fields and unions keywords / source codes / references;
 *   - "consolidate" keeps the profile with the most information in each model+version group;
 *   - parsing research never throws away what the operator typed — lists are merged, notes kept;
 *   - publishing a profile still `pending_review` marks it approved: pressing publish IS the review.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- profiles are operator-edited JSON documents */
export type Profile = Record<string, any>;

/** The industry-specific part the mechanics need. */
export interface ProfileKitOptions {
  /** Model names that must carry a version number ("boston" → "boston 13"). Normalised, no accents. */
  versionedModels: readonly string[];
  /** Evaluation tables: section key → rows [label, score key or "", note]. */
  evaluationRows: Record<string, readonly (readonly [string, string, string])[]>;
  /** Research prompt per family (`running` …). `{{profileName}}`, `[TÊN GIÀY]`, … are replaced. */
  researchPrompts: Record<string, string>;
  /** Family guessed from category / use cases / name. */
  familyPatterns: readonly (readonly [string, RegExp])[];
  /** Brand prefixes stripped from a canonical model id. */
  brandPrefixes: readonly string[];
  /** Default product category of a line created from a profile. */
  defaultCategory: string;
}

const SECTION_KEYS = ["classification", "weight", "pace", "distance", "level", "footType", "purpose"] as const;

export const text = (v: unknown): string => String(v ?? "").trim();
export const plain = (v: unknown): string => text(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
const list = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/)).map((x) => text(x)).filter(Boolean);
const uniq = (xs: unknown[]): string[] => [...new Set(xs.map((x) => text(x)).filter(Boolean))];
const obj = (v: unknown): Profile => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Profile) : {});
const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Line id as Desk's `normalizeCatalogLineId`: accents off, lower-case, hyphens. */
export function lineId(value: unknown): string {
  return plain(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

export class SampleProfileKit {
  constructor(private readonly options: ProfileKitOptions) {}

  /** Research families that have their own expert prompt. */
  specialisedFamilies(): string[] {
    return Object.keys(this.options.researchPrompts);
  }

  // ------------------------------------------------------------ defaults

  defaultPaceDistanceScores(scores: Profile = {}, filters: Profile = {}): Profile {
    const active = new Set<string>(list(filters["distanceBands"]));
    const isTrail = Number(scores["trail"] ?? 0) >= 7 || active.has("trail");
    const n = (k: string) => Number(scores[k] ?? 0);
    const easyBase = Math.max(n("daily"), n("beginner"), n("comfort"));
    const moderateBase = Math.max(n("daily"), n("longRun"), n("speed"));
    const fastBase = Math.max(n("speed"), n("race"));
    const out: Profile = {};
    for (const d of ["3k_5k", "5k_10k", "10k_half", "marathon", "trail"]) {
      if (d === "trail") { out[d] = { easy: isTrail ? n("trail") : 0, moderate: isTrail ? Math.max(n("trail"), n("stability")) : 0, fast: isTrail ? Math.max(n("race"), n("trail")) : 0 }; continue; }
      const on = active.has(d) || ((d === "3k_5k" || d === "5k_10k") && active.has("3k_10k"));
      out[d] = on || active.size === 0 ? { easy: easyBase, moderate: moderateBase, fast: fastBase } : { easy: 0, moderate: 0, fast: 0 };
    }
    return out;
  }

  defaultEvaluationRows(section: string, scores: Profile = {}): Profile[] {
    return (this.options.evaluationRows[section] ?? []).map(([label, key, note]) => ({ label, score: key ? Number(scores[key] ?? 0) : 0, note }));
  }

  defaultEvaluationTables(profile: Profile): Profile {
    const scores = obj(profile["scores"]);
    const tables: Profile = {};
    for (const key of SECTION_KEYS) tables[key] = this.defaultEvaluationRows(key, scores);
    const existing = obj(profile["evaluationTables"]);
    tables["comparison"] = Array.isArray(existing["comparison"]) && existing["comparison"].length > 0 ? existing["comparison"] : [
      { label: "Mẫu cùng hãng", group: "Cùng hãng", note: "Đang cập nhật so sánh chi tiết." },
      { label: "Mẫu khác hãng", group: "Khác hãng", note: "Đang cập nhật so sánh chi tiết." },
      { label: "Mẫu cùng giá", group: "Cùng giá", note: "Đang cập nhật so sánh chi tiết." }
    ];
    return tables;
  }

  /** Operator values win; rows the template has and the profile lacks are added; extra operator rows are kept. */
  mergeTables(existing: Profile, fallback: Profile): Profile {
    const mergeRows = (old: unknown, base: unknown, noteKey = "note"): Profile[] => {
      const have = Array.isArray(old) ? (old as Profile[]) : [];
      const byLabel = new Map(have.map((r) => [plain(r["label"] ?? r["name"]), r]));
      const merged = (Array.isArray(base) ? (base as Profile[]) : []).map((row) => {
        const o = byLabel.get(plain(row["label"] ?? row["name"]));
        if (!o) return row;
        return { ...row, ...o, label: o["label"] || row["label"], score: o["score"] !== undefined && o["score"] !== null && o["score"] !== "" ? o["score"] : row["score"], [noteKey]: text(o[noteKey]) ? o[noteKey] : row[noteKey] ?? "" };
      });
      for (const r of have) {
        const label = plain(r["label"] ?? r["name"]);
        if (label && !merged.some((m) => plain(m["label"] ?? m["name"]) === label)) merged.push(r);
      }
      return merged;
    };
    const next: Profile = {};
    for (const key of SECTION_KEYS) next[key] = mergeRows(existing[key], fallback[key]);
    next["comparison"] = mergeRows(existing["comparison"], fallback["comparison"]);
    return next;
  }

  /** Desk `sampleProfile()` + `normalizeSampleProfileForEditor`: every field the screens read exists. */
  normalize(input: Profile, now: string): Profile {
    const name = text(input["name"]) || text(input["id"]);
    const id = text(input["id"]) || lineId(name);
    const scores = obj(input["scores"]);
    const filters = obj(input["filters"]);
    const fit = obj(input["fitSizing"]);
    const intro = `${name || "Dòng sản phẩm"} là dòng ${text(input["category"])} dùng để lọc nhu cầu, mục tiêu sử dụng, fit-size và tồn kho.`;
    const base: Profile = {
      version: 1, status: "draft_reference", ...input, id, name,
      keywords: list(input["keywords"]).length ? list(input["keywords"]) : [name].filter(Boolean),
      useCases: list(input["useCases"]), bestFor: list(input["bestFor"]), avoidFor: list(input["avoidFor"]),
      scores, filters,
      paceDistanceScores: Object.keys(obj(input["paceDistanceScores"])).length ? input["paceDistanceScores"] : this.defaultPaceDistanceScores(scores, filters),
      productDefaults: { productLine: name, brand: text(input["brand"]), category: this.options.defaultCategory, gender: "unisex", source: "template", status: "orderable", priority: 2, ...obj(input["productDefaults"]) },
      webContent: {
        title: name, shortDescription: intro, intro, features: list(input["bestFor"]), technologies: list(input["technologies"]),
        bestFor: list(input["bestFor"]), notFor: list(input["avoidFor"]), fitGuide: text(fit["widthProfile"]), sizeNote: text(fit["sizingNote"]), careNote: "", comparisonNote: "",
        ...obj(input["webContent"])
      },
      seo: { title: name, description: intro, keywords: list(input["keywords"]), ...obj(input["seo"]) },
      media: { imageUrl: "", gallery: [], ...obj(input["media"]) },
      policy: { salesNote: "Profile mẫu để tham khảo. Khi bán vẫn cần kiểm tồn, giá và size thực tế.", sourceDisclosure: "", ...obj(input["policy"]) },
      sourceReferences: Array.isArray(input["sourceReferences"]) ? input["sourceReferences"] : [{ sourceName: "RunRepeat", url: text(input["runrepeatUrl"]), usedFor: "classification_reference", summary: text(input["sourceSummary"]) }],
      fitSizing: { measurementStatus: "pending_measurement", requiredMeasurements: ["inside_length_mm", "forefoot_width_mm", "midfoot_width_mm", "heel_width_mm", "instep_height_mm"], ...fit },
      updatedAt: text(input["updatedAt"]) || now
    };
    base["evaluationTables"] = this.mergeTables(obj(input["evaluationTables"]), this.defaultEvaluationTables(base));
    return base;
  }

  // ------------------------------------------------------------ versions, duplicates

  modelVersion(value: unknown): string {
    const models = this.options.versionedModels.map(escapeRe).join("|");
    if (!models) return "";
    return new RegExp(`\\b(?:${models})\\s*(\\d{1,2})(?:w|m)?\\b`, "i").exec(plain(value))?.[1] ?? "";
  }

  needsVersion(profile: Profile): boolean {
    const t = plain(profile["name"]);
    if (this.modelVersion(t)) return false;
    const models = this.options.versionedModels.map(escapeRe).join("|");
    return models !== "" && new RegExp(`\\b(?:${models})\\b`).test(t);
  }

  modelNameWithVersion(value: unknown): string {
    const t = text(value).replace(/\badzero\b/gi, "adizero");
    const models = [...this.options.versionedModels].sort((a, b) => b.length - a.length).map((m) => escapeRe(m).replace(/\\? /g, "[\\s-]?"));
    for (const m of models) {
      const hit = new RegExp(`\\b(?:[a-z]+\\s+){0,2}${m}\\s+\\d{1,2}(?:w|m)?\\b`, "i").exec(t);
      if (hit) return hit[0].replace(/(\d)(?:w|m)$/i, "$1");
    }
    return t;
  }

  canonicalModelId(value: unknown): string {
    let id = lineId(this.modelNameWithVersion(value));
    for (const prefix of this.options.brandPrefixes) if (id.startsWith(`${prefix}-`)) id = id.slice(prefix.length + 1);
    return id.replace(/^adizero-/, "");
  }

  canonicalProfileId(profile: Profile): string {
    return this.canonicalModelId(text(profile["name"]).replace(/^[\s_-]*(?:(?:giày|giay)\s+)?(?:(?:chạy|chay)\s+)?(?:(?:bộ|bo)\s+)?/i, ""));
  }

  completeness(profile: Profile): { status: "empty" | "missing" | "pending_review" | "complete"; missing: string[] } {
    const missing: string[] = [];
    if (this.needsVersion(profile)) missing.push("modelVersion");
    if (!profile["researchSourceText"] && !obj(profile["reviewSummary"])["toprunReview"]) missing.push("research");
    if (Object.values(obj(profile["technicalSpecs"])).filter(Boolean).length < 4) missing.push("technicalSpecs");
    if (!(list(profile["technologies"]).length || list(obj(profile["webContent"])["technologies"]).length)) missing.push("technologies");
    if (Object.values(obj(profile["scores"])).filter((v) => Number(v) > 0).length < 5) missing.push("scores");
    if (Object.keys(obj(profile["paceDistanceScores"])).length === 0) missing.push("paceDistanceScores");
    if (!list(profile["bestFor"]).length) missing.push("bestFor");
    if (!list(profile["avoidFor"]).length) missing.push("avoidFor");
    if (!(Array.isArray(obj(profile["reviewSummary"])["faq"]) && obj(profile["reviewSummary"])["faq"].length)) missing.push("faq");
    if (profile["researchStatus"] === "pending_review") return { status: "pending_review", missing };
    if (missing.length >= 6) return { status: "empty", missing };
    if (missing.length) return { status: "missing", missing };
    return { status: "complete", missing: [] };
  }

  duplicateSummary(profiles: Profile[]): { groups: number; duplicateProfiles: number } {
    const counts = new Map<string, number>();
    for (const p of profiles) {
      const id = this.canonicalProfileId(p);
      if (!id || !this.modelVersion(p["name"])) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const dup = [...counts.values()].filter((c) => c > 1);
    return { groups: dup.length, duplicateProfiles: dup.reduce((s, c) => s + c - 1, 0) };
  }

  informationScore(profile: Profile): number {
    return (8 - this.completeness(profile).missing.length) * 100
      + Object.values(obj(profile["technicalSpecs"])).filter(Boolean).length * 5
      + text(obj(profile["reviewSummary"])["toprunReview"]).length / 100
      + list(profile["sourceProductCodes"]).length;
  }

  /** Merge `ids` into `targetId`; the others disappear. Returns the new list and the merged count. */
  merge(profiles: Profile[], ids: string[], targetId: string, now: string): { profiles: Profile[]; merged: number; target: Profile | null; removed: string[] } {
    const wanted = new Set(ids);
    const selected = profiles.filter((p) => wanted.has(p["id"]));
    if (selected.length < 2) return { profiles, merged: 0, target: null, removed: [] };
    const target = selected.find((p) => p["id"] === targetId) ?? selected[0]!;
    const others = selected.filter((p) => p["id"] !== target["id"]);
    const merged: Profile = {
      ...target,
      keywords: uniq(selected.flatMap((p) => [...list(p["keywords"]), p["name"]])),
      sourceProductCodes: uniq(selected.flatMap((p) => list(p["sourceProductCodes"]))),
      sourceWarehouses: uniq(selected.flatMap((p) => list(p["sourceWarehouses"]))),
      sourceReferences: selected.flatMap((p) => (Array.isArray(p["sourceReferences"]) ? p["sourceReferences"] : [])),
      technicalSpecs: Object.assign({}, ...selected.slice().reverse().map((p) => obj(p["technicalSpecs"]))),
      technologies: uniq(selected.flatMap((p) => [...list(p["technologies"]), ...list(obj(p["webContent"])["technologies"])])),
      bestFor: uniq(selected.flatMap((p) => list(p["bestFor"]))),
      avoidFor: uniq(selected.flatMap((p) => list(p["avoidFor"]))),
      updatedAt: now
    };
    const removed = others.map((p) => String(p["id"]));
    return { profiles: profiles.filter((p) => !removed.includes(p["id"])).map((p) => (p["id"] === target["id"] ? merged : p)), merged: others.length, target: merged, removed };
  }

  /** Every model+version group with more than one profile is merged into its richest profile. */
  consolidate(profiles: Profile[], now: string): { profiles: Profile[]; merged: number; removed: string[]; renamed: Record<string, string> } {
    const groups = new Map<string, Profile[]>();
    for (const p of profiles) {
      const id = this.canonicalProfileId(p);
      if (!id || !this.modelVersion(p["name"])) continue;
      groups.set(id, [...(groups.get(id) ?? []), p]);
    }
    let current = profiles;
    let merged = 0;
    const removed: string[] = [];
    const renamed: Record<string, string> = {};
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const target = [...group].sort((a, b) => this.informationScore(b) - this.informationScore(a))[0]!;
      const r = this.merge(current, group.map((p) => String(p["id"])), String(target["id"]), now);
      current = r.profiles;
      merged += r.merged;
      for (const id of r.removed) { removed.push(id); renamed[id] = String(target["id"]); }
    }
    return { profiles: current, merged, removed, renamed };
  }

  /** Line name of a catalogue item (Desk `catalogSampleGroupName`). */
  catalogGroupName(product: Profile): string {
    let name = text(product["ten"] ?? product["name"]);
    for (const v of [product["ma"] ?? product["code"], product["sku"], product["mau"] ?? product["color"]].map(text).filter(Boolean)) name = name.replace(new RegExp(escapeRe(v), "ig"), " ");
    const version = this.modelVersion(name);
    const explicit = text(product["dong"] ?? product["productLine"]);
    if (explicit && !/^generic\b/.test(plain(explicit))) {
      if (this.modelVersion(explicit) || !version) return explicit;
      return `${explicit} ${version}`.trim();
    }
    const cleaned = name.replace(/\([^)]*\)/g, " ").replace(/^[\s_-]*(?:(?:giày|giay)\s+)?(?:(?:chạy|chay)\s+)?(?:(?:bộ|bo)\s+)?/i, "")
      .replace(/\b(?:size|sz)\s*[\d.]+\b/gi, " ").replace(/\b(?:nam|nu|nữ|men|women|unisex)\b/gi, " ").replace(/\s+[-/|]\s*$/g, " ").replace(/\s{2,}/g, " ").trim();
    return this.modelNameWithVersion(cleaned);
  }

  family(profile: Profile): string {
    if (text(profile["researchFamily"])) return lineId(profile["researchFamily"]);
    const t = plain([profile["category"], obj(profile["productDefaults"])["category"], obj(profile["filters"])["terrain"], ...list(profile["useCases"]), profile["name"]].join(" "));
    for (const [family, re] of this.options.familyPatterns) if (re.test(t)) return family;
    return "other";
  }

  /** New profiles for catalogue lines that have none; then duplicates are consolidated. */
  mergeCatalog(profiles: Profile[], products: Profile[], now: string): { profiles: Profile[]; groups: number; created: number; consolidated: number; renamed: Record<string, string> } {
    const existing = new Set(profiles.map((p) => this.canonicalModelId(p["name"] ?? p["id"])));
    const groups = new Map<string, { name: string; items: Profile[] }>();
    for (const product of products) {
      const name = this.catalogGroupName(product);
      const id = this.canonicalModelId(name);
      if (!id || id.length < 3) continue;
      const g = groups.get(id) ?? { name, items: [] };
      g.items.push(product);
      groups.set(id, g);
    }
    const created: Profile[] = [];
    for (const [id, g] of groups) {
      if (existing.has(id)) continue;
      const ref = g.items.find((p) => text(p["nguon"]) === "own") ?? g.items[0] ?? {};
      const brand = text(ref["hang"] ?? ref["brand"]);
      created.push(this.normalize({
        id, name: g.name, brand, category: text(ref["loai"] ?? ref["category"]),
        keywords: uniq([g.name, ...g.items.map((p) => p["dong"] || p["ten"] || p["name"])]).slice(0, 12),
        sourceProductCodes: uniq(g.items.map((p) => p["ma"] ?? p["code"])).slice(0, 40),
        sourceWarehouses: uniq(g.items.map((p) => p["nguon"] ?? p["source"])),
        referenceProductCode: text(ref["ma"] ?? ref["code"]), researchStatus: "not_started",
        fitSizing: { measurementStatus: "pending_measurement", sizingNote: "" },
        productDefaults: { productLine: g.name, brand, category: text(ref["loai"]) || this.options.defaultCategory, gender: "unisex", priority: 2 },
        createdAt: now, updatedAt: now
      }, now));
    }
    const all = [...profiles, ...created];
    const c = this.consolidate(all, now);
    return { profiles: c.profiles, groups: groups.size, created: created.length, consolidated: c.merged, renamed: c.renamed };
  }

  // ------------------------------------------------------------ research

  researchPrompt(profile: Profile, generalTemplate: string): { prompt: string; family: string; template: string } {
    const family = this.family(profile);
    const specialised = this.options.researchPrompts[family] ?? "";
    const template = specialised || generalTemplate;
    const missing = this.completeness(profile).missing.join(", ") || "Kiểm tra và bổ sung các thông tin chưa chính xác";
    const existing = JSON.stringify({
      name: profile["name"], brand: profile["brand"], category: profile["category"], useCases: profile["useCases"], keywords: profile["keywords"],
      technicalSpecs: profile["technicalSpecs"], technologies: profile["technologies"] ?? obj(profile["webContent"])["technologies"], scores: profile["scores"], fitSizing: profile["fitSizing"]
    }, null, 2);
    const name = text(profile["name"]) || text(profile["id"]);
    const prompt = template.replaceAll("[TÊN GIÀY]", name).replaceAll("[TEN GIAY]", name).replaceAll("{{profileName}}", name)
      .replaceAll("{{brand}}", text(profile["brand"])).replaceAll("{{existingData}}", existing).replaceAll("{{missingFields}}", missing)
      + `\n\n---\n# DỮ LIỆU ĐANG CÓ\n${existing}\n\n# CÁC PHẦN CẦN ƯU TIÊN BỔ SUNG\n${missing}`;
    return { prompt, family, template: specialised ? family : "general" };
  }

  /** Desk `applyResearchTextToSampleProfile`: research prose → specs, scores, lists, article, FAQ. */
  applyResearch(profile: Profile, raw: string, now: string): Profile {
    const t = String(raw ?? "").replace(/\r/g, "").replace(/ /g, " ").trim();
    const sections = researchSections(t);
    const specs = extractSpecs(t);
    const scores = { ...obj(profile["scores"]), ...extractScores(t) };
    const technologies = extractTechnologies(t);
    const article = buildArticle(profile, t);
    const bestFor = uniq([...extractList(t, ["Ai nên mua", "NÊN MUA", "Ai nen mua"]), ...list(profile["bestFor"])]).slice(0, 8);
    const avoidFor = uniq([...extractList(t, ["Ai không nên mua", "KHÔNG NÊN MUA", "Khong nen mua"]), ...list(profile["avoidFor"])]).slice(0, 8);
    const web = obj(profile["webContent"]);
    const next: Profile = {
      ...profile,
      scores,
      paceDistanceScores: extractPaceDistance(t) ?? profile["paceDistanceScores"] ?? {},
      technicalSpecs: { ...obj(profile["technicalSpecs"]), ...specs },
      technologies: technologies.length ? technologies : list(profile["technologies"]),
      bestFor, avoidFor,
      researchSourceText: t,
      webContent: {
        ...web, article, intro: article.split(/\n{2,}/)[0] || web["intro"] || "", shortDescription: web["shortDescription"] || article.split(/\n{2,}/)[0] || "",
        technologies: technologies.length ? technologies : list(web["technologies"]), bestFor, notFor: avoidFor
      },
      reviewSummary: {
        ...obj(profile["reviewSummary"]), toprunReview: article, faq: extractFaq(t),
        deepSections: buildDeepSections(sections)
      },
      updatedAt: now
    };
    next["evaluationTables"] = this.mergeTables(obj(profile["evaluationTables"]), this.defaultEvaluationTables(next));
    return next;
  }

  // ------------------------------------------------------------ publish

  matchesProduct(profile: Profile, product: Profile): boolean {
    return this.matchLength(profile, product) > 0;
  }

  /** Length of the longest keyword of the profile found in the product text (0 = no match). Longest wins: "boston 13" beats "boston". */
  matchLength(profile: Profile, product: Profile): number {
    const t = plain([product["ten"] ?? product["name"], product["ma"] ?? product["code"], product["hang"] ?? product["brand"], product["dong"] ?? product["productLine"]].join(" "));
    const keywords = list(profile["keywords"]).length ? list(profile["keywords"]) : [text(profile["name"])];
    let best = 0;
    for (const k of [...keywords, text(profile["name"])]) { const n = plain(k); if (n.length >= 3 && n.length > best && t.includes(n)) best = n.length; }
    return best;
  }

  /** The shared product line a profile becomes on the landing (Desk `sampleProfileToProductLine`). */
  toProductLine(profile: Profile, now: string): Profile {
    const id = lineId(profile["id"] || profile["name"]);
    const web = obj(profile["webContent"]);
    return {
      id, ten: text(profile["name"]) || id, hang: text(profile["brand"]), loai: text(profile["category"]),
      tuKhoa: list(profile["keywords"]).length ? list(profile["keywords"]) : [text(profile["name"])].filter(Boolean),
      gioiThieu: text(web["intro"] || web["shortDescription"]), baiViet: text(web["article"]), moTaNgan: text(web["shortDescription"] || web["intro"]),
      tinhNang: list(web["features"]).length ? list(web["features"]) : list(profile["bestFor"]), congNghe: list(web["technologies"]),
      phuHop: list(web["bestFor"]).length ? list(web["bestFor"]) : list(profile["bestFor"]), khongHop: list(web["notFor"]).length ? list(web["notFor"]) : list(profile["avoidFor"]),
      huongDanFit: text(web["fitGuide"] || obj(profile["fitSizing"])["widthProfile"]), ghiChuSize: text(web["sizeNote"] || obj(profile["fitSizing"])["sizingNote"]),
      seo: obj(profile["seo"]), maMau: text(profile["referenceProductCode"]), nguon: "san-pham-mau", maHoSo: text(profile["id"]),
      danhGia: {
        diem: obj(profile["scores"]), diemTocDoCuLy: obj(profile["paceDistanceScores"]), bang: this.mergeTables(obj(profile["evaluationTables"]), this.defaultEvaluationTables(profile)),
        locNhanh: obj(profile["filters"]), thongSo: obj(profile["technicalSpecs"]), fitSize: obj(profile["fitSizing"]),
        danhGia: obj(profile["reviewSummary"]), phanLoai: { category: text(profile["category"]), useCases: list(profile["useCases"]) }, trangThai: text(profile["status"]) || "draft_reference"
      },
      capNhatLuc: now
    };
  }
}

// -------------------------------------------------------------- research text parsing (Desk, unchanged rules)

function researchSections(t: string): { title: string; lines: string[] }[] {
  const sections: { title: string; lines: string[] }[] = [];
  let current = { title: "Tổng quan", lines: [] as string[] };
  for (const line of t.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const heading = /^(BƯỚC|BUOC|###|##|TỔNG|TOM|ĐÁNH|DANH|ƯU|UU|NHƯỢC|NHUOC|FAQ|KẾT|KET|SO SÁNH|SO SANH)/i.test(line) || /^[0-9]+\.\s+/.test(line);
    if (heading && current.lines.length) { sections.push(current); current = { title: line.replace(/^#+\s*/, ""), lines: [] }; }
    else if (heading) current.title = line.replace(/^#+\s*/, "");
    else current.lines.push(line);
  }
  if (current.lines.length) sections.push(current);
  return sections;
}

const SPEC_LABELS: Record<string, string[]> = {
  version: ["Phiên bản / Năm ra mắt", "Phien ban / Nam ra mat"], segment: ["Phân khúc", "Phan khuc"],
  weightMen: ["Trọng lượng nam", "Trong luong nam"], weightWomen: ["Trọng lượng nữ", "Trong luong nu"], drop: ["Drop", "Độ dốc", "Do doc"],
  heelStack: ["Stack Height Gót", "Stack Height Got"], forefootStack: ["Stack Height Mũi", "Stack Height Mui"], midsole: ["Loại Foam", "Loai Foam", "Bọt đệm", "Bot dem"],
  plate: ["Loại Plate", "Loai Plate", "Đĩa đệm", "Dia dem"], upper: ["Upper", "Thân trên", "Than tren"], outsole: ["Outsole", "Đế ngoài", "De ngoai"], durability: ["Tuổi thọ dự kiến", "Tuoi tho du kien"]
};

function extractSpecs(t: string): Record<string, string> {
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const specs: Record<string, string> = {};
  for (const [key, names] of Object.entries(SPEC_LABELS)) {
    const i = lines.findIndex((l) => names.some((n) => plain(l).includes(plain(n))));
    if (i < 0) continue;
    // "Drop: 6mm" on one line, or the label then the value on the next line (a table pasted from DOCX).
    const same = lines[i]!.split(/[:|]/).slice(1).join(":").trim();
    const value = same || (lines[i + 1] ?? "").replace(/^[:|\-\s]+/, "").trim();
    if (value) specs[key] = value.slice(0, 200);
  }
  return specs;
}

const SCORE_NAMES: Record<string, string[]> = {
  comfort: ["Độ êm", "Cushioning"], bounce: ["Độ nảy", "Bounce"], stability: ["Độ ổn định", "Stability"], flexibility: ["Độ linh hoạt", "Flexibility"],
  breathability: ["Độ thoáng khí", "Breathability"], durability: ["Độ bền", "Durability"], grip: ["Độ bám", "Grip"],
  energyReturn: ["Hoàn trả năng lượng", "Hoan tra nang luong"], value: ["Value for Money", "Giá trị"], versatility: ["Độ đa dụng", "Versatility"]
};

function extractScores(t: string): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [key, names] of Object.entries(SCORE_NAMES)) {
    for (const name of names) {
      const m = new RegExp(`${escapeRe(name)}[^\\n]{0,80}?([0-9]+(?:[.,][0-9]+)?)\\s*\\/\\s*10`, "i").exec(t);
      if (m) { scores[key] = Number(m[1]!.replace(",", ".")); break; }
    }
  }
  return scores;
}

function extractPaceDistance(t: string): Profile | null {
  if (![/> 7:00|trên 7:00|tren 7:00/i, /6:00\s*-\s*7:00/i, /5:00\s*-\s*6:00/i, /4:00\s*-\s*5:00/i, /< 4:00|dưới 4:00|duoi 4:00/i].some((re) => re.test(t))) return null;
  return { "3k_5k": { easy: 6, moderate: 8.5, fast: 9.5 }, "5k_10k": { easy: 7, moderate: 9, fast: 9.5 }, "10k_half": { easy: 7, moderate: 8.5, fast: 9 }, marathon: { easy: 6, moderate: 7.5, fast: 7.5 }, trail: { easy: 0, moderate: 0, fast: 0 } };
}

function extractTechnologies(t: string): string[] {
  const out: string[] = [];
  const lower = t.toLowerCase();
  for (const [needle, label] of [["Lightstrike Pro", "100% Lightstrike Pro full-length"], ["No Plate", "No carbon plate / no EnergyRods"], ["Rocker", "Rocker geometry và toe-spring hỗ trợ chuyển bước"], ["Engineered Mesh", "Engineered mesh upper mỏng nhẹ"], ["Liquid Rubber", "Liquid/Textured rubber outsole"], ["Continental", "Đế Continental"], ["carbon", "Tấm carbon"], ["ZoomX", "ZoomX foam"], ["FF BLAST", "FF BLAST foam"], ["PEBA", "PEBA foam"]] as const) {
    if (lower.includes(needle.toLowerCase()) && !out.includes(label)) out.push(label);
  }
  return out;
}

function paragraphAround(t: string, keys: string[]): string {
  const paragraphs = t.split(/\n{2,}|\n(?=[A-ZÀ-Ỵ0-9])/).map((p) => p.trim()).filter((p) => p.length > 80);
  return paragraphs.find((p) => keys.some((k) => plain(p).includes(plain(k)))) ?? "";
}

function buildArticle(profile: Profile, t: string): string {
  const name = text(profile["name"]) || "Dòng sản phẩm";
  const summary = paragraphAround(t, ["TÓM TẮT", "TOM TAT", "Tổng quan", "Tong quan"]) || `${name} là dòng sản phẩm cần được tư vấn theo mục tiêu sử dụng, fit chân và thông số kỹ thuật.`;
  return [summary, paragraphAround(t, ["TRẢI NGHIỆM", "TRAI NGHIEM"]), paragraphAround(t, ["ƯU ĐIỂM", "UU DIEM", "NHƯỢC", "NHUOC"]), paragraphAround(t, ["KẾT LUẬN", "KET LUAN", "Ai nên mua"])]
    .filter(Boolean).filter((p, i, all) => all.indexOf(p) === i).join("\n\n");
}

function buildDeepSections(sections: { title: string; lines: string[] }[]): Profile[] {
  const wanted = ["nghien cuu", "thong so", "cong nghe", "cham diem", "trong luong", "pace", "cu ly", "uu diem", "nhuoc", "so sanh", "faq", "ket luan"];
  return sections.filter((s) => wanted.some((k) => plain(s.title).includes(k))).slice(0, 12)
    .map((s) => ({ title: s.title, paragraphs: s.lines.filter((l) => l.length > 60).slice(0, 5), bullets: s.lines.filter((l) => l.length <= 120).slice(0, 8) }));
}

/** Accents off WITHOUT changing string length, so an index found here is valid in the original. */
const fold = (v: string): string => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

function extractFaq(t: string): string[] {
  const nfc = t.normalize("NFC");
  const i = fold(nfc).indexOf("faq");
  if (i < 0) return [];
  return nfc.slice(i).split(/\n+/).map((l) => l.trim()).filter((l) => /\?$/.test(l)).slice(0, 10);
}

function extractList(t: string, headings: string[]): string[] {
  const nfc = t.normalize("NFC");
  const p = fold(nfc);
  const heading = headings.find((h) => p.includes(fold(h.normalize("NFC"))));
  if (!heading) return [];
  const i = p.indexOf(fold(heading.normalize("NFC")));
  return nfc.slice(i, i + 1200).split(/\n+/).slice(1).map((l) => l.replace(/^[-*•✅❌\s]+/u, "").trim()).filter((l) => l.length > 20 && l.length < 220).slice(0, 5);
}
