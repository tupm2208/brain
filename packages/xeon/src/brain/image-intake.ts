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
import type { ImageShrink } from "./image-shrink";

/** A photo older than this is not "the picture the customer just sent" (Desk: 15 minutes). */
export const IMAGE_FRESH_MS = 15 * 60_000;
export const IMAGE_FETCH_TIMEOUT_MS = 20_000;
export const IMAGE_FETCH_RETRY_MS = 1500;
/** At most this many photos are read per turn. */
export const IMAGES_PER_TURN = 3;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Catalogue comparison (01/10/2026): at most this many of the shop's own photos beside the
 * customer's. Eight took 4–6 s; sixteen took 11–15 s for the same answer.
 */
export const COMPARE_CANDIDATES = 10;
/** Pixel box of the customer's photo and of each catalogue photo in the comparison (Desk: 512 / 256). */
export const COMPARE_CUSTOMER_PX = 512;
export const COMPARE_CANDIDATE_PX = 256;
/** The comparison runs this many times side by side; only what every run chose counts as the same item. */
export const COMPARE_RUNS = 2;
/**
 * The customer's photo as the AGENT sees it (02/10/2026), and a catalogue photo it asks to look at:
 * the sizes the measurement ran with (87% right, none wrong) — print on a box or a tag stays readable at 1600.
 */
export const AGENT_PHOTO_PX = 1600;
export const AGENT_CATALOG_PX = 512;
/**
 * Each photo is read this many times side by side (01/10/2026). One reading names a line from
 * memory: the same photo was read as its own line three times and as a different line once, and
 * everything after (search, comparison, reply) followed that one guess.
 */
export const READ_RUNS = 2;

export type ImageKind = "san_pham" | "bien_lai" | "don_hang" | "khac";

/** Minimal fetch the fetcher needs; `globalThis.fetch` fits, tests hand in a fake. */
export type ImageFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface ImageFetcherOptions {
  fetch: ImageFetch;
  timeoutMs?: number | undefined;
  retryDelayMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Shrinks photos for the catalogue comparison; absent = they go at full size (slower, same answer). */
  shrink?: ImageShrink | null | undefined;
}

/** A downloaded photo. */
export interface DownloadedImage {
  buffer: Buffer;
  mime: "image/png" | "image/jpeg";
}

/** Downloads a photo into a data URL the model accepts (jpeg / png forced). */
export class ImageFetcher {
  constructor(private readonly options: ImageFetcherOptions) {}

  async toDataUrl(url: string): Promise<{ dataUrl: string } | { error: string }> {
    const got = await this.download(url);
    return "error" in got ? got : { dataUrl: ImageFetcher.dataUrlOf(got) };
  }

  /** The picture itself, with one retry (Meta's CDN refuses the first fetches for a few seconds). */
  async download(url: string): Promise<DownloadedImage | { error: string }> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const r = await this.options.fetch(url, { signal: AbortSignal.timeout(this.options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS) });
        if (!r.ok) { lastError = `HTTP ${r.status}`; }
        else {
          const buffer = Buffer.from(await r.arrayBuffer());
          const declaredType = String(r.headers.get("content-type") ?? "").toLowerCase();
          if (buffer.byteLength === 0) lastError = "anh rong";
          // A page (a wrong address answered with HTML) sent as a "photo" stalls the model until its time-out.
          else if (declaredType.startsWith("text/") || declaredType.includes("html") || declaredType.includes("json")) return { error: `khong phai anh (${declaredType})` };
          else if (buffer.byteLength > IMAGE_MAX_BYTES) return { error: `anh qua lon (${Math.round(buffer.byteLength / 1024)} KB)` };
          else {
            const declared = String(r.headers.get("content-type") ?? "").toLowerCase();
            const mime = declared.includes("png") || buffer.subarray(0, 4).toString("hex") === "89504e47" ? "image/png" : "image/jpeg";
            return { buffer, mime };
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt === 1) await sleep(this.options.retryDelayMs ?? IMAGE_FETCH_RETRY_MS);
    }
    return { error: lastError || "khong tai duoc anh" };
  }

  /** The picture shrunk to fit `maxPx` (JPEG); the full picture when no shrinker is installed or it fails. */
  async small(image: DownloadedImage, maxPx: number, quality: number): Promise<string> {
    const shrink = this.options.shrink;
    if (shrink) {
      try { return `data:image/jpeg;base64,${(await shrink(image.buffer, maxPx, quality)).toString("base64")}`; }
      catch { /* an odd format sharp cannot read still goes, at full size */ }
    }
    return ImageFetcher.dataUrlOf(image);
  }

  static dataUrlOf(image: DownloadedImage): string {
    return `data:${image.mime};base64,${image.buffer.toString("base64")}`;
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
  /** The shortest line name to search the catalogue with: no version, no technology word. */
  tuKhoa: string;
  /** The other reading when the two readings named different lines (and the catalogue did not settle it); `null` when they agree. */
  docKhac: ReadLine | null;
  /**
   * The line read off the photo is not confirmed: the readings disagree, or none of the shop's
   * photos of that line shows the same line. Then the line name is a guess, not a fact.
   */
  dongChuaChac: boolean;
  /** The photo laid beside the shop's own catalogue photos; `null` when that did not run. */
  soSanh: CatalogComparison | null;
  /** The landing's verdict for a product photo. */
  chot: { ket: "tu_tin"; ma: string; ten: string } | { ket: "hoi_lai"; luaChon: { ma: string; ten: string }[] } | null;
  candidates: { ma: string; ten: string }[];
  /** Download / reading / matching problems, for the dossier. */
  loi: string[];
  /** The photo as the agent will see it (data URL, `AGENT_PHOTO_PX`), when the agent sees photos this turn. Never written anywhere. */
  xem?: string | undefined;
}

