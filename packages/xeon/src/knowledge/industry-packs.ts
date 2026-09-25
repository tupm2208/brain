/**
 * @file KNOWLEDGE PACKS — what Xeon knows about an INDUSTRY (Đ9).
 *
 * Decided 17/09/2026: Fit Finder's arithmetic (size charts, foot measurements) belongs to the shop's
 * landing, but line knowledge — which model is a race shoe, which lines are equivalent, how a line
 * scores per pace and distance, how to research a new model — is industry knowledge and lives HERE,
 * one pack per industry, chosen by the `nganh` on the merchant's licence. A pharmacy gets a pack with
 * no shoe lines in it, not a shoe pack with the shoes switched off.
 *
 * Changed 21/09/2026: the running-shoe tables (classification rules, the nine evaluation tables, the
 * research families, the Fit Finder questions) used to be CONSTANTS in this file, so this file had
 * to be edited and the brain rebuilt for every new industry — the one thing the design promised
 * would never be needed. They now live in `nganh/<id>/kien-thuc.json` and this file only assembles
 * what it reads. Nothing here names a shoe.
 */

import {
  INDUSTRY_DIRECTORY, INDUSTRY_FILES, industryIds, readIndustryJson, readIndustryText
} from "./industry-files";
import { LineKnowledge, normalize, type LineDna, type LineLabels, type PurposeRank } from "./line-dna";
import { SampleProfileKit, type Profile, type ProfileKitOptions } from "./sample-profiles";

/** One classification rule: any keyword in the product text → category, use cases, 0..5 scores. */
export interface ReferenceRule {
  keywords: string[];
  category: string;
  useCases: string[];
  scores: Record<string, number>;
}

export interface FitFinderDefaults {
  customerInputs: string[];
  lineProfileFields: string[];
}

export interface KnowledgePack {
  id: string;
  name: string;
  /**
   * The trade as words that drop into a sentence — "một shop bán {tradeWords}". `name` is a label
   * for a screen ("Giày chạy & đồ thể thao"); this is prose ("giày chạy bộ"). Used by the video
   * script prompt, which used to carry a two-line hard-coded table instead.
   */
  tradeWords: string;
  lines: LineKnowledge;
  kit: SampleProfileKit;
  /** Research families the operator can pick (`running`, `pickleball`, `other`). */
  families: { id: string; label: string }[];
  /** General research prompt, used for families without a specialised one. */
  generalPrompt: string;
  referenceRules: ReferenceRule[];
  fitFinder: FitFinderDefaults;
  /** The default sample profiles ("Nạp lại mẫu mặc định"). */
  defaultProfiles(): Profile[];
}

/** @deprecated Use `INDUSTRY_DIRECTORY`; kept because scripts outside this package import it. */
export const PACK_DATA_DIRECTORY = INDUSTRY_DIRECTORY;

/**
 * The research prompt used when an industry declares none. It names no industry on purpose: it is
 * the fallback, not a default shaped like shoes.
 */
const DEFAULT_RESEARCH_PROMPT = `Bạn là chuyên gia nghiên cứu sản phẩm cho shop.

Hãy nghiên cứu dòng sản phẩm {{profileName}} của thương hiệu {{brand}}.
Dữ liệu shop đang có:
{{existingData}}

Các phần còn thiếu cần ưu tiên:
{{missingFields}}

Yêu cầu:
- Ưu tiên nguồn hãng và các nguồn review uy tín.
- Không bịa thông số. Ghi rõ khi chưa xác minh.
- Trả lời bằng tiếng Việt, có tiêu đề rõ cho thông số, công nghệ, chấm điểm /10, ai nên mua, ai không nên mua, FAQ và kết luận.
- Nội dung phải đủ chi tiết để tự tách vào các bảng sản phẩm mẫu.`;

// --------------------------------------------------------------- reading the JSON

