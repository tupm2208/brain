/**
 * @file NẠP TÀI LIỆU CỦA SHOP (02/10/2026) — a shop pastes its list of frequent questions or its own
 * procedure, and a model splits it into single points, each named with the place it belongs.
 *
 * Built like the price-rule translator (`selling-price/price-rule-translator.ts`):
 *   - THE PLACES COME FROM THE LANDING in the same request: the profile fields (path, label, kind),
 *     the policy texts, the industry blocks and the platform rules' titles. Xeon keeps no list of
 *     fields, so a new field on the landing needs no deploy here.
 *   - THE MODEL ONLY NAMES. Whether a point is applied — empty field filled, filled field left for the
 *     shop to choose, banned phrase or platform rule refused — is the LANDING's decision (it owns the
 *     profile and the shop's banned phrases). Xeon only drops what names a place that does not exist.
 *   - IT ONLY USES WHAT WAS WRITTEN: the prompt forbids values the document does not state.
 *
 * The prompt's words are tier 1 data (`loi-chung/nap-tai-lieu.json`), read on every call.
 */

import { withUsage } from "./usage-context";
import { parseAgentJson } from "../agent/sales-agent";
import type { TextModelPort } from "../content/text-model";

export const DOC_POINT_KINDS = ["o-ho-so", "chinh-sach", "cau-hoi-rieng", "quy-trinh-rieng", "du-lieu-kho", "trai-luat", "thong-tin-thanh-toan"] as const;
export type DocPointKind = (typeof DOC_POINT_KINDS)[number];

/** One point of the shop's document, as named by the model and checked against the places sent. */
export interface DocPoint {
  trich: string;
  loai: DocPointKind;
  path: string;
  giaTri: string;
  cauHoi: string;
  traLoi: string;
  quyTac: string;
  khoi: string;
  luat: string;
  lyDo: string;
}

export interface ShopDocRequest {
  tenant: string;
  /** The document's text (pasted, or extracted on the screen from a file). */
  chu: string;
  oHoSo: { path: string; nhan: string; kieu: string }[];
  chinhSach: { key: string; nhan: string }[];
  khoiNganh: { id: string; tieuDe: string; shopSua: boolean }[];
  luatChung: { tieuDe: string; loiDan: string }[];
}

export type ShopDocResult =
  | { ok: true; tomTat: string; muc: DocPoint[]; model: string }
  | { ok: false; status: number; error: string; message: string };

interface PromptWords { heThong: string[]; loai: Record<string, string>; nhan: Record<string, string>; dongCuoi: string }

const MAX_DOC = 20_000;
const MAX_POINTS = 120;
const text = (v: unknown, n: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readWords(raw: unknown): PromptWords | null {
  const o = asObject(raw);
  const heThong = Array.isArray(o["heThong"]) ? o["heThong"].map((x) => String(x)) : [];
  const loai = Object.fromEntries(Object.entries(asObject(o["loai"])).map(([k, v]) => [k, String(v)]));
  if (heThong.length === 0 || DOC_POINT_KINDS.some((k) => !loai[k])) return null;
  return { heThong, loai, nhan: Object.fromEntries(Object.entries(asObject(o["nhan"])).map(([k, v]) => [k, String(v)])), dongCuoi: String(o["dongCuoi"] ?? "") };
}

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    tomTat: { type: "string" },
    muc: {
      type: "array",
      items: {
        type: "object",
        properties: {
          trich: { type: "string" }, loai: { type: "string", enum: [...DOC_POINT_KINDS] }, path: { type: "string" }, giaTri: { type: "string" },
          cauHoi: { type: "string" }, traLoi: { type: "string" }, quyTac: { type: "string" }, khoi: { type: "string" }, luat: { type: "string" }, lyDo: { type: "string" }
        },
        required: ["trich", "loai", "lyDo"]
      }
    }
  },
  required: ["tomTat", "muc"]
} as const;

export interface ShopDocReaderOptions {
  model: TextModelPort;
  /** The raw JSON of `loi-chung/nap-tai-lieu.json`, read on every call (`null` when absent). */
  prompt: () => unknown;
}

export class ShopDocReader {
  constructor(private readonly options: ShopDocReaderOptions) {}

