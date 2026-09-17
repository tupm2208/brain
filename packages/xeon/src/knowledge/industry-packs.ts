/**
 * @file KNOWLEDGE PACKS — what Xeon knows about an INDUSTRY (Đ9).
 *
 * Decided 17/09/2026: Fit Finder's arithmetic (size charts, foot measurements) belongs to the shop's
 * landing, but line knowledge — which model is a race shoe, which lines are equivalent, how a line
 * scores per pace and distance, how to research a new model — is industry knowledge and lives HERE,
 * one pack per industry, chosen by the `nganh` on the merchant's licence. A pharmacy gets a pack with
 * no shoe lines in it, not a shoe pack with the shoes switched off.
 *
 * The data files sit in `packages/xeon/nganh/<pack>/` (copied from Sales Desk's knowledge folder):
 * the operator edits JSON, not code.
 */

import fs from "node:fs";
import path from "node:path";
import { LineKnowledge, normalize, type LineDna } from "./line-dna";
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

/** From `dist/knowledge/` (or `src/knowledge/` under a type-stripping runner) up to `packages/xeon/nganh`. */
export const PACK_DATA_DIRECTORY = path.join(__dirname, "..", "..", "nganh");

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readText(file: string): string {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

const GENERAL_PROMPT = `Bạn là chuyên gia nghiên cứu sản phẩm cho shop.

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

const r = (keywords: string[], category: string, useCases: string[], scores: Record<string, number>): ReferenceRule => ({ keywords, category, useCases, scores });

/** Sales Desk `runrepeat_reference.js` REFERENCE_RULES, first match wins. */
const RUNNING_RULES: ReferenceRule[] = [
  r(["pegasus"], "daily_trainer", ["daily_run", "beginner", "5k_10k"], { daily: 5, beginner: 5, longRun: 4, speed: 3, comfort: 4, stability: 3, value: 4 }),
  r(["vomero"], "max_cushion_daily", ["daily_run", "long_run", "recovery"], { daily: 5, beginner: 4, longRun: 5, comfort: 5, stability: 3 }),
  r(["infinity", "structure"], "stability_daily", ["daily_run", "stability", "beginner"], { daily: 4, beginner: 4, stability: 5, comfort: 4 }),
  r(["vaporfly", "alphafly"], "race", ["race", "marathon", "speed"], { race: 5, speed: 5, longRun: 4, stability: 2, beginner: 1 }),
  r(["streakfly", "zoom fly"], "speed_trainer", ["speed", "race_support"], { speed: 5, race: 4, daily: 2, beginner: 2 }),
  r(["adios pro", "prime x"], "race", ["race", "marathon", "speed"], { race: 5, speed: 5, longRun: 4, stability: 2, beginner: 1 }),
  r(["evo sl", "adizero evo"], "lightweight_speed_daily", ["daily_run", "tempo", "speed", "5k_10k"], { daily: 4, beginner: 3, longRun: 3, speed: 5, race: 3, stability: 2, comfort: 4, value: 4 }),
  r(["takumi sen"], "short_race", ["race_5k_10k", "speed"], { race: 5, speed: 5, longRun: 2, beginner: 1 }),
  r(["boston"], "tempo_super_trainer", ["tempo", "speed", "long_run"], { daily: 3, speed: 4, longRun: 4, race: 3, stability: 3 }),
  r(["ultraboost", "supernova"], "daily_trainer", ["daily_run", "beginner"], { daily: 4, beginner: 4, comfort: 4, speed: 2, value: 3 }),
  r(["novablast"], "responsive_daily", ["daily_run", "tempo_light", "5k_10k"], { daily: 5, beginner: 4, speed: 4, longRun: 4, comfort: 4 }),
  r(["superblast"], "super_trainer", ["daily_run", "long_run", "tempo"], { daily: 5, speed: 4, longRun: 5, comfort: 5, beginner: 3 }),
  r(["nimbus"], "max_cushion_daily", ["daily_run", "long_run", "recovery"], { daily: 5, beginner: 5, comfort: 5, longRun: 5, stability: 3 }),
  r(["cumulus"], "daily_trainer", ["daily_run", "beginner", "5k_10k"], { daily: 5, beginner: 5, comfort: 4, longRun: 4, value: 4 }),
  r(["kayano", "gt-2000", "gt 2000"], "stability_daily", ["stability", "daily_run", "long_run"], { daily: 4, beginner: 4, stability: 5, comfort: 4, longRun: 4 }),
  r(["metaspeed"], "race", ["race", "speed"], { race: 5, speed: 5, longRun: 4, stability: 2, beginner: 1 }),
  r(["clifton"], "max_cushion_daily", ["daily_run", "beginner", "long_run"], { daily: 5, beginner: 5, comfort: 5, longRun: 4, stability: 3 }),
  r(["bondi"], "recovery_max_cushion", ["recovery", "walking", "easy_run"], { daily: 4, beginner: 4, comfort: 5, speed: 1, stability: 4 }),
  r(["mach"], "tempo_daily", ["daily_run", "tempo", "5k_10k"], { daily: 4, speed: 4, beginner: 3, comfort: 4, longRun: 3 }),
  r(["arahi", "gaviota"], "stability_daily", ["stability", "daily_run"], { daily: 4, beginner: 4, stability: 5, comfort: 4 }),
  r(["speedgoat", "challenger"], "trail", ["trail", "mixed_terrain"], { trail: 5, stability: 4, comfort: 4, daily: 2 }),
  r(["endorphin speed"], "tempo_super_trainer", ["tempo", "speed", "race_support"], { speed: 5, race: 4, daily: 3, longRun: 4, beginner: 2 }),
  r(["endorphin pro", "endorphin elite"], "race", ["race", "speed"], { race: 5, speed: 5, longRun: 4, beginner: 1 }),
  r(["triumph"], "max_cushion_daily", ["daily_run", "long_run", "recovery"], { daily: 5, beginner: 4, comfort: 5, longRun: 5 }),
  r(["guide", "hurricane"], "stability_daily", ["stability", "daily_run"], { daily: 4, stability: 5, comfort: 4, beginner: 4 }),
  r(["1080"], "max_cushion_daily", ["daily_run", "long_run", "recovery"], { daily: 5, beginner: 4, comfort: 5, longRun: 5 }),
  r(["rebel"], "tempo_daily", ["tempo", "speed", "5k_10k"], { speed: 4, daily: 4, beginner: 3, comfort: 4 }),
  r(["sc elite", "fuelcell elite"], "race", ["race", "speed"], { race: 5, speed: 5, longRun: 4, beginner: 1 }),
  r(["more"], "max_cushion_daily", ["daily_run", "recovery", "long_run"], { daily: 4, beginner: 4, comfort: 5, longRun: 4 }),
  r(["860"], "stability_daily", ["stability", "daily_run"], { daily: 4, stability: 5, beginner: 4 }),
  r(["cloudmonster"], "max_cushion_daily", ["daily_run", "long_run"], { daily: 4, comfort: 4, longRun: 4, beginner: 3 }),
  r(["cloudsurfer", "cloudrunner"], "daily_trainer", ["daily_run", "beginner"], { daily: 4, beginner: 4, comfort: 4, stability: 3 }),
  r(["cloudboom"], "race", ["race", "speed"], { race: 5, speed: 5, beginner: 1 }),
  r(["trail"], "trail", ["trail", "mixed_terrain"], { trail: 4, stability: 4, comfort: 3 }),
  r(["carbon", "pro"], "race", ["race", "speed"], { race: 4, speed: 4, beginner: 1 }),
  r(["stability", "support"], "stability_daily", ["stability", "daily_run"], { stability: 4, daily: 3, beginner: 3 })
];

/** The nine evaluation tables of a running shoe (Desk `defaultEvaluationRows`). */
const RUNNING_EVALUATION: ProfileKitOptions["evaluationRows"] = {
  classification: [
    ["Độ êm", "comfort", "Mức bảo vệ và dễ chịu khi chạy/đi trong thời gian dài."], ["Độ nảy", "bounce", "Khả năng phản hồi khi tăng nhịp và chuyển bước."],
    ["Độ ổn định", "stability", "Mức kiểm soát khi tiếp đất, chuyển hướng hoặc chạy mệt."], ["Độ linh hoạt", "flexibility", "Khả năng uốn/chuyển động tự nhiên của bàn chân."],
    ["Độ thoáng khí", "breathability", "Mức thoát nhiệt của upper khi dùng lâu."], ["Độ bền", "durability", "Độ bền upper/outsole theo mục đích sử dụng chính."],
    ["Độ bám đường", "grip", "Độ bám trên bề mặt phù hợp với nhóm giày."], ["Hoàn trả năng lượng", "energyReturn", "Cảm giác trả lực và tiết kiệm sức khi chạy đúng nhịp."]
  ],
  weight: [["Dưới 55kg", "", "Foam có đủ nâng đỡ không, có bị thiếu lực nén không."], ["55-70kg", "", "Vùng trọng lượng thường dễ khai thác foam và độ nảy."], ["70-85kg", "", "Đánh giá độ lún đế và ổn định khi chạy mệt."], ["Trên 85kg", "", "Cần kiểm tra nguy cơ lún đế và mất ổn định ngang."]],
  pace: [["Pace >7:00", "", "Có phát huy hết khả năng không, có dư công nghệ không."], ["Pace 6:00-7:00", "", "Có dễ dùng và đáng tiền ở pace chậm-vừa không."], ["Pace 5:00-6:00", "", "Mức phát huy độ nảy, chuyển bước và độ êm."], ["Pace 4:00-5:00", "", "Vùng hiệu quả cho bài tempo/race pace."], ["Pace <4:00", "", "So với giày race chuyên dụng có còn tối ưu không."]],
  distance: [["5K", "", "Độ bảo vệ chân, chuyển bước và cảm giác cuối buổi."], ["10K", "", "Mức tiêu hao cơ bắp và khả năng duy trì form."], ["21K", "", "Độ thoải mái cuối buổi và bảo vệ khi chạy dài."], ["42K", "", "Khả năng duy trì form và giảm mỏi ở marathon."], ["Ultra", "", "Độ bảo vệ dài giờ và ổn định ở cự ly rất dài."]],
  level: [["Người mới chạy", "beginner", "Có dễ làm quen không, có đòi hỏi kỹ thuật không."], ["Runner phong trào", "daily", "Mức phù hợp với người chạy đều để tập hằng tuần."], ["Runner bán chuyên", "speed", "Khả năng khai thác công nghệ và bài chất lượng."], ["Runner thành tích", "race", "Hiệu quả khi dùng cho bài thành tích hoặc race."]],
  footType: [["Chân hẹp", "", "Độ ôm chân, không gian mũi và khóa gót."], ["Chân trung bình", "", "Nhóm fit tiêu chuẩn để ưu tiên tư vấn."], ["Chân bè", "wideFoot", "Không gian ngang/toe box và rủi ro ép mũi."], ["Bàn chân dày", "", "Áp lực upper/dây và chiều cao khoang giày."], ["Mu bàn chân cao", "", "Khả năng nới dây, khóa gót và tránh cấn mu."], ["Ngón chân xòe", "", "Không gian toe box cho ngón xòe khi chạy dài."]],
  purpose: [["Daily Trainer", "daily", "Dùng cho tập hằng ngày."], ["Easy Run", "comfort", "Dùng cho buổi nhẹ, chậm, phục hồi."], ["Long Run", "longRun", "Bảo vệ chân và duy trì cảm giác cuối buổi."], ["Tempo Run", "speed", "Mục đích chạy nhanh có kiểm soát."], ["Interval", "speed", "Bài tốc độ ngắn, cần nhẹ và phản hồi."], ["Race Day", "race", "Dùng cho ngày thi đấu hoặc bài thành tích."], ["Recovery Run", "comfort", "Dùng cho buổi hồi phục rất chậm."], ["Walking", "", "Đi bộ, đi cả ngày có đáng tiền không."], ["Gym", "", "Độ ổn định cho bài tạ/di chuyển ngang."], ["Pickleball", "", "Không dùng giày running thay giày court nếu chơi thường xuyên."], ["Travel", "", "Đi du lịch, đi lâu, cần thoải mái cả ngày."]]
};

function runningPack(directory: string): KnowledgePack {
  const dnaFile = readJson(path.join(directory, "giay-chay", "line-dna.json")) as { lines?: LineDna[] } | null;
  const researchPrompt = readText(path.join(directory, "giay-chay", "nghien-cuu.md"));
  const kit = new SampleProfileKit({
    versionedModels: ["adios pro", "adios", "boston", "pegasus", "novablast", "kayano", "clifton", "vaporfly", "speedgoat"],
    evaluationRows: RUNNING_EVALUATION,
    researchPrompts: researchPrompt ? { running: researchPrompt } : {},
    familyPatterns: [["pickleball", /\bpickleball\b/], ["running", /\b(?:running|run|trail|trainer|race|tempo|marathon|daily|stability|cushion)\b/]],
    brandPrefixes: ["adidas", "nike", "asics", "hoka", "puma", "new-balance", "saucony", "brooks", "on-running", "mizuno"],
    defaultCategory: "running_shoes"
  });
  return {
    id: "giay-chay",
    name: "Giày chạy & đồ thể thao",
    lines: new LineKnowledge(Array.isArray(dnaFile?.lines) ? dnaFile.lines : [], {
      purpose: { race_carbon: "giày đua carbon (race)", super_trainer: "super trainer (tập dài + nhanh)", tempo: "tempo/tập tốc độ", daily: "daily trainer (chạy hằng ngày)", max_cushion: "siêu êm (chạy nhẹ/đi bộ/đứng lâu)", stability: "ổn định/hỗ trợ vòm chân", budget_daily: "daily giá mềm", short_race: "đua cự ly ngắn 5K-10K", trail: "chạy trail/đường đất", casual: "lifestyle/đi chơi — KHÔNG phải giày chạy" },
      plate: { carbon: "tấm carbon", energy_rods: "thanh Energy Rods", nylon: "tấm nylon dẻo", none: "không có tấm trợ lực" },
      level: { beginner_ok: "mới chạy cũng dùng tốt", intermediate: "nên có nền tảng chạy cơ bản", advanced: "dành cho người chạy lâu năm/có mục tiêu race" }
    }),
    kit,
    families: [{ id: "running", label: "Running" }, { id: "pickleball", label: "Pickleball" }, { id: "other", label: "Loại khác" }],
    generalPrompt: GENERAL_PROMPT,
    referenceRules: RUNNING_RULES,
    fitFinder: {
      customerInputs: ["Cấu trúc vòm chân", "Độ rộng bàn chân / mu chân", "Chiều dài/rộng chân đo thực tế", "Chiều cao, cân nặng", "Tốc độ chạy hiện tại", "Cự ly thường chạy", "Mục tiêu sử dụng", "Vấn đề đang gặp: đau gối, đau cổ chân, đau gan bàn chân...", "Đôi giày đang đi vừa hoặc không vừa", "Cảm giác mong muốn: êm, nhẹ, ổn định, tốc độ..."],
      lineProfileFields: ["Mục đích phù hợp", "Độ êm", "Độ ổn định", "Độ phản hồi", "Form ngang", "Hỗ trợ vòm chân", "Khoảng pace/cự ly phù hợp", "Cảnh báo không nên tư vấn", "Ghi chú size/fit"]
    },
    defaultProfiles: () => {
      const file = readJson(path.join(directory, "giay-chay", "mau-mac-dinh.json")) as { mau?: Profile[] } | null;
      return Array.isArray(file?.mau) ? structuredClone(file.mau) : [];
    }
  };
}

/** A pack with the mechanics and no industry data: the shop builds its own profiles. */
function emptyPack(id: string, name: string): KnowledgePack {
  return {
    id, name,
    lines: new LineKnowledge([]),
    kit: new SampleProfileKit({ versionedModels: [], evaluationRows: {}, researchPrompts: {}, familyPatterns: [], brandPrefixes: [], defaultCategory: "khac" }),
    families: [{ id: "other", label: "Loại khác" }],
    generalPrompt: GENERAL_PROMPT,
    referenceRules: [],
    fitFinder: { customerInputs: [], lineProfileFields: [] },
    defaultProfiles: () => []
  };
}

export class KnowledgePackRegistry {
  private readonly packs = new Map<string, KnowledgePack>();

  constructor(directory: string = PACK_DATA_DIRECTORY) {
    this.packs.set("giay-chay", runningPack(directory));
    this.packs.set("nha-thuoc", emptyPack("nha-thuoc", "Nhà thuốc"));
  }

  /** The pack of an industry; an unknown industry gets an empty pack, never the shoe pack. */
  get(industry: string): KnowledgePack {
    return this.packs.get(industry) ?? emptyPack(industry || "khac", "Ngành chưa có gói kiến thức");
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
