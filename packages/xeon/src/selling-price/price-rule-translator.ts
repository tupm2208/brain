/**
 * @file KỂ BẰNG LỜI cho bảng giá (02/10/2026) — a shop says how it prices in its own words, and a
 * model writes that as a price table.
 *
 * Built like the content-profile translator (`content/profile-translator.ts`), for the same
 * reasons:
 *   - THE FORMAT GUIDE COMES FROM THE LANDING in the same request (`huongDan`); Xeon keeps no copy
 *     of it, so a new field on the landing needs no deploy here. Xeon only knows the table's shape
 *     well enough to clean what comes back (`price-rules.ts`), and the landing cleans again.
 *   - IT ONLY USES WHAT WAS SAID. A number the shop did not say is not invented; what was not said
 *     becomes "not priced" plus a question in `chuaRo`.
 *   - THE VALUES COME FROM THE SHOP'S CATALOGUE (`giaTriCoSan`). A model's "Dép" for a shop that has
 *     no such type is dropped here, with its rule, and said — never left to match every item.
 *   - THE LANDING STORES NOTHING until a person presses "Lưu bảng giá". This is a proposal.
 *
 * The words of the prompt are tier 1 data (`loi-chung/bang-gia-hieu-y.json`), read on every call;
 * this file only assembles them.
 */

import { withUsage } from "../ai/usage-context";
import { parseAgentJson } from "../agent/sales-agent";
import type { TextModelPort } from "../content/text-model";
import { CATALOG_FIELDS, cleanPriceRules, tableSaysSomething, type CatalogChoices, type PriceRuleTable } from "./price-rules";

/** The prompt's words, from `loi-chung/bang-gia-hieu-y.json`. */
export interface PriceRulePromptText {
  heThong: string;
  cachDien: string[];
  nhan: { loiKe: string; bangHienTai: string; huongDan: string; giaTriCoSan: string; trong: string; cachDien: string };
  /** The closing line: without it a gateway model may answer with a function call it cannot carry. */
  dongCuoi: string;
}

export interface PriceRuleRequest {
  tenant: string;
  /** The shop's own words, verbatim. */
  loiKe: string;
  /** The table on the screen right now (any shape; cleaned here). */
  bangHienTai: unknown;
  /** The landing's format guide (`PRICE_TABLE_GUIDE`), passed to the model as is. */
  huongDan: Record<string, unknown>;
  giaTriCoSan: CatalogChoices;
}

export interface PriceRuleProposal {
  bang: PriceRuleTable;
  /** What the model understood, one short sentence each. */
  hieuLa: string[];
  /** Xeon's corrections first, then what the words did not say. */
  chuaRo: string[];
  model: string;
}

export type PriceRuleResult =
  | ({ ok: true } & PriceRuleProposal)
  | { ok: false; status: number; error: string; message: string };

const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, n = 4000): string => String(v ?? "").trim().slice(0, n);
/** A text written as one string or as lines. */
const prose = (v: unknown): string => (Array.isArray(v) ? v.map((x) => String(x ?? "")).join("\n") : String(v ?? "")).trim();
const sentences = (v: unknown, n: number): string[] => (Array.isArray(v) ? v : []).map((x) => text(x, 300)).filter((x) => x !== "").slice(0, n);

const NHAN_KEYS = ["loiKe", "bangHienTai", "huongDan", "giaTriCoSan", "trong", "cachDien"] as const;
/** Xeon's corrections shown before the model's questions; beyond this they are counted, not listed. */
const MAX_FIXES = 5;

/** The prompt's words, or `null` when the file is absent or lacks a part (said by `priceRulePromptProblems`). */
export function parsePriceRulePrompt(raw: unknown): PriceRulePromptText | null {
  if (raw === null || raw === undefined) return null;
  return priceRulePromptProblems(raw, "").length > 0 ? null : readPrompt(asRecord(raw));
}

function readPrompt(o: Record<string, unknown>): PriceRulePromptText {
  const nhan = asRecord(o["nhan"]);
  return {
    heThong: prose(o["heThong"]),
    cachDien: (Array.isArray(o["cachDien"]) ? o["cachDien"] : [o["cachDien"]]).map((x) => String(x ?? "").trim()).filter(Boolean),
    nhan: { loiKe: text(nhan["loiKe"], 200), bangHienTai: text(nhan["bangHienTai"], 200), huongDan: text(nhan["huongDan"], 200), giaTriCoSan: text(nhan["giaTriCoSan"], 200), trong: text(nhan["trong"], 80), cachDien: text(nhan["cachDien"], 200) },
    dongCuoi: prose(o["dongCuoi"])
  };
}

/**
 * What is wrong with the prompt file, for the start-up check. Absent = nothing wrong (the door then
 * answers 503); present but incomplete, or carrying a shop's number, = a problem naming the part.
 */
export function priceRulePromptProblems(raw: unknown, where: string): string[] {
  if (raw === null || raw === undefined) return [];
  const o = asRecord(raw);
  const p = readPrompt(o);
  const problems: string[] = [];
  if (p.heThong === "") problems.push(`${where}: thiếu "heThong".`);
  if (p.cachDien.length === 0) problems.push(`${where}: thiếu "cachDien".`);
  if (p.dongCuoi === "") problems.push(`${where}: thiếu "dongCuoi".`);
  for (const k of NHAN_KEYS) if (p.nhan[k] === "") problems.push(`${where}: thiếu "nhan.${k}".`);
  return problems;
}

