/**
 * @file THE REPLY DISPATCHER — what goes WITH a reply (Giai đoạn 7, Xeon's half, 25/09/2026).
 *
 * The landing sends everything that accompanies a reply: product cards, the order form, the
 * foot-measuring picture, the AI greeting (`InboxSendBody` in the contract). Xeon only DECIDES,
 * and this class is the decision, as pure data:
 *   (a) codes the reply names that the turn's lookups returned → at most two cards, minus the codes
 *       the landing already sent within six hours (`hoiThoai.theDaGui`); three or more codes still in
 *       stock → the filter link instead of cards (Desk `m-product` rules);
 *   (b) the customer closes on ONE code + size that is in stock → the order form (`order.formLink`,
 *       called by the pipeline) when the shop closes through the form, or a person when the shop
 *       closes through a person (`hoSo.banHang.khiChot`);
 *   (c) the reply asks the customer to measure a foot → the measuring guide picture; the pattern is
 *       the industry's (`y-dinh.json` `reconcile.asksFootMeasure`), never written here;
 *   (d) the first reply of a conversation → the landing prepends its AI greeting.
 * The pipeline turns the plan into the send body and reads back `ketQua.daGui`.
 */

import type { InboxCardRequest, ShopProfile } from "@sp/contract";
import { inStockRows, itemKey, normalize, packRegex, type FoundItem, type ReconcilePatterns, type StockFacts } from "@sp/brain";

export interface DispatchInput {
  reply: string;
  /** What the finder returned this turn. */
  found: readonly FoundItem[];
  stock: StockFacts | null;
  /** Codes whose card the landing sent within six hours. */
  theDaGui: readonly string[];
  /** The landing already greeted this conversation. */
  daChaoAi: boolean;
  /** The page has not said anything yet in this thread (bot or person): this is the opening reply. */
  firstReply: boolean;
  /** The reply hands the customer to a person: no greeting in front of it. */
  handoff?: boolean | undefined;
  intent: string;
  /** Closing words the extractor found ("lay", "chot"…), and LLM#1's `readyToBuy`. */
  closingSignals: readonly string[];
  readyToBuy: boolean;
  /** The code the turn is about (the focus), and the size asked. */
  focusCode: string;
  requestedSize: string;
  hoSo: ShopProfile | null;
  /** The industry's "asks to measure" pattern (accent-stripped and diacritic forms both allowed). */
  asksFootMeasure: string;
  site: string;
  /**
   * A REAL filter the named codes share (same line / group / purpose), on the right site — from the
   * stock facts, the line families or `storefront.link`. `undefined` = none: five codes glued into
   * `?q=` is not a filter (hồ sơ that-18), so the first two cards go instead.
   */
  sharedFilter?: ((codes: readonly string[]) => string | undefined) | undefined;
  /**
   * 05/10/2026: codes (normalised, `itemKey`) of the items in the customer's RUNNING orders. Never a
   * card, a filter link or an order form for them — the customer already ordered them. Empty = no order.
   */
  orderedCodes?: readonly string[] | undefined;
  /** Codes (normalised) THIS message names; with a running order, the form only goes for one of these. */
  namedThisTurn?: readonly string[] | undefined;
  /**
   * 05/10/2026 (phiếu Desk "thẻ đặt hàng không đi"): the customer's message this turn — several codes, each
   * with its own variant ("A size 42 và B size 41"), become one form with one line each.
   */
  message?: string | undefined;
}

export interface DispatchPlan {
  theSanPham: InboxCardRequest[];
  linkLoc?: string | undefined;
  /** The order form to ask the landing for (the pipeline calls `order.formLink`). */
  phieu?: { items: { ma: string; size: string }[] } | undefined;
  /** The shop closes through a person: the pipeline notifies instead of sending a form. */
  goiNguoi: boolean;
  /**
   * 05/10/2026: the customer is closing and the order needs a PERSON although no form goes — a running order
   * blocks a new one, or the shop has not said how it closes. "" = no closing, or the item is not settled yet
   * (the bot asks for it). The pipeline calls a person and never lets the reply promise a form.
   */
  canNguoiChot: string;
  /** The customer is closing this turn (intent, closing words, LLM#1's readyToBuy). */
  chot: boolean;
  anhHuongDan?: "do-chan" | undefined;
  chaoAi: boolean;
  /** Why each part was chosen or not, for the dossier. */
  lyDo: string[];
}

/**
 * 05/10/2026 (phiếu Desk "chào AI khi khách chỉ khép chuyện"): the customer's message only CLOSES the
 * exchange — a bare acknowledgement, a short thank-you that asks for nothing, or only emoji. The AI
 * greeting belongs in front of the first reply to a message with something in it, never in front of
 * "ok" / "cảm ơn". The same reading as the router's order-notice ack; the words are tier-1 JSON
 * (`reconcile.bareAck`, `thanks`, `carriesRequest`, `smallTalkMaxWords`), an industry may add to them.
 */