const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStrings = (v: unknown): string[] => asArray(v).map((x) => String(x ?? "").trim()).filter((x) => x !== "");
/** A long text written either as one string or as an array of lines (see `parsePack`). */
const asText = (v: unknown): string => (Array.isArray(v) ? v.map((line) => String(line ?? "")).join("\n") : String(v ?? ""));
const asNumberMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(asObject(v))) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
};
const asTextMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(asObject(v))) out[key] = String(value ?? "");
  return out;
};

/** Evaluation tables: section → rows of [label, score key, note]. Short rows are padded. */
function readEvaluationRows(raw: unknown): ProfileKitOptions["evaluationRows"] {
  const out: Record<string, readonly (readonly [string, string, string])[]> = {};
  for (const [section, rows] of Object.entries(asObject(raw))) {
    out[section] = asArray(rows).map((row) => {
      const cells = asArray(row).map((c) => String(c ?? ""));
      return [cells[0] ?? "", cells[1] ?? "", cells[2] ?? ""] as const;
    });
  }
  return out;
}

/**
 * Family patterns, written as `{ id, pattern }` because JSON has no regular expressions.
 * A broken pattern throws NAMING the industry: a silently dropped one would quietly misfile every
 * product of that family.
 */
function readFamilyPatterns(raw: unknown, id: string): readonly (readonly [string, RegExp])[] {
  return asArray(raw).map((entry) => {
    const item = asObject(entry);
    const family = String(item["id"] ?? "").trim();
    const pattern = String(item["pattern"] ?? "");
    try {
      return [family, new RegExp(pattern)] as const;
    } catch (error) {
      throw new Error(`Nganh "${id}": \`kit.familyPatterns\` cua "${family}" khong phai bieu thuc chinh quy hop le (${(error as Error).message}).`);
    }
  });
}

function readReferenceRules(raw: unknown): ReferenceRule[] {
  return asArray(raw).map((entry) => {
    const item = asObject(entry);
    const scores: Record<string, number> = {};
    for (const [key, value] of Object.entries(asNumberMap(item["scores"]))) scores[key] = Math.max(0, Math.min(5, value));
    return {
      keywords: asStrings(item["keywords"]),
      category: String(item["category"] ?? ""),
      useCases: asStrings(item["useCases"]),
      scores
    };
  });
}

/** Research prompts are FILE NAMES in the industry folder: a prompt is prose, not a JSON string. */
function readResearchPrompts(raw: unknown, directory: string, id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [family, file] of Object.entries(asTextMap(raw))) {
    const text = readIndustryText(directory, id, file);
    if (text !== "") out[family] = text;
  }
  return out;
}

/** Builds the pack of one industry folder. Every field is optional: a thin industry is still usable. */
function readPack(directory: string, id: string): KnowledgePack {
  const file = asObject(readIndustryJson(directory, id, INDUSTRY_FILES.knowledge));
  const kitRaw = asObject(file["kit"]);
  const labelsRaw = asObject(file["lineLabels"]);
  const fitRaw = asObject(file["fitFinder"]);
  const dna = asObject(readIndustryJson(directory, id, INDUSTRY_FILES.lines));

  const labels: LineLabels = {
    purpose: asTextMap(labelsRaw["purpose"]),
    plate: asTextMap(labelsRaw["plate"]),
    level: asTextMap(labelsRaw["level"])
  };
  const purposeRank: PurposeRank = asNumberMap(file["purposeRank"]);
  const families = asArray(file["families"]).map((entry) => {
    const item = asObject(entry);
    return { id: String(item["id"] ?? ""), label: String(item["label"] ?? "") };
  });

  const name = String(file["name"] ?? "") || id;
  return {
    id,
    name,
    tradeWords: String(file["tradeWords"] ?? "") || name,
    lines: new LineKnowledge(asArray(dna["lines"]) as LineDna[], labels, purposeRank),
    kit: new SampleProfileKit({
      versionedModels: asStrings(kitRaw["versionedModels"]),
      evaluationRows: readEvaluationRows(kitRaw["evaluationRows"]),
      researchPrompts: readResearchPrompts(kitRaw["researchPrompts"], directory, id),
      familyPatterns: readFamilyPatterns(kitRaw["familyPatterns"], id),
      brandPrefixes: asStrings(kitRaw["brandPrefixes"]),
      defaultCategory: String(kitRaw["defaultCategory"] ?? "") || "khac"
    }),
    families: families.length > 0 ? families : [{ id: "other", label: "Loại khác" }],
    generalPrompt: asText(file["generalPrompt"]) || DEFAULT_RESEARCH_PROMPT,
    referenceRules: readReferenceRules(file["referenceRules"]),
    fitFinder: {
      customerInputs: asStrings(fitRaw["customerInputs"]),
      lineProfileFields: asStrings(fitRaw["lineProfileFields"])
    },
    // Read on every call, not cached: the operator edits the defaults and presses "Nạp lại mẫu
    // mặc định" without restarting Xeon.
    defaultProfiles: () => asArray(asObject(readIndustryJson(directory, id, INDUSTRY_FILES.defaultProfiles))["mau"]) as Profile[]
  };
}

