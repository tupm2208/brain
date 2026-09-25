/**
 * @file IMAGE INTAKE (Giai đoạn 5, 25/09/2026): what the customer's photos ARE, before any model
 * writes. Moved out of the pipeline (`readPhotos`) and grown to Desk's image path
 * (`agent_level2.js` `fetchImageDataUrl`, `ai_router.js` image classification):
 *
 *   - the picture is DOWNLOADED and handed to the model as a data URL (`ImageFetcher`): Meta's CDN
 *     refuses the first fetches for a few seconds, so one retry after 1.5 s; a download that still
 *     fails falls back to the address, as before;
 *   - a photo older than 15 minutes is history, not "the picture the customer just sent";
 *   - the model says what KIND of picture it is — a product, a transfer receipt, an order screen,
 *     or something else — with the amount / order code it can read. The prompt is data
 *     (`loi-chung/xem-anh.json` ⊕ `nganh/<id>/xem-anh.json`);
 *   - each product photo (at most three) is matched against the shop's own catalogue photos by the
 *     landing (`catalog.matchImage`); a photo shared by several codes is NEVER resolved by picking one;
 *   - a photo the page just asked for as a size reference (the shoe the customer wears) is a
 *     REFERENCE, not something to sell.
 * The result is data for the router (a receipt hands over before any model writes), the notes,
 * the memory (image labels) and the dossier (download / reading errors).
 */

import type { ToolName } from "@sp/contract";
import { stripDiacritics, type OneShotPromptText } from "@sp/brain";
import type { ChatModelPort } from "../agent/chat-model";
import { parseAgentJson } from "../agent/sales-agent";
import { withUsage } from "../ai/usage-context";
import type { MerchantBinding } from "./brain-service";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

/** A photo older than this is not "the picture the customer just sent" (Desk: 15 minutes). */
export const IMAGE_FRESH_MS = 15 * 60_000;
export const IMAGE_FETCH_TIMEOUT_MS = 20_000;
export const IMAGE_FETCH_RETRY_MS = 1500;
/** At most this many photos are read per turn. */
export const IMAGES_PER_TURN = 3;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export type ImageKind = "san_pham" | "bien_lai" | "don_hang" | "khac";

