/**
 * @file The conversation ledger ("SO HOI THOAI"): what was said about each product, accumulated
 * over the WHOLE conversation, never wiped when the customer changes model.
 *
 * Copied from Sales Desk `conversation_memory.js` (updateLedger / ledgerToText /
 * describeRecognizedImage). The lesson it encodes: a flat summary that is rewritten every turn
 * forgets the first model when the customer asks about the third; the prompt then quotes a price
 * for the wrong shoe. The ledger is structured (one entry per product, by code or name), bounded
 * (12 products, 6 orders, 8 summaries) and monotonic in one respect: a product the customer has
 * CLOSED ("chot") is never downgraded to "het_size" because a later lookup missed a size.
 *
 * Everything the model reads (labels, headings, the closing note for external products) comes
 * from `loi-chung/so-hoi-thoai.json`; this file only knows the shape. The evidence of a turn
 * (`TurnEvidence`) is neutral: the adapter that owns the router results maps them into it, so
 * this class never sees Desk's `routerResult`.
 */

import type { LedgerTexts } from "../pack/types";
import { fillText, formatPrice, packRegex, shortTime } from "./fill-text";
import { normalize } from "./text-analysis";

export const LEDGER_PRODUCT_LIMIT = 12;
export const LEDGER_ORDER_LIMIT = 6;
export const LEDGER_SUMMARY_LIMIT = 8;

/** Where the product entered the conversation. Kept as Desk's Vietnamese ids: they are compared in logs. */
export type LedgerSource = "chu_khach" | "anh_khach_gui" | "the_page_gui" | "sp_ngoai";
export type LedgerStatus = "quan_tam" | "hoi_gia" | "hoi_size" | "het_size" | "chot" | "da_dat";
/** Status rank: a product only moves UP this list ("het_size" never undoes "chot"). */
export const LEDGER_STATUS_ORDER: readonly LedgerStatus[] = ["quan_tam", "hoi_gia", "hoi_size", "het_size", "chot", "da_dat"];

export interface LedgerProduct {
  code: string;
  name: string;
  brand: string;
  source: LedgerSource;
  firstAt: string;
  lastAt: string;
  askedSizes: string[];
  quotedPrice?: string | undefined;
  stockAnswer?: string | undefined;
  status: LedgerStatus;
  note?: string | undefined;
}

export interface LedgerOrder {
  id: string;
  status: string;
  tracking: string;
  items: string[];
  at: string;
}

export interface LedgerSummary {
  at: string;
  text: string;
  customerMessage: string;
}

export interface Ledger {
  products: LedgerProduct[];
  orders: LedgerOrder[];
  aiSummaries: LedgerSummary[];
  openThread: string;
  customerGoal: string;
  updatedAt: string;
}

/** A product as any evidence names it. At least one of code / name must be set to count. */
export interface ProductRef {
  code?: string | undefined;
  name?: string | undefined;
  brand?: string | undefined;
  price?: number | undefined;
}

/** The product the stock lookup of this turn settled on. */
export interface MatchedProduct {
  item: ProductRef;
  /** Matched by code, strong name, image or confirmation — not a loose guess. */
  reliable: boolean;
  /** The match came from an image or OCR, so the source becomes "anh_khach_gui". */
  fromImage?: boolean | undefined;
  /** What the lookup answered for the requested variant, if one was requested. */
  stock?: { requestedSize: string; inStock: boolean; level?: string | undefined } | undefined;
  /** Price the shop quoted for it this turn (overrides `item.price`). */
  price?: number | undefined;
  /** The alternative the system offered (same line, other colour). */
  alternative?: (ProductRef & { size?: string | undefined }) | undefined;
}

