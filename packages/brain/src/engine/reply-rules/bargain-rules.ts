/**
 * @file The customer BARGAINS (05/10/2026, phiếu Desk 2026-09-06 "khách mặc cả kiểu viết tắt").
 *
 * Bargaining on chat is short: an amount and "được không" ("1tr dc kh a") as often as "bớt chút được không".
 * Missing it, the bot promised a discount or asked back "what price do you want"; over-reading it, a question
 * about the shop's programme ("giảm bao nhiêu %", "đang sale không") was treated as haggling. So:
 *
 * - `bargainSaid` reads the customer's message: the pack's request phrases, or an AMOUNT (read by the gate's
 *   one money reader, `amountsIn`) followed right away by "được không"; a programme question never counts.
 * - `BargainRule` repairs the draft by the SHOP'S choice (`banHang.macCa`, tier 3): a sentence asking the
 *   customer for a price always goes; a promise of a lower price (or accepting the customer's amount) goes
 *   unless the shop lowers prices; "không giảm" / "quà tặng" make sure the listed-price sentence is said
 *   (the on-sale variant when the item in focus is on sale); NOTHING declared = the price stays, a person answers.
 *
 * Every pattern and sentence is data (`cong-soat-chung.json` → `bargain`); empty `reply` = the rule is off.
 */

import type { ReplyGateConfig } from "../../pack/types";
import { amountsIn } from "./price-rules";
import { gateNormalize, splitSentences, tidy, type GateContext, type ReplyRule, type RuleResult } from "./support";

/** The smallest amount of money read in a bargaining message (a size or a count is not an offer). */
const OFFER_MIN = 1000;
/** Two amounts closer than this are the same offer ("1tr" vs "1.000.000đ"). */
const SAME_AMOUNT = 1000;

const compile = (pattern: string): RegExp | null => {
  if (pattern === "") return null;
  try { return new RegExp(pattern); } catch { return null; }
};
const present = <T>(x: T | null): x is T => x !== null;

/** The customer's message (accent-stripped, lower case — `gateNormalize`) asks for a lower price. */
export function bargainSaid(norm: string, cfg: ReplyGateConfig): boolean {
  const b = cfg.bargain;
  if (b.notBargain.map(compile).filter(present).some((re) => re.test(norm))) return false;
  if (b.ask.map(compile).filter(present).some((re) => re.test(norm))) return true;
  const tail = compile(b.amountAsk === "" ? "" : `^(?:${b.amountAsk})`);
  if (tail === null) return false;
  return amountsIn(norm, OFFER_MIN).some((a) => tail.test(norm.slice(a.at + a.raw.length)));
}

export class BargainRule implements ReplyRule {
  readonly id = "bargain";

  apply(reply: string, g: GateContext): RuleResult | null {
    const b = g.cfg.bargain;
    if (b.reply.trim() === "" || !bargainSaid(g.custNow, g.cfg)) return null;
    const kieu = g.src.hoSo?.banHang.macCa.kieu ?? "";
    // Only a shop that declared it lowers prices may let a promise through ("giảm tối đa" — its limit is in the prompt).
    const promiseOff = kieu !== "giam-toi-da";
    const cut = [...b.askTarget, ...(promiseOff ? b.promise : [])].map(compile).filter(present);
    const offered = promiseOff ? amountsIn(g.custNow, OFFER_MIN).map((a) => a.value) : [];
    const takesOffer = (norm: string): boolean => amountsIn(norm, OFFER_MIN).some((a) =>
      offered.some((v) => Math.abs(v - a.value) <= SAME_AMOUNT) && ![...g.knownPrices].some((p) => Math.abs(p - a.value) <= SAME_AMOUNT));
    const sentences = splitSentences(reply);
    const kept = sentences.filter((s) => { const n = gateNormalize(s); return !cut.some((re) => re.test(n)) && !takesOffer(n); });
    const refused = g.test(b.refusal, gateNormalize(kept.join(" ")));
    const trace = [`${b.reason || "mac_ca"}:${kieu || "chua_khai"}`];

    if (kieu === "") {
      // Nothing declared: never a promise, never a policy of our own — the listed price, and a person answers.
      const line = refused ? [] : [g.fill(b.replyUnset)];
      return { reply: tidy([...line, ...kept].join(" ")), trace, needsHuman: true, handoffReason: b.unsetReason || "mac_ca" };
    }
    if (kieu === "giam-toi-da") {
      if (kept.length === sentences.length) return null;
      if (kept.length > 0) return { reply: tidy(kept.join(" ")), trace };
      return { reply: g.fill(b.replyUnset), trace, needsHuman: true, handoffReason: b.unsetReason || "mac_ca" };
    }
    // "không giảm" / "quà tặng": the price stays — said once, first, the rest of the draft after it.
    if (kept.length === sentences.length && refused) return null;
    const focus = g.src.found.find((it) => it.ma === g.src.focusCode) ?? (g.src.found.length === 1 ? g.src.found[0] : undefined);
    const onSale = Number(focus?.phan_tram_giam ?? 0) > 0;
    const line = refused ? [] : [g.fill(onSale && b.replySale.trim() !== "" ? b.replySale : b.reply)];
    return { reply: tidy([...line, ...kept].join(" ")), trace };
  }
}