  async read(input: ShopDocRequest): Promise<ShopDocResult> {
    const doc = String(input.chu ?? "").trim();
    if (doc === "") return { ok: false, status: 400, error: "chua_co_tai_lieu", message: "Chưa có tài liệu nào để đọc." };
    if (!this.options.model.ready()) return { ok: false, status: 503, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình AI nên chưa đọc được tài liệu — vẫn khai tay được." };
    const words = readWords(this.options.prompt());
    if (words === null) return { ok: false, status: 503, error: "thieu_loi_dan", message: "Xeon thiếu tệp lời dặn loi-chung/nap-tai-lieu.json — cập nhật mã Xeon rồi bật lại." };

    const label = (k: string, fallback: string) => words.nhan[k] ?? fallback;
    const system = [...words.heThong, "Cac loai:", ...DOC_POINT_KINDS.map((k) => `- ${k}: ${words.loai[k]}`), words.dongCuoi].join("\n");
    const user = [
      `${label("oHoSo", "O HO SO")}:`, ...input.oHoSo.map((f) => `- ${f.path} — ${f.nhan} — ${f.kieu}`),
      "", `${label("chinhSach", "CHINH SACH CHUNG")}:`, ...input.chinhSach.map((p) => `- ${p.key} — ${p.nhan}`),
      "", `${label("khoiNganh", "KHOI NGANH")}:`, ...input.khoiNganh.map((b) => `- ${b.id} — ${b.tieuDe} — ${b.shopSua ? "mo" : "khoa"}`),
      "", `${label("luatChung", "LUAT CHUNG")}:`, ...input.luatChung.map((b) => `## ${b.tieuDe}\n${b.loiDan}`),
      "", `${label("taiLieu", "TAI LIEU SHOP GUI")}:`, doc.slice(0, MAX_DOC)
    ].join("\n");

    const outcome = await withUsage({ shop: input.tenant, agent: "shop_doc" }, () =>
      this.options.model.complete({ system, user, schema: ANSWER_SCHEMA as unknown as Record<string, unknown>, maxTokens: 8000 }));
    if (!outcome.ok) return { ok: false, status: 503, error: "mo_hinh_khong_tra_loi", message: `AI chưa đọc được tài liệu lúc này (${outcome.viSao}). Thử lại sau ít phút — vẫn khai tay được.` };
    const json = parseAgentJson(outcome.text);
    if (json === null || !Array.isArray(json["muc"])) return { ok: false, status: 502, error: "khong_doc_duoc", message: "AI trả về thứ không đọc được. Thử dán tài liệu ngắn gọn hơn." };

    const paths = new Set(input.oHoSo.map((f) => f.path));
    const policies = new Set(input.chinhSach.map((p) => p.key));
    const blocks = new Set(input.khoiNganh.map((b) => b.id));
    const muc: DocPoint[] = [];
    for (const raw of (json["muc"] as unknown[]).slice(0, MAX_POINTS)) {
      const o = asObject(raw);
      const loai = String(o["loai"] ?? "") as DocPointKind;
      if (!(DOC_POINT_KINDS as readonly string[]).includes(loai)) continue;
      const point: DocPoint = {
        trich: text(o["trich"], 400), loai, path: text(o["path"], 60), giaTri: text(o["giaTri"], 1000),
        cauHoi: text(o["cauHoi"], 300), traLoi: text(o["traLoi"], 1000), quyTac: text(o["quyTac"], 600),
        khoi: text(o["khoi"], 40), luat: text(o["luat"], 120).replace(/^#+\s*/, ""), lyDo: text(o["lyDo"], 300)
      };
      // A place that does not exist is not guessed at: the point is dropped, never moved elsewhere.
      if (loai === "o-ho-so" && !paths.has(point.path)) continue;
      if (loai === "chinh-sach" && !policies.has(point.path)) continue;
      if (loai === "cau-hoi-rieng" && (point.cauHoi === "" || point.traLoi === "")) continue;
      if (loai === "quy-trinh-rieng" && point.quyTac === "") continue;
      if (point.khoi !== "" && !blocks.has(point.khoi)) point.khoi = "";
      muc.push(point);
    }
    return { ok: true, tomTat: text(json["tomTat"], 400), muc, model: outcome.model };
  }
}