export function closingOnly(message: string, rc: Pick<ReconcilePatterns, "bareAck" | "thanks" | "carriesRequest" | "smallTalkMaxWords">): boolean {
  const trimmed = message.trim();
  if (trimmed === "") return false;
  if (/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s!.~]+$/u.test(trimmed)) return true;
  if (packRegex(rc.bareAck, "i")?.test(trimmed) ?? false) return true;
  const n = normalize(message);
  const words = n.split(" ").filter(Boolean).length;
  const asks = rc.carriesRequest.some((p) => p !== "" && (new RegExp(p).test(trimmed) || new RegExp(p).test(n)));
  return (packRegex(rc.thanks)?.test(n) ?? false) && !asks && words <= Math.max(1, rc.smallTalkMaxWords);
}

/** A variant label as written: lower case, no diacritics, "-" / "_" / several spaces → one space ("41-1/3" = "41 1/3"). */
function foldLabel(text: string): string {
  return normalize(String(text ?? "").replace(/[-_]+/g, " ")).replace(/\s+/g, " ").trim();
}

/** `needle` as whole tokens of `hay` (both folded). */
function tokenAt(hay: string, needle: string): number {
  if (needle === "") return -1;
  const m = new RegExp(`(^|[^a-z0-9/])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9/]|[.,]\\d)`).exec(hay);
  return m === null ? -1 : m.index + m[1]!.length;
}

/**
 * 05/10/2026 (phiếu Desk "thẻ đặt hàng không đi", ca "lấy A size 42 và B size 41"): the order lines a
 * message names — each code the turn's lookups returned, with the ONE in-stock variant label of THAT item
 * written between it and the next code. Data only (the item's own labels), no word of any industry. All or
 * nothing: fewer than two codes, or a code with no / several variants, → `[]` (the single-item path decides).
 */
export function orderLinesIn(message: string, found: readonly FoundItem[]): { ma: string; size: string }[] {
  const text = foldLabel(message);
  if (text === "") return [];
  const seen = new Set<string>();
  const hits: { item: FoundItem; at: number; end: number }[] = [];
  for (const item of found) {
    const key = foldLabel(item.ma);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const at = tokenAt(text, key);
    if (at >= 0) hits.push({ item, at, end: at + key.length });
  }
  if (hits.length < 2) return [];
  hits.sort((l, r) => l.at - r.at);
  const lines: { ma: string; size: string }[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i]!;
    const segment = text.slice(hit.end, hits[i + 1]?.at ?? text.length);
    const labels = [...new Set(inStockRows(hit.item).map((r) => String(r.size ?? "").trim()).filter(Boolean))];
    const matched = labels.filter((l) => tokenAt(segment, foldLabel(l)) >= 0);
    // "41 1/3" written → the label "41" inside it is not a second variant.
    const longest = matched.filter((l) => !matched.some((o) => o !== l && foldLabel(o).includes(foldLabel(l))));
    if (longest.length !== 1) return [];
    lines.push({ ma: hit.item.ma, size: longest[0]! });
  }
  return lines;
}

/** Intents that end the conversation: no greeting in front of a goodbye or a complaint. */
const CLOSING_INTENTS = new Set(["small_talk", "complaint_or_human", "payment_confirmation"]);
/**
 * 05/10/2026: intents about an order ALREADY placed (when it ships, a return, money, a complaint). A loose closing word
 * in such a message ("bao giờ lấy được hàng") is not a new order, so no "a person must take the order" notice.
 */
const ABOUT_AN_ORDER = new Set(["shipping", "return_exchange", "complaint_or_human", "payment_confirmation", "deposit_instruction"]);
const MAX_CARDS = 2;
const LINK_INSTEAD_OF_CARDS = 3;

