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
import { inStockRows, normalize, type FoundItem, type StockFacts } from "@sp/brain";

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
}

export interface DispatchPlan {
  theSanPham: InboxCardRequest[];
  linkLoc?: string | undefined;
  /** The order form to ask the landing for (the pipeline calls `order.formLink`). */
  phieu?: { items: { ma: string; size: string }[] } | undefined;
  /** The shop closes through a person: the pipeline notifies instead of sending a form. */
  goiNguoi: boolean;
  anhHuongDan?: "do-chan" | undefined;
  chaoAi: boolean;
  /** Why each part was chosen or not, for the dossier. */
  lyDo: string[];
}

/** Intents that end the conversation: no greeting in front of a goodbye or a complaint. */
const CLOSING_INTENTS = new Set(["small_talk", "complaint_or_human", "payment_confirmation"]);
const MAX_CARDS = 2;
const LINK_INSTEAD_OF_CARDS = 3;

export class ReplyDispatcher {
  plan(input: DispatchInput): DispatchPlan {
    const lyDo: string[] = [];
    const plan: DispatchPlan = { theSanPham: [], goiNguoi: false, chaoAi: false, lyDo };

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
    const fresh = named.filter((n) => !sent.has(normalize(n.code)));
    if (named.length > fresh.length) lyDo.push(`bo ${named.length - fresh.length} the da gui trong 6h`);
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
      const khiChot = input.hoSo?.banHang.khiChot ?? "";
      const stock = input.stock;
      const size = input.requestedSize || stock?.stock?.size || "";
      const code = input.focusCode || stock?.productCode || "";
      const settled = code !== "" && size !== "" && stock !== null && stock.stock !== null && normalize(stock.productCode) === normalize(code);
      if (khiChot === "goi-nguoi") { plan.goiNguoi = true; lyDo.push("khach chot, shop chot qua nguoi → goi nguoi"); }
      else if (khiChot === "phieu" && settled) { plan.phieu = { items: [{ ma: code, size }] }; lyDo.push(`khach chot ${code} size ${size} con hang → phieu dat hang`); }
      else if (khiChot === "phieu") lyDo.push("khach chot nhung chua du ma + size con ton → chua gui phieu");
      else lyDo.push("khach chot, shop chua khai cach chot → khong gui phieu");
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