/** One catalogue item shown to the model. */
export interface CompareCandidate { ma: string; ten: string }

/** What one reading named: the line to search the catalogue with. */
export interface ReadLine { brand: string; model: string; tuKhoa: string; color: string }

/** One reading of one photo, before the readings are put together. */
interface PhotoRead extends ReadLine {
  loai: ImageKind;
  code: string;
  amount: number;
  orderCode: string;
  text: string;
  confidence: number;
}

/**
 * The customer's photo against the shop's own catalogue photos. `cungPhienBan`: same item, same
 * version (any colour); `trungMau`: of those, the same colour too. Both empty with candidates
 * shown = the shop has nothing of that version — whatever the model would have guessed from memory.
 */
export interface CatalogComparison {
  ungVien: CompareCandidate[];
  /** Of the same LINE as the photo (any version, any colour), by every run's eye. */
  cungDong: CompareCandidate[];
  /** Every run saw candidates of the photo's line among those of one reading: the line read is real. */
  dongXacNhan: boolean;
  /** Which reading (0 / 1) the confirmed candidates came from; -1 when none. */
  docKhop: number;
  cungPhienBan: CompareCandidate[];
  trungMau: CompareCandidate[];
  /** Chosen by one run only: never "the same item", at most something to show the customer. */
  coTheLa: CompareCandidate[];
  /**
   * The runs did not agree whether the candidates are of the photo's line (one saw the line, another
   * did not). Not the same as "none is of that line" — said apart since 02/10/2026 (a photo of a
   * neighbouring line was told to the customer as "not recognised at all").
   */
  dongBatDong: boolean;
  /** Every run answered, they chose the same items, and the catalogue does not contradict them. */
  chacChan: boolean;
  /** Versions (by the catalogue's names) the photo could not tell apart; empty when it could. */
  lanDoi: string[];
  moTa: string;
  tuKhoa: string;
}

/** What one turn's photos produced, for the pipeline: the first product read, the verdict, the note, the kind. */
export interface PhotoReading {
  ok: boolean;
  read: { brand: string; model: string; color: string; code: string };
  chot: ImageLook["chot"];
  /** The first product photo's catalogue comparison. */
  soSanh: CatalogComparison | null;
  /** The first product photo's line is not confirmed (`ImageLook.dongChuaChac`): never a fact to repeat or remember. */
  dongChuaChac: boolean;
  note: string | null;
  /**
   * The same note worded for a reader that does NOT see the photo (02/10/2026): set when `note` was
   * worded for an agent that does — the one-shot draft (LLM#3) behind the agent never sees pictures.
   */
  noteBlind?: string | null | undefined;
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
  /** The comparison prompt (`loi-chung/so-anh-catalog.json` ⊕ industry); absent or empty = no comparison. */
  compareText?: OneShotPromptText | undefined;
  /** Regexes (accent-stripped) that make a photo a RECEIPT by its visible text ("chuyen khoan thanh cong"), from the ledger texts. */
  receiptTextPatterns?: readonly string[] | undefined;
  /**
   * The agent will SEE these photos (02/10/2026): each photo is also prepared at the agent's size,
   * and the note is worded as the system's reading for it to check, not as the last word.
   */
  agentSees?: boolean | undefined;
}

/** The fixed answer shape; the JSON only adds what to look for. */
const SCHEMA = "{\"loai\":\"san_pham|bien_lai|don_hang|khac\",\"brand\":\"\",\"model\":\"\",\"tuKhoa\":\"\",\"color\":\"\",\"code\":\"\",\"amount\":0,\"orderCode\":\"\",\"text\":\"\",\"confidence\":0.0}";

/** The comparison's fixed answer shape. */
// `nhanXet` comes FIRST: the model names what it sees and how each group differs before it picks —
// picking first, it lumped neighbouring versions together (01/10/2026).
// `cungDong` before `cungPhienBan`: first "is this even the line read?", then "which version?" (01/10/2026).
const COMPARE_SCHEMA = "{\"nhanXet\":\"\",\"cungDong\":[],\"cungPhienBan\":[],\"trungMau\":[],\"chacChan\":0.0}";

/** The words used before the prompt became data; kept as the fallback for a source without `xem-anh.json`. */
const FALLBACK_SYSTEM = "Anh chup giay / do the thao ma khach gui. Nhan dien de tra catalog. Khong doan ma neu khong thay tem. Khong bia gia. Chi tra JSON.";

export class ImageIntake {
  constructor(private readonly options: ImageIntakeOptions) {}

  ready(): boolean {
    return this.options.vision !== null && this.options.vision.ready();
  }