/** A pack with the mechanics and no industry data: the shop builds its own profiles. */
function emptyPack(id: string, name: string): KnowledgePack {
  return {
    id, name,
    // A trade nobody declared reads as "hàng": "một shop bán hàng ở Việt Nam" is still a sentence.
    tradeWords: "hàng",
    lines: new LineKnowledge([]),
    kit: new SampleProfileKit({ versionedModels: [], evaluationRows: {}, researchPrompts: {}, familyPatterns: [], brandPrefixes: [], defaultCategory: "khac" }),
    families: [{ id: "other", label: "Loại khác" }],
    generalPrompt: DEFAULT_RESEARCH_PROMPT,
    referenceRules: [],
    fitFinder: { customerInputs: [], lineProfileFields: [] },
    defaultProfiles: () => []
  };
}

/** The knowledge packs on offer, read from `nganh/` once per industry and kept. */
export class KnowledgePackRegistry {
  private readonly cache = new Map<string, KnowledgePack>();

  constructor(private readonly directory: string = INDUSTRY_DIRECTORY) {}

  /** The industry ids that have a folder, sorted. */
  ids(): string[] {
    return industryIds(this.directory);
  }

  /** The pack of an industry; an industry with no folder gets an empty pack, never another's. */
  get(industry: string): KnowledgePack {
    const id = String(industry || "").trim();
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    if (id === "" || !this.ids().includes(id)) return emptyPack(id || "khac", "Ngành chưa có gói kiến thức");
    const pack = readPack(this.directory, id);
    this.cache.set(id, pack);
    return pack;
  }
}

/** Desk `classifyProduct`: first rule whose keyword appears in the product text. */
export function classifyByRules(rules: readonly ReferenceRule[], product: { ten?: string; ma?: string; hang?: string; dong?: string; loai?: string }): { status: "matched" | "missing"; category: string; useCases: string[]; scores: Record<string, number>; note: string } {
  const t = normalize([product.hang, product.ten, product.ma, product.loai, product.dong].join(" "));
  const hit = rules.find((rule) => rule.keywords.some((k) => t.includes(normalize(k))));
  if (!hit) return { status: "missing", category: "unclassified", useCases: [], scores: {}, note: "Chưa có dữ liệu tham khảo. Cần nhập ghi chú hoặc chỉnh tay." };
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(hit.scores)) scores[k] = Math.max(0, Math.min(5, Number(v) || 0));
  return { status: "matched", category: hit.category, useCases: hit.useCases, scores, note: `Phân loại ban đầu theo taxonomy tham khảo cho ${product.ten || product.ma || "sản phẩm"}. Cần đối chiếu feedback thật trước khi public.` };
}