/** The prompt for one request. Exported so a test can read what the model is told. */
export function priceRulePrompt(words: PriceRulePromptText, input: PriceRuleRequest): { system: string; user: string } {
  const current = cleanPriceRules(input.bangHienTai).bang;
  const currentRules = { dong: current.dong, conLai: current.conLai, gioiHan: current.gioiHan, lamTron: current.lamTron, khongQuaNiemYet: current.khongQuaNiemYet };
  const values = CATALOG_FIELDS.map((f) => `- ${f}: ${input.giaTriCoSan[f].length > 0 ? input.giaTriCoSan[f].join(" | ") : words.nhan.trong}`).join("\n");
  const guide = Object.keys(input.huongDan).length > 0 ? JSON.stringify(input.huongDan).slice(0, 12000) : "";
  return {
    system: words.heThong,
    user: [
      `${words.nhan.loiKe}:\n"""${text(input.loiKe, 4000)}"""`,
      `\n${words.nhan.giaTriCoSan}:\n${values}`,
      `\n${words.nhan.bangHienTai}:\n${tableSaysSomething(current) ? JSON.stringify(currentRules) : words.nhan.trong}`,
      guide === "" ? "" : `\n${words.nhan.huongDan}:\n${guide}`,
      `\n${words.nhan.cachDien}:\n${words.cachDien.map((l) => `- ${l}`).join("\n")}`,
      `\n${words.dongCuoi}`
    ].filter((l) => l !== "").join("\n")
  };
}

/**
 * The answer's outer shape. `bang` is free-shaped on purpose (same reason as the content
 * translator's `hoSo`): its shape is the guide the landing just sent, and pinning it here would
 * mean redeploying Xeon for a new field. The cleaning below is what keeps it honest.
 */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    bang: { type: "object" },
    hieuLa: { type: "array", items: { type: "string" } },
    chuaRo: { type: "array", items: { type: "string" } }
  },
  required: ["bang", "hieuLa", "chuaRo"],
  additionalProperties: false
} as const;

export interface PriceRuleTranslatorOptions {
  model: TextModelPort;
  /** The raw JSON of `loi-chung/bang-gia-hieu-y.json`, read on every call (`null` when absent). */
  prompt: () => unknown;
}

export class PriceRuleTranslator {
  constructor(private readonly options: PriceRuleTranslatorOptions) {}

  async understand(input: PriceRuleRequest): Promise<PriceRuleResult> {
    if (text(input.loiKe) === "") return { ok: false, status: 400, error: "chua_ke_gi", message: "Chưa có lời kể nào để hiểu." };
    if (!this.options.model.ready()) return { ok: false, status: 503, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình AI nên chưa đọc được lời kể — vẫn tự điền bảng được." };
    const words = parsePriceRulePrompt(this.options.prompt());
    if (words === null) return { ok: false, status: 503, error: "thieu_loi_dan", message: "Xeon thiếu tệp lời dặn loi-chung/bang-gia-hieu-y.json — cập nhật mã Xeon rồi bật lại; vẫn tự điền bảng được." };

    const prompt = priceRulePrompt(words, input);
    const outcome = await withUsage({ shop: input.tenant, agent: "price_rules" }, () =>
      this.options.model.complete({ system: prompt.system, user: prompt.user, schema: ANSWER_SCHEMA as unknown as Record<string, unknown>, maxTokens: 8000 }));
    if (!outcome.ok) return { ok: false, status: 503, error: "mo_hinh_khong_tra_loi", message: `AI chưa đọc được lời kể lúc này (${outcome.viSao}). Thử lại sau ít phút — vẫn tự điền bảng được.` };

    const json = parseAgentJson(outcome.text);
    const table = json === null ? null : json["bang"];
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      return { ok: false, status: 502, error: "khong_doc_duoc", message: "AI trả về thứ không đọc được thành bảng giá. Thử kể lại ngắn gọn hơn, hoặc tự điền bảng." };
    }
    const current = cleanPriceRules(input.bangHienTai).bang;
    const cleaned = cleanPriceRules({ ...(table as Record<string, unknown>), ma: current.ma, ten: current.ten, nguonMau: current.nguonMau }, { choices: input.giaTriCoSan });
    // The landing shows a handful of these lines: Xeon's own corrections come first (they changed the
    // table), but at most MAX_FIXES of them, so the model's questions to the shop are still seen.
    const fixes = cleaned.ghiChu.length > MAX_FIXES
      ? [...cleaned.ghiChu.slice(0, MAX_FIXES - 1), `… và ${cleaned.ghiChu.length - MAX_FIXES + 1} chỗ Xeon sửa khác — đọc kỹ bảng trước khi lưu.`]
      : cleaned.ghiChu;
    return {
      ok: true,
      bang: cleaned.bang,
      hieuLa: sentences(json!["hieuLa"], 20),
      chuaRo: [...fixes.map((n) => n.slice(0, 300)), ...sentences(json!["chuaRo"], 12)].slice(0, 16),
      model: outcome.model
    };
  }
}