/** Everything one turn may teach the ledger. Every field optional: a greeting teaches nothing. */
export interface TurnEvidence {
  now: string;
  intentId?: string | undefined;
  /** Variant the customer asked about this turn (digits required, like Desk). */
  size?: string | undefined;
  matched?: MatchedProduct | undefined;
  /** Products recognised from the customer's images (confident or OCR). */
  imageProducts?: ProductRef[] | undefined;
  /** Products named in the SHOP's reply (codes the page sent). */
  repliedProducts?: ProductRef[] | undefined;
  /** The product card the page sent / the customer is looking at. */
  pageProduct?: ProductRef | undefined;
  /** A product the customer named in words that the catalog did NOT match. */
  mentionedName?: string | undefined;
  mentionedBrand?: string | undefined;
  /** A product outside the catalog that the operator typed in by hand. */
  externalProduct?: ProductRef | undefined;
  orders?: { id: string; status?: string | undefined; tracking?: string | undefined; items?: string[] | undefined }[] | undefined;
  /** The conversation reached "cart created" / "done": closed products become "da_dat". */
  orderPlaced?: boolean | undefined;
  /** The model's one-line context summary of this turn. */
  summary?: string | undefined;
  customerGoal?: string | undefined;
  customerMessage?: string | undefined;
}

/** What the image pipeline concluded about one customer image. */
export type RecognizedImage =
  | { kind: "receipt"; amount: string; order: string }
  | { kind: "product"; code: string; name: string }
  | { kind: "product_choices"; choices: ProductRef[] }
  | { kind: "ocr"; brand: string; code: string; name: string }
  | { kind: "unknown" };

/** Neutral shape of the image pipeline's output, mapped by the adapter from Desk's router result. */
export interface ImageEvidence {
  /** The router classified the image as a receipt by its content. */
  receiptByIntent?: boolean | undefined;
  /** Texts OCR / vision read from the image. */
  visibleTexts?: string[] | undefined;
  /** Catalog match of the image: `action` "auto_match" / "ask_confirm" are confident, "ask_choose" is a shortlist. */
  match?: { action?: string | undefined; primary?: ProductRef | undefined; selected?: ProductRef[] | undefined } | undefined;
  /** Entities OCR read (brand / name / code) when the catalog did not match. */
  ocr?: { brand?: string | undefined; code?: string | undefined; name?: string | undefined } | undefined;
  /** Vision ran successfully on at least one image (so "unknown" is a real verdict, not a failure). */
  visionOk?: boolean | undefined;
}

function productKey(item: { code?: string | undefined; name?: string | undefined }): string {
  const code = normalize(item.code ?? "").replace(/\s+/g, "");
  if (code !== "") return `code:${code}`;
  return `name:${normalize(item.name ?? "")}`;
}

function higherStatus(current: LedgerStatus, next: string): LedgerStatus {
  const a = LEDGER_STATUS_ORDER.indexOf(current);
  const b = LEDGER_STATUS_ORDER.indexOf(next as LedgerStatus);
  if (b < 0) return current;
  if (a < 0) return next as LedgerStatus;
  // "het_size" is not below "chot": once closed, stays closed; otherwise the higher rank wins.
  return b > a ? (next as LedgerStatus) : current;
}

function mergeUnique(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b].filter((x) => x !== ""))];
}

function hasIdentity(item: ProductRef | undefined): item is ProductRef {
  return item !== undefined && ((item.code ?? "") !== "" || (item.name ?? "") !== "");
}

function joinName(item: { code?: string | undefined; name?: string | undefined }): string {
  return [item.code, item.name].filter((x) => (x ?? "") !== "").join(" ");
}

/** Builds, updates and renders the ledger. Stateless: every method takes the ledger it works on. */
export class ConversationLedger {
  constructor(private readonly texts: LedgerTexts) {}

  static empty(): Ledger {
    return { products: [], orders: [], aiSummaries: [], openThread: "", customerGoal: "", updatedAt: "" };
  }

  /** A ledger from whatever was persisted: missing lists become empty, limits re-applied. */
  normalize(raw: unknown): Ledger {
    const source = raw !== null && typeof raw === "object" ? (raw as Partial<Ledger>) : {};
    return {
      products: (Array.isArray(source.products) ? source.products : [])
        .filter((p) => p && ((p.code ?? "") !== "" || (p.name ?? "") !== ""))
        .map((p) => ({ ...p, askedSizes: Array.isArray(p.askedSizes) ? p.askedSizes : [], status: p.status ?? "quan_tam" }))
        .slice(-LEDGER_PRODUCT_LIMIT),
      orders: (Array.isArray(source.orders) ? source.orders : []).filter(Boolean).slice(-LEDGER_ORDER_LIMIT),
      aiSummaries: (Array.isArray(source.aiSummaries) ? source.aiSummaries : []).filter((s) => s && s.text).slice(-LEDGER_SUMMARY_LIMIT),
      openThread: String(source.openThread ?? ""),
      customerGoal: String(source.customerGoal ?? ""),
      updatedAt: String(source.updatedAt ?? "")
    };
  }