  /**
   * A picture the AGENT asks to look at (`xem_anh`, 02/10/2026): a photo the customer sent earlier at
   * the reading size, a catalogue photo at the comparison size. `null` when it cannot be fetched.
   */
  async view(url: string, kind: "khach" | "catalog"): Promise<string | null> {
    const fetcher = this.options.fetcher;
    if (fetcher === null || !/^https?:\/\//i.test(url)) return null;
    const got = await fetcher.download(url);
    if ("error" in got) return null;
    return kind === "khach" ? fetcher.small(got, AGENT_PHOTO_PX, 85) : fetcher.small(got, AGENT_CATALOG_PX, 80);
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
    const soSanh = products.find((l) => l.soSanh !== null)?.soSanh ?? null;
    const reading: PhotoReading = {
      ok: looks.some((l) => l.confidence > 0 || l.loai !== "khac" || l.model !== "" || l.code !== ""),
      read: { brand: first.brand, model: first.model, color: first.color, code: first.code },
      chot, soSanh, dongChuaChac: products[0]?.dongChuaChac ?? false, note: null, loai,
      ...(receipt !== undefined ? { bienLai: { amount: receipt.amount, text: receipt.text } } : {}),
      maDon: [...new Set(orders.map((l) => l.orderCode).filter((c) => c !== ""))],
      thamChieu: input.reference === true && products.length > 0,
      looks,
      loi: looks.flatMap((l) => l.loi)
    };
    reading.note = this.noteOf(reading, input.agentSees === true);
    if (input.agentSees === true) reading.noteBlind = this.noteOf(reading, false);
    return reading;
  }

  private async readOne(input: ImageIntakeInput, url: string, index: number, total: number, vision: ChatModelPort): Promise<ImageLook> {
    const look: ImageLook = { url, loai: "khac", brand: "", model: "", color: "", code: "", tuKhoa: "", amount: 0, orderCode: "", text: "", confidence: 0, docKhac: null, dongChuaChac: false, soSanh: null, chot: null, candidates: [], loi: [] };
    let shown = url;
    let picture: DownloadedImage | null = null;
    if (this.options.fetcher !== null) {
      const fetched = await this.options.fetcher.download(url);
      if (!("error" in fetched)) {
        picture = fetched; shown = ImageFetcher.dataUrlOf(fetched);
        // Downloaded once: the agent's copy is made here, not fetched again from a CDN that refuses quick refetches.
        if (input.agentSees === true) look.xem = await this.options.fetcher.small(fetched, AGENT_PHOTO_PX, 85);
      }
      else { look.loi.push(`tai anh: ${fetched.error}`); this.options.logger.warn(`[anh] ${input.conversationId}: khong tai duoc anh (${fetched.error}) — gui dia chi cho mo hinh`); }
    }
    const t = input.text;
    const multi = total > 1 ? (t.nhan["nhieuAnh"] ?? "Anh thu {i} trong {n}.").replace("{i}", String(index + 1)).replace("{n}", String(total)) : "";
    const system = [t.heThong || FALLBACK_SYSTEM, ...t.huongDan, `${t.nhan["schema"] ?? "Tra DUY NHAT mot JSON:"} ${SCHEMA}`].join("\n");
    const readOnce = async (): Promise<PhotoRead | null> => {
      const outcome = await withUsage({ shop: input.tenant, agent: "image_match", channel: input.kenh ?? "facebook", conversationId: input.conversationId }, () => vision.complete([
        { role: "system", content: system },
        { role: "user", content: `Nhận diện ảnh khách gửi.${multi !== "" ? ` ${multi}` : ""}`, images: [shown] }
      ], { timeoutMs: 45_000, json: true }));
      if (!outcome.ok) {
        look.loi.push(`doc anh: ${outcome.viSao}`);
        this.options.logger.warn(`[anh] ${input.conversationId}: doc anh hong (${outcome.viSao})`);
        return null;
      }
      const read = parseAgentJson(outcome.text);
      if (read === null) { look.loi.push("doc anh: JSON khong doc duoc"); return null; }
      return parsePhotoRead(read, input.receiptTextPatterns ?? []);
    };
    // AGREEMENT: the photo is read twice side by side (no extra wait), like the comparison below.
    const reads = (await Promise.all(Array.from({ length: READ_RUNS }, readOnce))).filter((r): r is PhotoRead => r !== null);
    if (reads.length === 0) return look;
    // The strongest kind any reading saw: a receipt beats an order screen beats a product.
    const kind = reads.map((r) => r.loai).sort((a, b) => KIND_STRENGTH[b] - KIND_STRENGTH[a])[0]!;
    const lead = reads.find((r) => r.loai === kind)!;
    Object.assign(look, {
      loai: kind, brand: lead.brand, model: lead.model, color: lead.color, tuKhoa: lead.tuKhoa, text: lead.text, confidence: lead.confidence,
      // A code, an amount, an order code printed on the photo: whichever reading caught it.
      code: lead.code || (reads.find((r) => r.code !== "")?.code ?? ""),
      amount: lead.amount || Math.max(0, ...reads.map((r) => r.amount)),
      orderCode: lead.orderCode || (reads.find((r) => r.orderCode !== "")?.orderCode ?? "")
    });
    const other = reads.find((r) => r !== lead && r.loai === "san_pham" && !linesAgree(lead, r));
    if (kind === "san_pham" && other !== undefined) look.docKhac = { brand: other.brand, model: other.model, tuKhoa: other.tuKhoa, color: other.color };

    // The picture against the shop's own catalogue photos; the shop holds the photos, Xeon never does.
    if (look.loai === "san_pham" && input.binding.gateway.tools.available().includes("catalog.matchImage" as ToolName)) {
      const answer = await input.binding.gateway.tools.call("catalog.matchImage" as ToolName, { anh: url, maDocDuoc: look.code } as never);
      if (!answer.ok) { look.loi.push(`khop anh: ${answer.error.message}`); this.options.logger.warn(`[anh] ${input.conversationId}: landing khong khop duoc anh (${answer.error.message})`); }
      else {
        const verdict = answer.data as unknown as { chot?: { ket?: string; ma?: string; viSao?: string; luaChon?: string[] }; ungVien?: { ma?: string; ten?: string }[] };
        look.candidates = (verdict.ungVien ?? []).map((c) => ({ ma: String(c.ma ?? ""), ten: String(c.ten ?? "") }));
        const named = (ma: string): string => look.candidates.find((c) => c.ma.toUpperCase() === ma.toUpperCase())?.ten ?? "";
        look.chot = crossCheckFingerprint(verdict.chot ?? null, named, look, (why) => look.loi.push(why));
      }
    }

    // 01/10/2026: a photo the fingerprint could not pin down is laid beside the shop's own catalogue
    // photos. A model guesses an item's version from memory unreliably; comparing two pictures it does
    // well. A size-reference photo (the shoe the customer wears) is not something to look up.
    if (look.loai === "san_pham" && look.chot?.ket !== "tu_tin" && input.reference !== true && picture !== null) {
      const lines: ReadLine[] = [{ brand: look.brand, model: look.model, tuKhoa: look.tuKhoa, color: look.color }, ...(look.docKhac !== null ? [look.docKhac] : [])];
      look.soSanh = await this.compare(input, look, lines, picture, vision);
      const cmp = look.soSanh;
      // The shop's photos settled which reading was right: that line is what the photo shows.
      if (cmp !== null && cmp.docKhop >= 0) {
        Object.assign(look, lines[cmp.docKhop]!);
        look.docKhac = null;
      }
      const same = cmp === null ? [] : cmp.trungMau.length ? cmp.trungMau : cmp.cungPhienBan.length ? cmp.cungPhienBan : cmp.coTheLa;
      // Never a confident pick from a comparison: the customer confirms (the note says so).
      if (look.chot === null && same.length > 0) look.chot = { ket: "hoi_lai", luaChon: same.slice(0, 4) };
    }
    if (look.loai === "san_pham" && look.chot?.ket !== "tu_tin") {
      const cmp = look.soSanh;
      look.dongChuaChac = cmp !== null && cmp.ungVien.length > 0 ? !cmp.dongXacNhan && look.chot === null : look.docKhac !== null;
    }
    return look;
  }

  /**
   * The customer's photo beside up to `COMPARE_CANDIDATES` catalogue photos, in one call.
   * Candidates come from the landing's own search by the line name each reading gave (no version —
   * the version is exactly what the model cannot be trusted to read); two readings that disagree
   * bring candidates of both lines, and the pictures decide. `null` = it could not run (no prompt,
   * no search, no line name, a model error); the note then says "not matched".
   */
  private async compare(input: ImageIntakeInput, look: ImageLook, lines: readonly ReadLine[], picture: DownloadedImage, vision: ChatModelPort): Promise<CatalogComparison | null> {
    const t = input.compareText;
    const fetcher = this.options.fetcher;
    if (t === undefined || t.heThong === "" || fetcher === null) return null;
    if (!input.binding.gateway.tools.available().includes("catalog.find" as ToolName)) return null;
    // Per reading: the FULL line name first ("family line"), the model's short keyword only when that
    // finds nothing: a keyword can be a family name ("family") that brings back other lines (01/10/2026).
    const searches = lines.map((l) => {
      const line = lineWithoutVersion(l.model, l.brand);
      return { line, queries: [...new Set([line, stripDiacritics(l.tuKhoa).toLowerCase().trim()].filter((q) => q.length >= 2))] };
    });
    if (searches.every((s) => s.queries.length === 0)) return null;
    const pools: Pooled[][] = [];
    for (let doc = 0; doc < searches.length; doc += 1) {
      let pool: Pooled[] = [];
      for (const q of searches[doc]!.queries) {
        const found = await input.binding.gateway.tools.call("catalog.find" as ToolName, { ten: q } as never);
        if (!found.ok) { look.loi.push(`so anh: tra kho loi (${found.error.message})`); continue; }
        const items = (found.data as unknown as { ketQua?: unknown }).ketQua;
        pool = pickCandidates(Array.isArray(items) ? items : []).map((c) => ({ ...c, q, doc }));
        if (pool.length > 0) break;
      }
      pools.push(pool);
    }
    const tuKhoa = pools[0]?.[0]?.q ?? searches[0]?.queries[0] ?? "";
    const pool = interleave(pools);
    if (pool.length === 0) return { ungVien: [], cungDong: [], dongXacNhan: false, docKhop: -1, cungPhienBan: [], trungMau: [], coTheLa: [], dongBatDong: false, chacChan: false, lanDoi: [], moTa: "", tuKhoa };

    const shown = await Promise.all(pool.map(async (c) => {
      const got = await fetcher.download(c.anh);
      return "error" in got ? null : { ma: c.ma, ten: c.ten, q: c.q, doc: c.doc, dataUrl: await fetcher.small(got, COMPARE_CANDIDATE_PX, 72) };
    }));
    const ungVien = shown.filter((c): c is NonNullable<typeof c> => c !== null);
    if (ungVien.length === 0) { look.loi.push("so anh: khong tai duoc anh catalog nao"); return null; }

    const label = (key: string, fallback: string): string => t.nhan[key] ?? fallback;
    // Each label sits right before its picture: with all labels first and all pictures after, the
    // model lumped neighbouring versions together (01/10/2026: 0/4 against 3/3 with labels in place).
    const intro = label("soUngVien", "Co {n} ung vien tu catalog cua shop.").replace("{n}", String(ungVien.length));
    const captions = [label("anhKhach", "Anh khach gui:"), ...ungVien.map((c, i) => label("ungVien", "UNG VIEN {i}: {ma} — {ten}").replace("{i}", String(i)).replace("{ma}", c.ma).replace("{ten}", c.ten))];
    const system = [t.heThong, ...t.huongDan, `${label("schema", "Tra DUY NHAT mot JSON:")} ${COMPARE_SCHEMA}`].join("\n");
    const customer = await fetcher.small(picture, COMPARE_CUSTOMER_PX, 80);
    const once = async (): Promise<{ dong: number[]; cung: number[]; trung: number[]; nhanXet: string } | null> => {
      const outcome = await withUsage({ shop: input.tenant, agent: "image_compare", channel: input.kenh ?? "facebook", conversationId: input.conversationId }, () => vision.complete([
        { role: "system", content: system },
        { role: "user", content: intro, images: [customer, ...ungVien.map((c) => c.dataUrl)], imageCaptions: captions }
      ], { timeoutMs: 45_000, json: true }));
      if (!outcome.ok) { look.loi.push(`so anh: ${outcome.viSao}`); this.options.logger.warn(`[anh] ${input.conversationId}: so anh catalog hong (${outcome.viSao})`); return null; }
      const answer = parseAgentJson(outcome.text);
      if (answer === null) { look.loi.push("so anh: JSON khong doc duoc"); return null; }
      const idx = (v: unknown): number[] => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < ungVien.length))];
      const trung = idx(answer["trungMau"]);
      // A colour match is a version match, and a version match a line match, whatever list the model put it in.
      const cung = [...new Set([...idx(answer["cungPhienBan"]), ...trung])];
      return { dong: [...new Set([...idx(answer["cungDong"]), ...cung])], cung, trung, nhanXet: String(answer["nhanXet"] ?? answer["moTa"] ?? "").trim() };
    };
    // AGREEMENT: the same comparison twice, side by side (no extra wait). Only what BOTH runs chose is
    // "the same item"; what one run alone chose is only "maybe". One model answer is a guess — it
    // swung between versions from one wording to the next (01/10/2026).
    const runs = (await Promise.all(Array.from({ length: COMPARE_RUNS }, once))).filter((r): r is NonNullable<typeof r> => r !== null);
    if (runs.length === 0) return null;
    const both = (key: "cung" | "trung"): number[] => runs[0]![key].filter((i) => runs.every((r) => r[key].includes(i)));
    const any = (key: "dong" | "cung"): number[] => [...new Set(runs.flatMap((r) => r[key]))];
    // TEXT BEATS LOOKS: a version number READ on the photo (the reading prompt allows one only when
    // printed) rules out a candidate whose name carries another number after the same line word.
    const ruledOut = (i: number): boolean => {
      const c = ungVien[i]!;
      const readVersion = versionAfter(lines[c.doc]!.model, c.q);
      return readVersion !== "" && (versionAfter(c.ten, c.q) || readVersion) !== readVersion;
    };
    const named = (ids: number[]): CompareCandidate[] => ids.filter((i) => !ruledOut(i)).map((i) => ({ ma: ungVien[i]!.ma, ten: ungVien[i]!.ten }));
    let cungPhienBan = named(both("cung"));
    let trungMau = named(both("trung"));
    let coTheLa = named(any("cung")).filter((c) => !cungPhienBan.some((x) => x.ma === c.ma));
    // CATALOGUE SELF-CHECK: "the same item" that holds codes of different versions (by the catalogue's
    // own names: "… 1" beside "… 2") means the photo cannot tell those versions apart — then nothing
    // is the same item, all are only "maybe" (01/10/2026: two versions whose photos look identical).
    const versionOf = (c: CompareCandidate): string => { const u = ungVien.find((x) => x.ma === c.ma)!; return versionAfter(u.ten, u.q); };
    const versions = [...new Set(cungPhienBan.map(versionOf))];
    const mixed = versions.length > 1;
    if (mixed) { coTheLa = [...cungPhienBan, ...coTheLa]; cungPhienBan = []; trungMau = []; }
    // THE LINE ITSELF (01/10/2026): a line name read off a photo is a guess too. It is real only when
    // every run saw candidates of that line beside the photo — candidates found by one reading's name.
    const docsOf = (r: { dong: number[] }): Set<number> => new Set(r.dong.map((i) => ungVien[i]!.doc));
    const agreed = runs.length === COMPARE_RUNS ? [...docsOf(runs[0]!)].filter((d) => runs.every((r) => docsOf(r).has(d))) : [];
    const docKhop = agreed.includes(0) ? 0 : agreed[0] ?? -1;
    const cungDong = any("dong").filter((i) => agreed.includes(ungVien[i]!.doc)).map((i) => ({ ma: ungVien[i]!.ma, ten: ungVien[i]!.ten }));
    // COVERAGE: "the shop has nothing of that version" is only said when the candidates really are of
    // the line seen — at least one of the confirmed reading carries every word of the line name it gave.
    const covered = ungVien.some((c) => {
      const words = (searches[c.doc]!.line || c.q).split(/\s+/).filter(Boolean);
      const n = ` ${stripDiacritics(c.ten).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      return agreed.includes(c.doc) && words.every((w) => n.includes(` ${w} `));
    });
    return {
      ungVien: ungVien.map((c) => ({ ma: c.ma, ten: c.ten })), cungDong, dongXacNhan: agreed.length > 0, docKhop, cungPhienBan, trungMau, coTheLa,
      dongBatDong: runs.length === COMPARE_RUNS && agreed.length === 0 && runs.some((r) => r.dong.length > 0),
      // Certain = every run answered, they agree, the catalogue does not contradict them, and an
      // empty answer was given over candidates of the line the pictures confirmed.
      chacChan: runs.length === COMPARE_RUNS && coTheLa.length === 0 && !mixed && (cungPhienBan.length > 0 || covered),
      lanDoi: mixed ? versions : [],
      moTa: runs.map((r) => r.nhanXet).join(" || ").slice(0, 800), tuKhoa
    };
  }

  /**
   * The line the models read. `null` when the photos said nothing usable. `agentSees` (02/10/2026):
   * the agent has the photo in front of it — an unconfirmed reading is something for it to check
   * with its own eyes, no longer an order to say "not recognised".
   */
  private noteOf(r: PhotoReading, agentSees = false): string | null {
    const named = (code: string, ten: string): string => (ten !== "" ? `${code} (${ten})` : code);
    if (r.loai === "bien_lai") {
      return `ẢNH KHÁCH GỬI LÀ BIÊN LAI CHUYỂN KHOẢN${r.bienLai && r.bienLai.amount > 0 ? ` (số tiền đọc được ${r.bienLai.amount.toLocaleString("vi-VN")}đ)` : ""}. Hệ thống đã báo người phụ trách đối chiếu; KHÔNG khẳng định tiền đã vào.`;
    }
    if (r.loai === "don_hang") {
      return `ẢNH KHÁCH GỬI LÀ MÀN HÌNH ĐƠN HÀNG${r.maDon.length > 0 ? ` (mã đọc được: ${r.maDon.join(", ")})` : ""} — trả lời theo khối đơn hàng trong ghi chú, KHÔNG bịa trạng thái đơn.`;
    }
    // The model often repeats the brand inside the model name ("Brand Brand Line").
    const brandShown = r.read.brand !== "" && !stripDiacritics(r.read.model).toLowerCase().startsWith(stripDiacritics(r.read.brand).toLowerCase()) ? r.read.brand : "";
    const seen = [brandShown, r.read.model, r.read.color].filter((x) => x !== "").join(" ");
    if (r.loai === "khac" && seen === "" && r.read.code === "") return null;
    const code = r.read.code ? `; chữ đọc được trên ảnh: ${r.read.code}` : "";
    // 01/10/2026: an unconfirmed line is shown as the guess it is, beside the other reading if any.
    const other = r.looks.find((l) => l.loai === "san_pham")?.docKhac ?? null;
    const otherSeen = other !== null ? [other.brand, other.model].filter((x) => x !== "").join(" ") : "";
    const head = r.dongChuaChac
      ? `ẢNH KHÁCH GỬI: đọc ảnh đoán là ${seen || "chưa mô tả được"}${otherSeen !== "" ? `, lần đọc thứ hai lại ra ${otherSeen}` : ""}${code} — tên dòng này CHƯA XÁC NHẬN.`
      : `ẢNH KHÁCH GỬI: ${seen || "chưa mô tả được"}${code}.`;
    const unknownLine = agentSees
      ? `KHÔNG gọi tên dòng trên với khách như sự thật, KHÔNG chào mẫu nào như "cùng dòng / bản khác" của dòng đó. Ảnh thật ĐÍNH KÈM trong tin: tự nhìn kiểm lại — thấy rõ hãng / chữ in thì nói "em thấy giống …" và hỏi khách xác nhận; vẫn không nhận ra thì nói em thấy gì (hãng, màu) và xin tên mẫu hoặc mã trên tem / hộp. KHÔNG đổ cho ảnh mờ / không rõ.`
      : `KHÔNG gọi tên dòng trên với khách như sự thật, KHÔNG chào mẫu nào như "cùng dòng / bản khác"; nói em chưa nhận ra chắc mẫu trong ảnh, xin khách tên mẫu hoặc mã trên tem / hộp (hoặc ảnh tem).`;
    if (r.thamChieu) {
      return `${head} Đây là ĐÔI KHÁCH ĐANG ĐI (page vừa hỏi để ướm size) — chỉ dùng làm THAM CHIẾU size/form, KHÔNG chào bán, KHÔNG tra kho mẫu này thay mẫu khách đang hỏi.`;
    }
    if (r.chot?.ket === "tu_tin") {
      return `${head} Ảnh trùng ảnh catalog của mã ${named(r.chot.ma, r.chot.ten)} — tra kho theo mã này.${agentSees ? " Mã này ĐÃ CHỐT: KHÔNG đổi sang mã khác dù nhìn ảnh thấy giống mẫu khác." : ""}`;
    }
    // 01/10/2026: what the photo matched among the shop's own photos. Never a confident claim — the
    // customer confirms on the shop's photo (Desk's rule of 01/09: colours in a customer's photo often
    // differ from what the shop holds).
    const cmp = r.soSanh;
    if (cmp !== null && cmp.ungVien.length > 0) {
      const list = (cs: readonly CompareCandidate[], n = 6): string => cs.slice(0, n).map((c) => named(c.ma, c.ten)).join(", ") + (cs.length > n ? "…" : "");
      const confirm = `Nói "em thấy giống mẫu …" và gửi ảnh mẫu của shop để khách XÁC NHẬN đúng món mình hỏi; KHÔNG nói "đúng là mẫu này" trước khi khách xác nhận.`;
      const maybe = cmp.coTheLa.length > 0 ? ` Có thể còn gần với ${list(cmp.coTheLa, 4)} (CHƯA CHẮC).` : "";
      if (cmp.trungMau.length > 0) return `${head} SO VỚI ẢNH CATALOG CỦA SHOP: giống ${list(cmp.trungMau)} — cùng mẫu, cùng màu.${maybe} ${confirm}`;
      if (cmp.cungPhienBan.length > 0) {
        return `${head} SO VỚI ẢNH CATALOG CỦA SHOP: cùng mẫu (cùng đời/phiên bản) với ${list(cmp.cungPhienBan)} nhưng KHÔNG mã nào cùng màu ảnh khách${r.read.color ? ` (${r.read.color})` : ""}.${maybe} Nói rõ shop có mẫu này nhưng KHÁC MÀU và gửi ảnh các màu shop có để khách chọn; KHÔNG nói shop có đúng màu khách gửi.`;
      }
      // None of the shop's photos of the line read shows that line: the line name itself was a misreading, or the shop has nothing like it.
      // 02/10/2026: runs that DISAGREED are said as such — "not certain", not "none is of that line".
      if (!cmp.dongXacNhan && cmp.coTheLa.length === 0) {
        const verdict = cmp.dongBatDong
          ? "hai lần so KHÔNG thống nhất có cùng dòng với ảnh khách hay không (CHƯA CHẮC)"
          : "KHÔNG mẫu nào cùng dòng với ảnh khách";
        return `${head} SO VỚI ẢNH CATALOG CỦA SHOP: đã đặt cạnh ${cmp.ungVien.length} mẫu mang tên dòng đọc được (${list(cmp.ungVien, 4)}) — ${verdict}. ${unknownLine}`;
      }
      // The runs disagree, or only one answered: nothing is "the same item"; the customer decides on the shop photos.
      if (!cmp.chacChan) {
        const tell = cmp.lanDoi.length > 1 ? ` (ảnh không phân biệt được các đời/bản: ${cmp.lanDoi.map((v) => v || "bản không số").join(" / ")})` : "";
        return `${head} SO VỚI ẢNH CATALOG CỦA SHOP: CHƯA CHẮC${tell}${cmp.coTheLa.length > 0 ? ` — có thể gần với ${list(cmp.coTheLa, 4)}` : ""}. KHÔNG khẳng định shop có hay không có đúng mẫu/đúng đời này; gửi ảnh mẫu gần nhất của shop hỏi khách có đúng không, hoặc xin ảnh tem / hộp có mã.`;
      }
      return `${head} SO VỚI ẢNH CATALOG CỦA SHOP: đã đặt cạnh ${cmp.ungVien.length} mẫu trong kho; cùng dòng nhưng khác đời/bản: ${list(cmp.cungDong, 4)} — KHÔNG mẫu nào cùng mẫu/cùng đời với ảnh khách. Nói thật shop chưa có đúng mẫu này; được gợi ý mẫu cùng dòng NHƯNG phải nói rõ là khác đời/khác bản; KHÔNG tự gọi tên đời/phiên bản của ảnh khách khi chưa đọc được chữ trên ảnh.`;
    }
    if (r.chot?.ket === "hoi_lai") {
      const choices = r.chot.luaChon.map((c) => named(c.ma, c.ten)).join(" hoặc ");
      return `${head} CHƯA CHẮC là mã nào${choices ? ` — có thể ${choices}` : ""}. PHẢI hỏi khách xác nhận mẫu (hoặc xin ảnh tem / ảnh rõ hơn); KHÔNG được tự chọn một mã, KHÔNG lấy mã đã nói ở các tin trước.`;
    }
    if (seen === "" && r.read.code === "") return null;
    if (r.dongChuaChac) return `${head} ${unknownLine}`;
    return `${head} Chưa đối chiếu được với ảnh catalog của shop — tra kho theo tên/mã đọc được, chưa chắc thì hỏi lại khách. Đời/phiên bản nhìn từ ảnh là CHƯA CHẮC: không khẳng định khi chưa đọc được chữ trên ảnh.`;
  }
}

/**
 * THE FINGERPRINT AGAINST THE READING (02/10/2026). A picture fingerprint is one signal; the line read
 * off the photo is another. Measured on 30 real photos: the fingerprint alone pinned none correctly,
 * and each of its "looks a little like / shared photo" answers named the wrong item (a suede court
 * shoe → three slide codes). So:
 *   - a code READ on the photo and found in the catalogue is text — it stands;
 *   - a fingerprint match stands when no line was read or the code's name carries the line read;
 *     when they disagree, neither is certain: the code becomes a "maybe", the pictures decide;
 *   - a "looks a little like" list keeps only codes whose name carries the line read — with no
 *     line read, nothing backs it, and it is dropped.
 */
export function crossCheckFingerprint(
  chot: { ket?: string; ma?: string; viSao?: string; luaChon?: string[] } | null,
  named: (ma: string) => string,
  read: { brand: string; model: string; tuKhoa: string; code: string; docKhac?: ReadLine | null | undefined },
  note: (why: string) => void
): ImageLook["chot"] {
  if (chot === null) return null;
  const norm = (s: string): string => ` ${stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const lineOf = (r: { brand: string; model: string; tuKhoa: string }): string => lineWithoutVersion(r.model, r.brand) || stripDiacritics(r.tuKhoa).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Both readings count when they named different lines: the code may carry either.
  const lines = [lineOf(read), ...(read.docKhac ? [lineOf(read.docKhac)] : [])].filter((l) => l !== "");
  const line = lines.join(" / ");
  const words = lines.flatMap((l) => l.split(" ").filter(Boolean));
  const carriesLine = (ten: string): boolean => ten !== "" && lines.some((l) => l.split(" ").filter(Boolean).every((w) => norm(ten).includes(` ${w} `)));
  const byText = chot.viSao === "ocr_code" || chot.viSao === "ocr_code_in_catalog" || (read.code !== "" && read.code.toUpperCase() === String(chot.ma ?? "").toUpperCase());
  if (chot.ket === "tu_tin" && chot.ma) {
    const ten = named(chot.ma);
    if (byText || words.length === 0 || ten === "" || carriesLine(ten)) return { ket: "tu_tin", ma: chot.ma, ten };
    note(`van tay: ${chot.ma} (${ten}) lech dong doc duoc "${line}" — chi con la "co the"`);
    return { ket: "hoi_lai", luaChon: [{ ma: chot.ma, ten }] };
  }
  if (chot.ket === "hoi_lai") {
    const all = (chot.luaChon ?? []).map((ma) => ({ ma, ten: named(ma) }));
    // A code read on the photo that the fingerprint contradicts: both are offered, the customer decides.
    if (chot.viSao === "ocr_fingerprint_conflict") return { ket: "hoi_lai", luaChon: all };
    const kept = all.filter((c) => carriesLine(c.ten));
    if (kept.length < all.length) note(`van tay: bo ${all.length - kept.length} ma "hoi giong" khong mang dong doc duoc${line !== "" ? ` "${line}"` : ""} (${all.filter((c) => !kept.includes(c)).map((c) => c.ma).join(", ")})`);
    return kept.length > 0 ? { ket: "hoi_lai", luaChon: kept } : null;
  }
  return null;
}

/** Which kind wins when the readings of one photo differ: a receipt beats an order screen beats a product. */
const KIND_STRENGTH: Record<ImageKind, number> = { bien_lai: 3, don_hang: 2, san_pham: 1, khac: 0 };

/** One reading's JSON, cleaned; the visible text of a bank screen makes it a receipt (Desk `classifyNonProductImage`). */
function parsePhotoRead(read: Record<string, unknown>, receiptTextPatterns: readonly string[]): PhotoRead {
  const s = (v: unknown, n: number): string => String(v ?? "").trim().slice(0, n);
  const kind = s(read["loai"], 20);
  const r: PhotoRead = {
    loai: kind === "bien_lai" || kind === "don_hang" || kind === "khac" ? kind : "san_pham",
    brand: s(read["brand"], 40), model: s(read["model"], 120), color: s(read["color"], 60), tuKhoa: s(read["tuKhoa"], 60),
    code: s(read["code"], 24).toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    amount: Math.max(0, Math.round(Number(read["amount"]) || 0)),
    orderCode: s(read["orderCode"], 40).toUpperCase(),
    text: s(read["text"], 300),
    confidence: Math.min(1, Math.max(0, Number(read["confidence"]) || 0))
  };
  if (r.loai === "khac" && (r.model !== "" || r.code !== "")) r.loai = "san_pham";
  const visible = stripDiacritics(`${r.text} ${r.model}`).toLowerCase();
  if (r.loai !== "bien_lai" && receiptTextPatterns.some((p) => { try { return p !== "" && new RegExp(p).test(visible); } catch { return false; } })) r.loai = "bien_lai";
  return r;
}

/**
 * Two readings name the same line: same brand (when both give one) and the words of one line name
 * (no version) all inside the other's ("line" and "family line" agree). A reading with no line agrees with anything.
 */
export function linesAgree(a: ReadLine, b: ReadLine): boolean {
  const norm = (x: string): string => stripDiacritics(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(a.brand) !== "" && norm(b.brand) !== "" && norm(a.brand) !== norm(b.brand)) return false;
  const words = (r: ReadLine): string[] => (lineWithoutVersion(r.model, r.brand) || norm(r.tuKhoa)).split(" ").filter(Boolean);
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return true;
  return x.every((w) => y.includes(w)) || y.every((w) => x.includes(w));
}

/** A catalogue candidate with the search that found it and the reading (0 / 1) that search came from. */
interface Pooled { ma: string; ten: string; anh: string; q: string; doc: number }

/** The readings' pools taken in turn (one of each, then the next), each code and photo once, at most `COMPARE_CANDIDATES`. */
function interleave(pools: readonly Pooled[][]): Pooled[] {
  const out: Pooled[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < COMPARE_CANDIDATES && pools.some((p) => i < p.length); i += 1) {
    for (const p of pools) {
      const c = p[i];
      if (c === undefined || out.length >= COMPARE_CANDIDATES || seen.has(c.ma) || seen.has(c.anh)) continue;
      seen.add(c.ma); seen.add(c.anh);
      out.push(c);
    }
  }
  return out;
}

/**
 * The line name to search with when the model gave no `tuKhoa`: its model name without the brand
 * and without numbers (a version number is the part a photo cannot be trusted for).
 */
export function lineWithoutVersion(model: string, brand: string): string {
  const norm = (s: string): string => stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // The brand only as a leading phrase: a brand word inside the line name ("Bình Gốm" of "Gốm Việt") stays.
  let words = norm(model).split(" ").filter(Boolean);
  const brandWords = norm(brand).split(" ").filter(Boolean);
  if (brandWords.length > 0 && brandWords.every((w, i) => words[i] === w)) words = words.slice(brandWords.length);
  return words.filter((w) => !/\d/.test(w)).join(" ");
}

/**
 * The catalogue items worth showing: with a photo, one photo once, one item per distinct name first
 * (colourways of one item look alike — variety finds the version), then the rest. A relative photo
 * address is resolved against the item's own page.
 */
export function pickCandidates(items: readonly unknown[]): { ma: string; ten: string; anh: string }[] {
  const seen = new Set<string>();
  const all: { ma: string; ten: string; anh: string; nameKey: string }[] = [];
  for (const raw of items) {
    const item = (raw ?? {}) as { ma?: unknown; ten?: unknown; anh?: unknown; link?: unknown };
    const ma = String(item.ma ?? "").trim();
    let anh = String(item.anh ?? "").trim();
    if (ma === "" || anh === "") continue;
    if (!/^https?:\/\//i.test(anh)) {
      // A landing serves its photos from the site root ("assets/…" and "/assets/…" alike), never beside the product page.
      try { anh = new URL(anh.startsWith("/") ? anh : `/${anh}`, String(item.link ?? "")).toString(); } catch { continue; }
    }
    if (seen.has(anh)) continue;
    seen.add(anh);
    const ten = String(item.ten ?? "").trim();
    all.push({ ma, ten, anh, nameKey: stripDiacritics(ten).toLowerCase().replace(/\s+/g, " ") });
  }
  const names = new Set<string>();
  const first = all.filter((c) => (names.has(c.nameKey) ? false : (names.add(c.nameKey), true)));
  const rest = all.filter((c) => !first.includes(c));
  return [...first, ...rest].slice(0, COMPARE_CANDIDATES).map(({ ma, ten, anh }) => ({ ma, ten, anh }));
}

/**
 * The number written right after the line word in a name ("… Line 13 W" → "13" for "line"; "Family
 * Line 2" → "2" for "family line"); "" when there is none. Across industries a number after the line name is
 * its version or variant (a generation, a model year, a strength) — what a photo must not guess.
 */
export function versionAfter(text: string, line: string): string {
  const word = stripDiacritics(line).toLowerCase().trim().split(/\s+/).pop() ?? "";
  if (word === "") return "";
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|[^a-z0-9])${escaped}\\s*[-:]?\\s*(\\d{1,3}(?:[.,]\\d)?)(?![0-9])`).exec(stripDiacritics(text).toLowerCase());
  return m?.[1]?.replace(",", ".") ?? "";
}