/** Minimal fetch the fetcher needs; `globalThis.fetch` fits, tests hand in a fake. */
export type ImageFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface ImageFetcherOptions {
  fetch: ImageFetch;
  timeoutMs?: number | undefined;
  retryDelayMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** Downloads a photo into a data URL the model accepts (jpeg / png forced). */
export class ImageFetcher {
  constructor(private readonly options: ImageFetcherOptions) {}

  async toDataUrl(url: string): Promise<{ dataUrl: string } | { error: string }> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const r = await this.options.fetch(url, { signal: AbortSignal.timeout(this.options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS) });
        if (!r.ok) { lastError = `HTTP ${r.status}`; }
        else {
          const buffer = Buffer.from(await r.arrayBuffer());
          if (buffer.byteLength === 0) lastError = "anh rong";
          else if (buffer.byteLength > IMAGE_MAX_BYTES) return { error: `anh qua lon (${Math.round(buffer.byteLength / 1024)} KB)` };
          else {
            const declared = String(r.headers.get("content-type") ?? "").toLowerCase();
            const mime = declared.includes("png") || buffer.subarray(0, 4).toString("hex") === "89504e47" ? "image/png" : "image/jpeg";
            return { dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt === 1) await sleep(this.options.retryDelayMs ?? IMAGE_FETCH_RETRY_MS);
    }
    return { error: lastError || "khong tai duoc anh" };
  }
}

/** What the model read off one photo, and what the landing matched it to. */
export interface ImageLook {
  url: string;
  loai: ImageKind;
  brand: string;
  model: string;
  color: string;
  code: string;
  amount: number;
  orderCode: string;
  text: string;
  confidence: number;
  /** The landing's verdict for a product photo. */
  chot: { ket: "tu_tin"; ma: string; ten: string } | { ket: "hoi_lai"; luaChon: { ma: string; ten: string }[] } | null;
  candidates: { ma: string; ten: string }[];
  /** Download / reading / matching problems, for the dossier. */
  loi: string[];
}

/** What one turn's photos produced, for the pipeline: the first product read, the verdict, the note, the kind. */
export interface PhotoReading {
  ok: boolean;
  read: { brand: string; model: string; color: string; code: string };
  chot: ImageLook["chot"];
  note: string | null;
  /** The strongest kind among the photos: a receipt beats an order screen beats a product. */
  loai: ImageKind;
  /** A transfer receipt: the amount read (0 when unreadable) and the visible text. */
  bienLai?: { amount: number; text: string } | undefined;
  /** Order codes read off order screens. */
  maDon: string[];
  /** The photo is the shoe the customer WEARS (the page asked for it): a size reference, not something to sell. */
  thamChieu: boolean;
  looks: ImageLook[];
  /** Every error of the turn's photos, for the dossier. */
  loi: string[];
}

export interface ImageIntakeOptions {
  vision: ChatModelPort | null;
  fetcher: ImageFetcher | null;
  logger: Logger;
  clock: Clock;
}

export interface ImageIntakeInput {
  tenant: string;
  binding: MerchantBinding;
  photos: readonly { url: string; at?: string | undefined }[];
  kenh?: string | undefined;
  conversationId: string;
  text: OneShotPromptText;
  /** The page just asked for the shoe the customer wears / the tag (frame `asked_size`): the photo is a reference. */
  reference?: boolean | undefined;
  /** Regexes (accent-stripped) that make a photo a RECEIPT by its visible text ("chuyen khoan thanh cong"), from the ledger texts. */
  receiptTextPatterns?: readonly string[] | undefined;
}

/** The fixed answer shape; the JSON only adds what to look for. */
const SCHEMA = "{\"loai\":\"san_pham|bien_lai|don_hang|khac\",\"brand\":\"\",\"model\":\"\",\"color\":\"\",\"code\":\"\",\"amount\":0,\"orderCode\":\"\",\"text\":\"\",\"confidence\":0.0}";

/** The words used before the prompt became data; kept as the fallback for a source without `xem-anh.json`. */
const FALLBACK_SYSTEM = "Anh chup giay / do the thao ma khach gui. Nhan dien de tra catalog. Khong doan ma neu khong thay tem. Khong bia gia. Chi tra JSON.";

export class ImageIntake {
  constructor(private readonly options: ImageIntakeOptions) {}

  ready(): boolean {
    return this.options.vision !== null && this.options.vision.ready();
  }

  /** `null` when there is nothing to read (no fresh https photo, or no vision model). */
  async read(input: ImageIntakeInput): Promise<PhotoReading | null> {
    const nowMs = this.options.clock.now().getTime();
    const urls = input.photos
      .filter((p) => /^https:\/\//i.test(p.url))
      .filter((p) => { const at = Date.parse(p.at ?? ""); return !Number.isFinite(at) || nowMs - at <= IMAGE_FRESH_MS; })
      .map((p) => p.url)
      .slice(0, IMAGES_PER_TURN);
    if (urls.length === 0) return null;
    const vision = this.options.vision;
    if (vision === null || !vision.ready()) return null;

    const looks: ImageLook[] = [];
    for (let i = 0; i < urls.length; i += 1) looks.push(await this.readOne(input, urls[i]!, i, urls.length, vision));

    const receipt = looks.find((l) => l.loai === "bien_lai");
    const orders = looks.filter((l) => l.loai === "don_hang");
    const products = looks.filter((l) => l.loai === "san_pham");
    const first = products[0] ?? looks[0]!;
    const loai: ImageKind = receipt !== undefined ? "bien_lai" : orders.length > 0 ? "don_hang" : products.length > 0 ? "san_pham" : "khac";
    const chot = products.find((l) => l.chot?.ket === "tu_tin")?.chot ?? products.find((l) => l.chot?.ket === "hoi_lai")?.chot ?? null;
    const reading: PhotoReading = {
      ok: looks.some((l) => l.confidence > 0 || l.loai !== "khac" || l.model !== "" || l.code !== ""),
      read: { brand: first.brand, model: first.model, color: first.color, code: first.code },
      chot, note: null, loai,
      ...(receipt !== undefined ? { bienLai: { amount: receipt.amount, text: receipt.text } } : {}),
      maDon: [...new Set(orders.map((l) => l.orderCode).filter((c) => c !== ""))],
      thamChieu: input.reference === true && products.length > 0,
      looks,
      loi: looks.flatMap((l) => l.loi)
    };
    reading.note = this.noteOf(reading);
    return reading;
  }

  private async readOne(input: ImageIntakeInput, url: string, index: number, total: number, vision: ChatModelPort): Promise<ImageLook> {
    const look: ImageLook = { url, loai: "khac", brand: "", model: "", color: "", code: "", amount: 0, orderCode: "", text: "", confidence: 0, chot: null, candidates: [], loi: [] };
    let shown = url;
    if (this.options.fetcher !== null) {
      const fetched = await this.options.fetcher.toDataUrl(url);
      if ("dataUrl" in fetched) shown = fetched.dataUrl;
      else { look.loi.push(`tai anh: ${fetched.error}`); this.options.logger.warn(`[anh] ${input.conversationId}: khong tai duoc anh (${fetched.error}) — gui dia chi cho mo hinh`); }
    }
    const t = input.text;
    const multi = total > 1 ? (t.nhan["nhieuAnh"] ?? "Anh thu {i} trong {n}.").replace("{i}", String(index + 1)).replace("{n}", String(total)) : "";
    const system = [t.heThong || FALLBACK_SYSTEM, ...t.huongDan, `${t.nhan["schema"] ?? "Tra DUY NHAT mot JSON:"} ${SCHEMA}`].join("\n");
    const outcome = await withUsage({ shop: input.tenant, agent: "image_match", channel: input.kenh ?? "facebook", conversationId: input.conversationId }, () => vision.complete([
      { role: "system", content: system },
      { role: "user", content: `Nhận diện ảnh khách gửi.${multi !== "" ? ` ${multi}` : ""}`, images: [shown] }
    ], { timeoutMs: 45_000, json: true }));
    if (!outcome.ok) {
      look.loi.push(`doc anh: ${outcome.viSao}`);
      this.options.logger.warn(`[anh] ${input.conversationId}: doc anh hong (${outcome.viSao})`);
      return look;
    }
    const read = parseAgentJson(outcome.text);
    if (read === null) { look.loi.push("doc anh: JSON khong doc duoc"); return look; }
    const s = (v: unknown, n: number): string => String(v ?? "").trim().slice(0, n);
    const kind = s(read["loai"], 20);
    look.loai = kind === "bien_lai" || kind === "don_hang" || kind === "khac" ? kind : "san_pham";
    look.brand = s(read["brand"], 40); look.model = s(read["model"], 120); look.color = s(read["color"], 60);
    look.code = s(read["code"], 24).toUpperCase().replace(/[^A-Z0-9-]/g, "");
    look.amount = Math.max(0, Math.round(Number(read["amount"]) || 0));
    look.orderCode = s(read["orderCode"], 40).toUpperCase();
    look.text = s(read["text"], 300);
    look.confidence = Math.min(1, Math.max(0, Number(read["confidence"]) || 0));
    if (look.loai === "khac" && (look.model !== "" || look.code !== "")) look.loai = "san_pham";
    // Desk `classifyNonProductImage`: the visible text of a bank screen makes it a receipt whatever the model called it.
    const visible = stripDiacritics(`${look.text} ${look.model}`).toLowerCase();
    if (look.loai !== "bien_lai" && (input.receiptTextPatterns ?? []).some((p) => { try { return p !== "" && new RegExp(p).test(visible); } catch { return false; } })) look.loai = "bien_lai";

    // The picture against the shop's own catalogue photos; the shop holds the photos, Xeon never does.
    if (look.loai === "san_pham" && input.binding.gateway.tools.available().includes("catalog.matchImage" as ToolName)) {
      const answer = await input.binding.gateway.tools.call("catalog.matchImage" as ToolName, { anh: url, maDocDuoc: look.code } as never);
      if (!answer.ok) { look.loi.push(`khop anh: ${answer.error.message}`); this.options.logger.warn(`[anh] ${input.conversationId}: landing khong khop duoc anh (${answer.error.message})`); }
      else {
        const verdict = answer.data as unknown as { chot?: { ket?: string; ma?: string; luaChon?: string[] }; ungVien?: { ma?: string; ten?: string }[] };
        look.candidates = (verdict.ungVien ?? []).map((c) => ({ ma: String(c.ma ?? ""), ten: String(c.ten ?? "") }));
        const named = (ma: string): string => look.candidates.find((c) => c.ma.toUpperCase() === ma.toUpperCase())?.ten ?? "";
        const chot = verdict.chot;
        if (chot?.ket === "tu_tin" && chot.ma) look.chot = { ket: "tu_tin", ma: chot.ma, ten: named(chot.ma) };
        else if (chot?.ket === "hoi_lai") look.chot = { ket: "hoi_lai", luaChon: (chot.luaChon ?? []).map((ma) => ({ ma, ten: named(ma) })) };
      }
    }
    return look;
  }

  /** The line the models read. `null` when the photos said nothing usable. */
  private noteOf(r: PhotoReading): string | null {
    const named = (code: string, ten: string): string => (ten !== "" ? `${code} (${ten})` : code);
    if (r.loai === "bien_lai") {
      return `ẢNH KHÁCH GỬI LÀ BIÊN LAI CHUYỂN KHOẢN${r.bienLai && r.bienLai.amount > 0 ? ` (số tiền đọc được ${r.bienLai.amount.toLocaleString("vi-VN")}đ)` : ""}. Hệ thống đã báo người phụ trách đối chiếu; KHÔNG khẳng định tiền đã vào.`;
    }
    if (r.loai === "don_hang") {
      return `ẢNH KHÁCH GỬI LÀ MÀN HÌNH ĐƠN HÀNG${r.maDon.length > 0 ? ` (mã đọc được: ${r.maDon.join(", ")})` : ""} — trả lời theo khối đơn hàng trong ghi chú, KHÔNG bịa trạng thái đơn.`;
    }
    const seen = [r.read.brand, r.read.model, r.read.color].filter((x) => x !== "").join(" ");
    if (r.loai === "khac" && seen === "" && r.read.code === "") return null;
    const head = `ẢNH KHÁCH GỬI: ${seen || "chưa mô tả được"}${r.read.code ? `; chữ đọc được trên ảnh: ${r.read.code}` : ""}.`;
    if (r.thamChieu) {
      return `${head} Đây là ĐÔI KHÁCH ĐANG ĐI (page vừa hỏi để ướm size) — chỉ dùng làm THAM CHIẾU size/form, KHÔNG chào bán, KHÔNG tra kho mẫu này thay mẫu khách đang hỏi.`;
    }
    if (r.chot?.ket === "tu_tin") return `${head} Ảnh trùng ảnh catalog của mã ${named(r.chot.ma, r.chot.ten)} — tra kho theo mã này.`;
    if (r.chot?.ket === "hoi_lai") {
      const choices = r.chot.luaChon.map((c) => named(c.ma, c.ten)).join(" hoặc ");
      return `${head} CHƯA CHẮC là mã nào${choices ? ` — có thể ${choices}` : ""}. PHẢI hỏi khách xác nhận mẫu (hoặc xin ảnh tem / ảnh rõ hơn); KHÔNG được tự chọn một mã, KHÔNG lấy mã đã nói ở các tin trước.`;
    }
    if (seen === "" && r.read.code === "") return null;
    return `${head} Chưa đối chiếu được với ảnh catalog của shop — tra kho theo tên/mã đọc được, chưa chắc thì hỏi lại khách.`;
  }
}