  /** Folds one turn's evidence into the ledger. Returns a new ledger; the input is not mutated. */
  update(previous: Ledger | undefined, ev: TurnEvidence): Ledger {
    const ledger = this.normalize(previous);
    const now = ev.now;
    const products = ledger.products.map((p) => ({ ...p, askedSizes: [...p.askedSizes] }));

    interface Patch {
      size?: string | undefined; price?: string | undefined; stockAnswer?: string | undefined;
      status?: string | undefined; source?: LedgerSource | undefined; note?: string | undefined;
    }
    const upsert = (candidate: ProductRef | undefined, patch: Patch = {}): LedgerProduct | null => {
      if (!hasIdentity(candidate)) return null;
      const key = productKey(candidate);
      let item = products.find((entry) => productKey(entry) === key);
      if (item === undefined) {
        item = {
          code: candidate.code ?? "", name: candidate.name ?? "", brand: candidate.brand ?? "",
          source: patch.source ?? "chu_khach", firstAt: now, lastAt: now, askedSizes: [], status: "quan_tam"
        };
        products.push(item);
      }
      if (item.name === "" && candidate.name) item.name = candidate.name;
      if (item.code === "" && candidate.code) item.code = candidate.code;
      if (item.brand === "" && candidate.brand) item.brand = candidate.brand;
      item.lastAt = now;
      if (patch.size) item.askedSizes = mergeUnique(item.askedSizes, [patch.size]);
      if (patch.price) item.quotedPrice = patch.price;
      if (patch.stockAnswer) item.stockAnswer = patch.stockAnswer;
      if (patch.status) item.status = higherStatus(item.status, patch.status);
      // The source is only ever upgraded to "the customer sent a photo"; an external product stays external.
      if (patch.source === "anh_khach_gui" && item.source !== "anh_khach_gui" && item.source !== "sp_ngoai") item.source = "anh_khach_gui";
      if (patch.note) item.note = patch.note;
      return item;
    };

    const intentStatus = this.texts.statusByIntent[ev.intentId ?? ""] ?? "";
    const size = /\d/.test(ev.size ?? "") ? String(ev.size) : "";

    // 1) The product the system matched with confidence (code / strong name / image / confirmation).
    const matched = ev.matched;
    if (matched !== undefined && matched.reliable && hasIdentity(matched.item)) {
      let stockAnswer = "";
      const stock = matched.stock;
      if (stock !== undefined && stock.requestedSize !== "") {
        const key = stock.inStock ? "in" : stock.level ? "outAtLevel" : "out";
        stockAnswer = fillText(this.texts.stockAnswers[key] ?? "", { size: stock.requestedSize, bac: stock.level });
      }
      const outOfStock = stock !== undefined && stock.requestedSize !== "" && !stock.inStock;
      upsert(matched.item, {
        size,
        price: formatPrice(matched.price ?? matched.item.price),
        stockAnswer,
        status: outOfStock && intentStatus !== "chot" ? "het_size" : intentStatus,
        source: matched.fromImage === true ? "anh_khach_gui" : undefined
      });
      // The alternative the system offered (same line, other colour).
      const alt = matched.alternative;
      if (hasIdentity(alt)) {
        upsert(alt, {
          size: alt.size ?? size, price: formatPrice(alt.price),
          stockAnswer: alt.size ? fillText(this.texts.stockAnswers["in"] ?? "", { size: alt.size }) : "",
          status: "quan_tam", note: this.texts.alternativeNote
        });
      }
    }
    // 2) Products recognised from the customer's images (even when the catalog did not settle).
    for (const p of ev.imageProducts ?? []) upsert(p, { source: "anh_khach_gui", status: intentStatus || "quan_tam", size });
    // 3) The card the page sent, and codes the shop wrote in its reply.
    if (hasIdentity(ev.pageProduct)) upsert(ev.pageProduct, { source: "the_page_gui", status: intentStatus || "quan_tam", size });
    for (const p of ev.repliedProducts ?? []) upsert(p, { source: "the_page_gui" });
    // 3b) A product outside the catalog, typed in by the operator: remembered with its own price.
    if (hasIdentity(ev.externalProduct)) {
      upsert(ev.externalProduct, { source: "sp_ngoai", status: intentStatus, price: formatPrice(ev.externalProduct.price), size });
    }
    // 4) A product the customer named in words that the catalog did NOT match: written down so it
    //    is not forgotten (no price, no stock). Acknowledgements ("dung roi", "ok anh") and small
    //    talk once became "products the customer mentioned" (Desk v15, 31/08); they are filtered by data.
    const mentioned = (ev.mentionedName ?? "").trim();
    const mentionedNorm = normalize(mentioned);
    const notProduct = this.texts.notProductPatterns.some((p) => p !== "" && new RegExp(p).test(mentionedNorm))
      || this.texts.addressPatterns.some((p) => p !== "" && new RegExp(p).test(mentionedNorm));
    if (matched === undefined && mentioned !== "" && !notProduct && mentioned.length >= 4 && !/^\d+$/.test(mentioned)) {
      upsert({ name: mentioned, brand: ev.mentionedBrand ?? "" }, { source: "chu_khach", status: intentStatus || "quan_tam", size, note: this.texts.unmatchedNote });
    }

    // Orders looked up this turn.
    const orders = ledger.orders.map((o) => ({ ...o, items: [...o.items] }));
    for (const found of ev.orders ?? []) {
      if (!found || found.id === "") continue;
      const entry: LedgerOrder = { id: found.id, status: found.status ?? "", tracking: found.tracking ?? "", items: (found.items ?? []).slice(0, 3), at: now };
      const existing = orders.find((o) => o.id === entry.id);
      if (existing !== undefined) Object.assign(existing, entry); else orders.push(entry);
    }
    if (intentStatus === "chot" && matched !== undefined && hasIdentity(matched.item)) {
      const chosen = products.find((entry) => productKey(entry) === productKey(matched.item));
      if (chosen !== undefined) chosen.status = higherStatus(chosen.status, "chot");
    }
    if (ev.orderPlaced === true) {
      for (const entry of products) if (entry.status === "chot") entry.status = "da_dat";
    }

    // The model's per-turn summaries: this is what used to be thrown away after every turn.
    const summaries = ledger.aiSummaries.map((s) => ({ ...s }));
    const summary = (ev.summary ?? "").trim();
    const last = summaries[summaries.length - 1];
    if (summary !== "" && !(last !== undefined && last.text === summary)) {
      summaries.push({ at: now, text: summary.slice(0, 300), customerMessage: (ev.customerMessage ?? "").slice(0, 80) });
    }
    return {
      products: products.slice(-LEDGER_PRODUCT_LIMIT),
      orders: orders.slice(-LEDGER_ORDER_LIMIT),
      aiSummaries: summaries.slice(-LEDGER_SUMMARY_LIMIT),
      openThread: summary !== "" ? summary : ledger.openThread,
      customerGoal: (ev.customerGoal ?? "").trim() || ledger.customerGoal,
      updatedAt: now
    };
  }