export class ReplyDispatcher {
  plan(input: DispatchInput): DispatchPlan {
    const lyDo: string[] = [];
    const plan: DispatchPlan = { theSanPham: [], goiNguoi: false, canNguoiChot: "", chot: false, chaoAi: false, lyDo };

    // (a) Cards for the codes the reply names, in the order they appear.
    const byCode = new Map<string, FoundItem>();
    for (const it of input.found) byCode.set(normalize(it.ma), it);
    const reply = input.reply;
    const named: { code: string; at: number; item: FoundItem }[] = [];
    for (const [key, item] of byCode) {
      if (key === "") continue;
      const m = new RegExp(`(^|[^A-Za-z0-9])${item.ma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").exec(reply);
      if (m !== null) named.push({ code: item.ma, at: m.index, item });
    }
    named.sort((l, r) => l.at - r.at);
    const sent = new Set(input.theDaGui.map(normalize));
    const ordered = new Set(input.orderedCodes ?? []);
    const notOrdered = named.filter((n) => !ordered.has(itemKey(n.code)));
    if (named.length > notOrdered.length) lyDo.push(`bo ${named.length - notOrdered.length} the cua mon da co trong don dang chay`);
    const fresh = notOrdered.filter((n) => !sent.has(normalize(n.code)));
    if (notOrdered.length > fresh.length) lyDo.push(`bo ${notOrdered.length - fresh.length} the da gui trong 6h`);
    const inStock = fresh.filter((n) => inStockRows(n.item).length > 0);
    const shared = fresh.length >= LINK_INSTEAD_OF_CARDS && inStock.length >= LINK_INSTEAD_OF_CARDS ? (input.sharedFilter?.(fresh.map((n) => n.code)) ?? input.stock?.filterLink) : undefined;
    if (shared !== undefined && shared !== "") {
      plan.linkLoc = shared;
      lyDo.push(`${fresh.length} ma con hang cung bo loc → link loc thay the`);
    } else if (fresh.length > 0) {
      if (fresh.length >= LINK_INSTEAD_OF_CARDS) lyDo.push(`${fresh.length} ma nhung khong co bo loc chung → ${MAX_CARDS} the dau`);
      const size = input.requestedSize;
      plan.theSanPham = fresh.slice(0, MAX_CARDS).map((n) => {
        const hasSize = size !== "" && inStockRows(n.item).some((r) => normalize(r.size) === normalize(size));
        return hasSize ? { ma: n.code, size } : { ma: n.code };
      });
      lyDo.push(`${plan.theSanPham.length} the (${plan.theSanPham.map((c) => c.ma).join(", ")})`);
    }

    // (b) Closing: one code + size in stock, and the shop's way of closing.
    const closing = input.intent === "place_order" || input.readyToBuy || input.closingSignals.length > 0;
    if (closing) {
      plan.chot = true;
      const khiChot = input.hoSo?.banHang.khiChot ?? "";
      const stock = input.stock;
      const size = input.requestedSize || stock?.stock?.size || "";
      const code = input.focusCode || stock?.productCode || "";
      const settled = code !== "" && size !== "" && stock !== null && stock.stock !== null && normalize(stock.productCode) === normalize(code);
      // A running order: never a form for an item already in it, and only for an item named in this message.
      const hasOrder = ordered.size > 0;
      const newOrder = input.intent === "place_order" || input.readyToBuy || !ABOUT_AN_ORDER.has(input.intent);
      // 05/10/2026: several codes each with its own in-stock variant in THIS message → one form, one line each.
      const lines = orderLinesIn(input.message ?? "", input.found).filter((l) => !ordered.has(itemKey(l.ma)));
      if (khiChot === "phieu" && lines.length >= 2) { plan.phieu = { items: lines }; lyDo.push(`khach chot ${lines.length} mon (${lines.map((l) => `${l.ma} size ${l.size}`).join(", ")}) → mot phieu nhieu dong`); }
      else if (hasOrder && ordered.has(itemKey(code))) { plan.canNguoiChot = newOrder ? "don_dang_chay" : ""; lyDo.push(`khach dang co don chua ${code} → khong gui phieu${newOrder ? ", goi nguoi" : ""}`); }
      else if (hasOrder && !(input.namedThisTurn ?? []).includes(itemKey(code))) { plan.canNguoiChot = newOrder ? "don_dang_chay" : ""; lyDo.push(`khach dang co don, mon chua duoc nhac trong tin nay → khong gui phieu${newOrder ? ", goi nguoi" : ""}`); }
      else if (khiChot === "goi-nguoi") { plan.goiNguoi = true; lyDo.push("khach chot, shop chot qua nguoi → goi nguoi"); }
      else if (khiChot === "phieu" && settled) { plan.phieu = { items: [{ ma: code, size }] }; lyDo.push(`khach chot ${code} size ${size} con hang → phieu dat hang`); }
      else if (khiChot === "phieu") lyDo.push("khach chot nhung chua du ma + size con ton → chua gui phieu");
      else if (settled) { plan.canNguoiChot = "chua_khai_cach_chot"; lyDo.push("khach chot, shop chua khai cach chot → khong gui phieu, goi nguoi"); }
      else lyDo.push("khach chot, shop chua khai cach chot, chua du ma + size → khong gui phieu");
    }

    // (c) The measuring guide when the reply asks for a foot length.
    if (input.asksFootMeasure !== "") {
      try {
        const re = new RegExp(input.asksFootMeasure, "i");
        if (re.test(reply) || re.test(normalize(reply))) { plan.anhHuongDan = "do-chan"; lyDo.push("cau xin so do chan → anh huong dan"); }
      } catch { /* a broken pattern switches the rule off; the validator reports it */ }
    }

    // (d) The greeting, once, in front of the opening reply — not in front of a goodbye.
    if (!input.daChaoAi && input.firstReply && input.handoff !== true && !CLOSING_INTENTS.has(input.intent)) { plan.chaoAi = true; lyDo.push("luot dau, landing chen cau chao"); }
    return plan;
  }
}
