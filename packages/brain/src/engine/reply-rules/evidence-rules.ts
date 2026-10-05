/**
 * @file Desk `enforceReplyEvidence` (1) → (5): a stock assertion when the item is unknown, a reply
 * that contradicts the stock facts, a size step the warehouse does not have, an order status nobody
 * looked up, agreeing to pay later, recommending the shoe the customer already wears, an unknown
 * code, and a price that does not match the warehouse. One rule, the steps in Desk's order, because
 * the price steps read what the earlier steps left of the reply.
 */

import { priceOf, type FoundItem } from "../catalog-score";
import { itemKey } from "../order-care";
import type { StockFacts } from "../stock-facts";
import { escapeRe } from "../text-analysis";
import { dotted, gateNormalize, pricesIn, splitSentences, tidy, wordIn, type GateContext, type ReplyRule, type RuleResult } from "./support";

export class EvidenceRule implements ReplyRule {
  readonly id = "evidence";

  apply(reply: string, g: GateContext): RuleResult | null {
    const ev = g.cfg.evidence;
    const facts = g.src.stockFacts;
    const trace: string[] = [];
    let out = reply;
    let needsHuman: boolean | undefined;
    const norm = (): string => gateNormalize(out);
    const priceText = (p: number | undefined): string => (p !== undefined && p > 0 ? `, giá ${p.toLocaleString("vi-VN")}đ` : "");

    // (1) a stock assertion while the system has not identified the item
    const asserting = g.re(ev.stockAssert)?.exec(norm()) ?? null;
    if (asserting !== null && g.src.uncertainProduct && !g.echoedPhrase(asserting[0])) {
      trace.push(`stock_unknown_assert:${asserting[0]}`);
      out = this.topicReply(g);
    }

    // (2) contradicting the stock facts, both ways. 05/10/2026 (phiếu Desk "cổng đè cả câu agent bằng câu
    // tồn kho mẫu khác"): only a sentence that talks about THE FACTS' ITEM contradicts them — the latest
    // item named before the stock words decides (`StockSubject`); that sentence is replaced, the offers of
    // something else right after it go, every other sentence of the draft stays.
    if (facts !== null && facts.requestedSize !== "") {
      const size = escapeRe(gateNormalize(facts.requestedSize).replace(/\//g, " "));
      const compile = (patterns: string[]): RegExp[] => patterns.map((p) => g.re(p.split("{size}").join(size))).filter((r): r is RegExp => r !== null);
      const inStock = facts.stock !== null && (facts.stock.qty ?? 1) > 0;
      const wrong = inStock ? compile(ev.saysOut) : facts.stock === null && !g.echoedInShop(`con size ${facts.requestedSize}`) ? compile(ev.saysIn) : [];
      const subject = new StockSubject(g, facts);
      const alternative = g.re(g.cfg.orderedItem.alternative);
      const sentences = splitSentences(out);
      let first = -1;
      let dropOffers = false;
      const kept: string[] = [];
      sentences.forEach((sentence, i) => {
        const n = gateNormalize(sentence).replace(/\//g, " ");
        const m = earliest(wrong, n);
        if (m !== null && subject.aboutFacts(n.slice(0, m.end))) {
          if (first < 0) { first = i; kept.push("\u0000"); }
          dropOffers = true;
          return;
        }
        if (dropOffers && alternative !== null && alternative.test(n)) return;
        dropOffers = false;
        kept.push(sentence);
      });
      if (first >= 0) {
        const price = facts.price > 0 ? facts.price : priceOf(g.src.found.find((it) => it.ma === facts.productCode) ?? { ma: "", ten: "", cac_size: [] });
        const vars = { ten: facts.productName, ma: facts.productCode, size: facts.requestedSize, ton: facts.stock?.qty ?? "", gia: priceText(price) };
        const fixed = inStock ? g.fill(ev.inStockReply, vars) : g.fill(g.test(ev.colorsAsked, g.custNow) ? ev.outOfStockColorsReply : ev.outOfStockReply, vars);
        trace.push(inStock ? "contradicts_stock_in" : "contradicts_stock_out");
        // A list written line by line stays a list.
        out = tidy(kept.map((s) => (s === "\u0000" ? fixed : s)).join(out.includes("\n") ? "\n" : " "));
      }
    }

    // (2c) the size step: the warehouse has 41 1/3, the reply says "size 41"
    if (facts !== null && facts.stock !== null && facts.stock.approximate && facts.stock.size !== "" && facts.requestedSize !== "") {
      const want = String(facts.stock.size);
      const asked = escapeRe(String(facts.requestedSize).replace(/\//g, " "));
      const askedRe = new RegExp(`size\\s*${asked}(?!\\s*[\\d/])`, "g");
      if (askedRe.test(norm()) && !norm().replace(/\//g, " ").includes(want.replace(/\//g, " "))) {
        trace.push("approx_size_named_exact");
        out = out.replace(new RegExp(`size\\s*${escapeRe(String(facts.requestedSize))}(?!\\s*[\\d/])`, "g"), `size ${want}`);
      }
    }

    // (4) an order status nobody looked up
    const ord = g.re(ev.orderClaim)?.exec(norm()) ?? null;
    if (ord !== null && !g.src.lookups.orderLooked && !g.echoedInShop(ord[0])) {
      trace.push(`order_claim_no_lookup:${ord[0]}`);
      out = g.fill(g.test(ev.phone, g.cust) ? ev.orderCheckReply : ev.orderAskPhoneReply);
    }

    // (6) agreeing to ship first and be paid later: a person decides that
    const defer = g.re(ev.defer)?.exec(norm()) ?? null;
    const custAsksDefer = g.test(ev.customerAsksDefer, g.cust);
    const agreesShip = g.test(ev.agreesShip, norm()) && !g.test(ev.agreesShipUnless, norm());
    if ((defer !== null && !g.echoedInShop(defer[0])) || (custAsksDefer && agreesShip && !g.echoedInShop("nhan hang thanh toan"))) {
      trace.push(`payment_defer_agree:${(defer !== null ? defer[0] : "customer_defer").slice(0, 30)}`);
      out = g.fill(ev.deferReply);
      needsHuman = true;
    }

    // (8) recommending the very shoe the customer wears when they asked for something else
    const currentShoe = gateNormalize(g.src.currentShoe ?? "");
    if (currentShoe !== "" && g.test(ev.wantsDifferent, g.cust)) {
      const stop = new Set(ev.brandStop.map(gateNormalize));
      const toks = currentShoe.split(/\s+/).filter((x) => x.length >= 3 && !stop.has(x));
      if (toks.length > 0 && toks.every((x) => wordIn(norm(), x)) && g.test(ev.recommendVerbs, norm())) {
        trace.push("recommends_current_shoe");
        out = g.fill(ev.currentShoeReply, { doiDangDi: g.src.currentShoe ?? "" });
      }
    }

    // (5) codes and prices
    const codes = g.codesIn(out);
    const found = g.src.found;
    const knownCodes = new Set(found.map((q) => q.ma.toUpperCase()));
    if (facts !== null) knownCodes.add(facts.productCode.toUpperCase());
    // 05/10/2026: a code printed on the customer's photo, or the one the system matched it to, is not an invented one.
    [...(g.src.photoCodesRead ?? []), ...(g.src.photoCodes ?? [])].forEach((c) => knownCodes.add(c.toUpperCase()));
    const alien = codes.filter((c) => !knownCodes.has(c) && !wordIn(g.shop, gateNormalize(c)) && !wordIn(g.catalog, gateNormalize(c)) && !wordIn(g.cust, gateNormalize(c)));
    if (alien.length > 0) {
      trace.push(`alien_code:${alien.join(",")}`);
      if (facts !== null && facts.stock !== null && (facts.stock.qty ?? 1) > 0) {
        out = g.fill(ev.inStockReply, { ten: facts.productName, ma: facts.productCode, size: facts.requestedSize, ton: facts.stock.qty ?? "", gia: priceText(facts.price) });
      } else {
        out = g.fill(ev.alienReply);
      }
    }
    let item: FoundItem | undefined;
    if (alien.length === 0 && codes.length === 1) item = found.find((p) => p.ma.toUpperCase() === codes[0]);
    if (item === undefined && codes.length === 0) {
      const anchor = (facts?.productCode ?? "").toUpperCase();
      if (anchor !== "") item = found.find((p) => p.ma.toUpperCase() === anchor);
      if (item === undefined && found.length === 1) item = found[0];
    }
    // the price table: code → true price, from the finder, the stock facts and the advice candidates
    const knownPrice = new Map<string, number>();
    found.forEach((q) => { const p = priceOf(q); if (p > 0) knownPrice.set(q.ma.toUpperCase(), p); });
    (g.src.adviceCandidates ?? []).forEach((c) => { if (c.price !== undefined && c.price > 0 && !knownPrice.has(c.code.toUpperCase())) knownPrice.set(c.code.toUpperCase(), c.price); });
    if (facts !== null && facts.price > 0) knownPrice.set(facts.productCode.toUpperCase(), facts.price);
    for (const code of codes) {
      const truth = knownPrice.get(code);
      if (truth === undefined) continue;
      // no full stop in the segment cut: Vietnamese prices carry dots ("2.790.000")
      const seg = new RegExp(`${escapeRe(code)}[^,!?\n]{0,60}`, "i").exec(out);
      if (seg === null) continue;
      for (const pr of pricesIn(gateNormalize(seg[0]))) {
        if (Math.abs(pr - truth) > 1000 && !g.knownPrices.has(pr)) {
          const wrong = dotted(pr);
          if (!g.shop.includes(wrong) && out.includes(wrong)) {
            trace.push(`cascade_price_fix:${code}:${pr}->${truth}`);
            out = out.replace(wrong, truth.toLocaleString("vi-VN"));
          }
        }
      }
    }
    // v12c: the size sits in ANOTHER warehouse at another price — the stock facts' price is the truth
    if (facts !== null && facts.price > 0 && facts.kho !== undefined && facts.stock !== null && item !== undefined && item.ma.toUpperCase() === facts.productCode.toUpperCase()) {
      const itemPrice = priceOf(item);
      if (itemPrice > 0 && Math.abs(itemPrice - facts.price) > 1000) {
        const wrongDotted = itemPrice.toLocaleString("vi-VN");
        const wrongK = Math.round(itemPrice / 1000);
        const want = `${facts.price.toLocaleString("vi-VN")}đ`;
        const before = out;
        out = out.replace(new RegExp(`${wrongDotted.replace(/\./g, "[.,]")}\\s*(đ|d|vnđ)?`, "g"), want)
          .replace(new RegExp(`(?<![\\d.,])${wrongK}\\s?[kK](?![\\d])`, "g"), want);
        if (out !== before) trace.push(`kho_price_fix:${itemPrice}->${facts.price}`);
      }
    }
    if (item !== undefined) {
      const itemPrice = facts !== null && facts.productCode.toUpperCase() === item.ma.toUpperCase() && facts.price > 0 ? facts.price : priceOf(item);
      if (itemPrice > 0) {
        const money = g.re(ev.moneyContext);
        for (const pr of pricesIn(norm())) {
          const prDotted = dotted(pr);
          const prK = `${pr / 1000}k`;
          const at = norm().indexOf(prDotted) >= 0 ? norm().indexOf(prDotted) : norm().indexOf(prK);
          const before = norm().slice(0, at < 0 ? 0 : at);
          const custMentions = g.cust.includes(prDotted) || g.cust.includes(prK) || wordIn(g.cust, String(pr / 1000));
          const isDeposit = g.src.moneyContext?.deposit === pr;
          if ((money !== null && money.test(before)) || custMentions || isDeposit) { trace.push(`price_skip_money_context:${pr}`); continue; }
          if (Math.abs(pr - itemPrice) > 1000 && !g.shop.includes(prDotted)) {
            const want = `${itemPrice.toLocaleString("vi-VN")}đ`;
            if (g.test(ev.priceAgree, norm())) {
              trace.push(`price_agree_customer:${pr}!=${itemPrice}`);
              out = g.fill(ev.priceAgreeReply, { ten: item.ten, gia: want });
            } else if (g.test(ev.variantDivergence, norm())) {
              trace.push(`price_variant_divergence:${pr}`);
              out = g.fill(ev.variantReply);
            } else {
              trace.push(`price_mismatch:${pr}->${itemPrice}`);
              out = out.replace(/(?<![\d.,])(\d{1,2}[.,]\d{3}[.,]\d{3}\s?(đ|d|vnđ)?|\d{3,4}\s?[kK]\b)(?![\d.,])/g, want).replace(/đđ/g, "đ");
            }
            break;
          }
        }
      }
    }

    if (trace.length === 0) return null;
    return { reply: out, trace, ...(needsHuman !== undefined ? { needsHuman } : {}) };
  }

  /** Desk `gateTopicReply`: a safe sentence that follows the customer's question instead of a generic ask-back. */
  topicReply(g: GateContext): string {
    const ev = g.cfg.evidence;
    const q = g.custNow;
    if (g.test(ev.colorsAsked, q)) return g.fill(ev.topicColorsReply);
    const discovery = g.test(ev.discovery, `${q} ${g.cust}`);
    const link = g.src.links.filterLink ?? g.src.links.groupLink ?? "";
    if (discovery && link !== "") return g.fill(ev.discoveryLinkReply, { link });
    if (discovery) return g.fill(ev.discoveryAskReply);
    return g.fill(ev.topicReply);
  }
}

/** The earliest match of any pattern in `text`, with where it ends. */
function earliest(patterns: readonly RegExp[], text: string): { index: number; end: number } | null {
  let best: { index: number; end: number } | null = null;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m !== null && (best === null || m.index < best.index)) best = { index: m.index, end: m.index + m[0].length };
  }
  return best;
}

/** All whole-word positions of `needle` (normalised) in `hay` (normalised). */
function positions(hay: string, needle: string): number[] {
  if (needle === "") return [];
  const re = new RegExp(`(^|[^a-z0-9])(${escapeRe(needle)})(?=[^a-z0-9]|$)`, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) !== null) { out.push(m.index + m[1]!.length); re.lastIndex = m.index + m[0].length; }
  return out;
}

/**
 * Which item a stock sentence talks about (05/10/2026). Mentions are the facts' item (its code, the
 * strong words of its name, its brand) or another one (another code, a brand of the industry's lexicon
 * that is not the item's, a strong word only another found item carries). The LAST mention before the
 * stock words wins ("<the item's name> … but <size> is out" is the item; "<another brand> this one, … out of
 * <size>" is not).
 * No mention: the sentence is about the item, unless the customer sent a photo this turn that was not
 * matched to it — then nobody knows which item "this one" is, and the draft is kept (the safe side).
 */
class StockSubject {
  private readonly code: string;
  private readonly own: Set<string>;
  private readonly others: Set<string>;

  constructor(private readonly g: GateContext, facts: StockFacts) {
    this.code = itemKey(facts.productCode);
    const strong = (name: string): string[] => gateNormalize(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !/^\d+$/.test(t));
    const item = g.src.found.find((it) => itemKey(it.ma) === this.code);
    this.own = new Set([...strong(facts.productName), ...strong(item?.ten ?? ""), ...(item?.hang !== undefined ? [gateNormalize(item.hang)] : [])].filter((t) => t !== ""));
    const brands = (g.src.brandWords ?? []).map(gateNormalize).filter((b) => b !== "" && !this.own.has(b));
    const ownBrandInName = brands.filter((b) => wordIn(gateNormalize(facts.productName), b));
    ownBrandInName.forEach((b) => this.own.add(b));
    const otherWords = g.src.found.filter((it) => itemKey(it.ma) !== this.code).flatMap((it) => [...strong(it.ten), ...(it.hang !== undefined ? [gateNormalize(it.hang)] : [])]);
    this.others = new Set([...brands, ...otherWords].filter((t) => t !== "" && !this.own.has(t)));
  }

  private sameCode(key: string): boolean {
    if (key === "" || this.code === "") return false;
    if (key === this.code) return true;
    const [short, long] = key.length < this.code.length ? [key, this.code] : [this.code, key];
    return short.length >= 6 && long.startsWith(short);
  }

  aboutFacts(prefix: string): boolean {
    let last: { at: number; own: boolean } | null = null;
    const note = (at: number, own: boolean): void => { if (last === null || at >= last.at) last = { at, own }; };
    const codeRe = this.g.re(this.g.cfg.evidence.codePattern, "g");
    if (codeRe !== null) for (const m of prefix.toUpperCase().matchAll(codeRe)) note(m.index ?? 0, this.sameCode(itemKey(m[0])));
    for (const w of this.own) for (const at of positions(prefix, w)) note(at, true);
    for (const w of this.others) for (const at of positions(prefix, w)) note(at, false);
    const found = last as { at: number; own: boolean } | null;
    if (found !== null) return found.own;
    const photoIsItem = (this.g.src.photoCodes ?? []).some((c) => this.sameCode(itemKey(c)));
    return !(this.g.src.hasImages === true && !photoIsItem);
  }
}