  /**
   * What one image is, judged by its CONTENT (Desk 24/09/2026, Tran Tri case): a receipt only when
   * the router or the visible text says so — never inferred from the routing decision, which once
   * labelled a sticker "receipt" for good because the conversation was about payment.
   */
  recognizeImage(ev: ImageEvidence): RecognizedImage | null {
    const rawTexts = (ev.visibleTexts ?? []).join(" ");
    const receiptByText = this.texts.receiptTextPatterns.some((p) => p !== "" && new RegExp(p).test(normalize(rawTexts)));
    if (ev.receiptByIntent === true || receiptByText) {
      const amountRe = packRegex(this.texts.receiptAmountPattern, "i");
      const orderRe = packRegex(this.texts.receiptOrderPattern);
      const amount = amountRe ? (rawTexts.match(amountRe)?.[1] ?? "") : "";
      const order = orderRe ? (rawTexts.match(orderRe)?.[0] ?? "") : "";
      return { kind: "receipt", amount, order };
    }
    const match = ev.match ?? {};
    const primary = match.selected?.[0] ?? match.primary;
    const confident = ["auto_match", "ask_confirm"].includes(match.action ?? "") && hasIdentity(primary);
    if (confident) return { kind: "product", code: primary.code ?? "", name: primary.name ?? "" };
    if (match.action === "ask_choose" && (match.selected ?? []).length > 0) {
      return { kind: "product_choices", choices: (match.selected ?? []).slice(0, 3) };
    }
    const ocr = ev.ocr;
    if (ocr !== undefined && ((ocr.code ?? "") !== "" || (ocr.name ?? "") !== "")) {
      return { kind: "ocr", brand: ocr.brand ?? "", code: ocr.code ?? "", name: ocr.name ?? "" };
    }
    if (ev.visionOk === true) return { kind: "unknown" };
    return null;
  }

  /** The label that replaces "[khách gửi ảnh]" in the history once the image is recognised. */
  imageLabel(image: RecognizedImage): string {
    const labels = this.texts.imageLabels;
    switch (image.kind) {
      case "receipt":
        return fillText(labels["receipt"] ?? "", {
          tien: image.amount !== "" ? fillText(labels["receiptAmount"] ?? "", { tien: image.amount }) : "",
          don: image.order !== "" ? fillText(labels["receiptOrder"] ?? "", { don: image.order }) : ""
        });
      case "product":
        return fillText(labels["product"] ?? "", { ten: joinName(image) });
      case "product_choices":
        return fillText(labels["choices"] ?? "", { ten: image.choices.map(joinName).join(" / ") });
      case "ocr":
        return fillText(labels["ocr"] ?? "", { ten: [image.brand, image.name, image.code].filter((x) => x !== "").join(" ") });
      case "unknown":
        return labels["unknown"] ?? "";
    }
  }

  /** The "SO HOI THOAI" block of the prompt, worded exactly as Desk's `ledgerToText`. */
  render(input: Ledger | undefined): string {
    const ledger = this.normalize(input);
    const t = this.texts;
    const parts: string[] = [];
    if (ledger.products.length > 0) {
      parts.push(t.header);
      ledger.products.forEach((item, index) => {
        const bits = [
          `${index + 1}) ${joinName(item)}${item.brand !== "" ? ` (${item.brand})` : ""}`,
          fillText(t.fieldLabels["source"] ?? "", { nguon: t.sourceLabels[item.source] ?? item.source }),
          item.askedSizes.length > 0 ? fillText(t.fieldLabels["askedSizes"] ?? "", { size: item.askedSizes.join(", ") }) : "",
          item.quotedPrice ? fillText(t.fieldLabels["quotedPrice"] ?? "", { gia: item.quotedPrice }) : "",
          item.stockAnswer ? fillText(t.fieldLabels["stockAnswer"] ?? "", { ton: item.stockAnswer }) : "",
          fillText(t.fieldLabels["status"] ?? "", { trangThai: t.statusLabels[item.status] ?? item.status }),
          item.note ? `(${item.note})` : "",
          item.lastAt !== "" ? fillText(t.fieldLabels["at"] ?? "", { luc: shortTime(item.lastAt) }) : ""
        ].filter((x) => x !== "");
        parts.push("  " + bits.join(" | "));
        // An external product being closed: the rule sits right under its line (Desk 04/09).
        if (item.source === "sp_ngoai" && item.status === "chot" && t.externalClosingNote !== "") parts.push(t.externalClosingNote);
      });
    }
    if (ledger.orders.length > 0) {
      parts.push(t.ordersHeader + ledger.orders.map((o) =>
        `${o.id}${o.status !== "" ? ` — ${o.status}` : ""}${o.tracking !== "" ? fillText(t.orderTracking, { ma: o.tracking }) : ""}${o.items.length > 0 ? ` — ${o.items.join("; ")}` : ""}`
      ).join(" || "));
    }
    if (ledger.aiSummaries.length > 0) {
      parts.push(t.summariesHeader);
      for (const s of ledger.aiSummaries) parts.push(`  [${shortTime(s.at)}] ${s.text}`);
    }
    if (ledger.customerGoal !== "") parts.push(fillText(t.customerGoal, { muc: ledger.customerGoal }));
    if (ledger.openThread !== "") parts.push(fillText(t.openThread, { chuDe: ledger.openThread }));
    return parts.join("\n");
  }
}
