/**
 * @file Two rules about PRICE WORDS the data cannot back (05/10/2026, phiếu Desk 2026-09-02 "bot bịa lý do
 * đổi giá và cãi giá khách"):
 *
 * - `PriceStoryRule` — the system keeps no price history (no old price, no date of change), so every sentence
 *   explaining WHY a price moved ("vừa cập nhật giá", "giá đợt trước", "web chưa kịp cập nhật") is invented.
 *   The sentence goes, the check sentence comes, a person is called. Only a person on duty, the policy or the
 *   shop profile saying the same is a source.
 * - `PriceDisputeRule` — the customer is checking a price ("giá … mà", "trên web …") and names an amount: they
 *   looked at the storefront before writing, so the bot never answers with ANOTHER amount. That sentence goes,
 *   a person checks the real price. Runs after the evidence rule, which already swapped a draft amount that
 *   disagreed with the catalogue for the catalogue's — what is left disagreeing with the customer is a dispute.
 *
 * Every pattern and sentence is data (`cong-soat-chung.json` → `priceStory`); empty `reply` = both rules off.
 */

import { gateNormalize, splitSentences, tidy, type GateContext, type ReplyRule, type RuleResult } from "./support";

const present = <T>(x: T | null): x is T => x !== null;

/** Amounts never larger than this are read (a phone number is not a price). */
const AMOUNT_MAX = 1_000_000_000;
/** Two amounts closer than this are the same price (rounding, "1.25tr" vs "1.250.000"). */
const SAME_PRICE = 1000;

/**
 * Money amounts in an accent-stripped, lower-case text: "1.250.000(đ)", "1.250k", "1250k", "1tr25", "1,25tr",
 * "1 triệu 250", "1250000"; and, when `bareLead` matches the words right before it, a BARE "1250" (thousands —
 * how people type a price). A number glued to letters ("ie0841") is a code, never an amount.
 */
export function amountsIn(norm: string, minAmount: number, bareLead: RegExp | null = null): { value: number; at: number; raw: string }[] {
  const out: { value: number; at: number; raw: string }[] = [];
  const re = /(?<![a-z0-9.,])(?:(\d{1,3})(?:[.,](\d{1,3}))?\s?(?:tr|trieu)(?![a-z])(?:\s?(\d{1,3})(?![\d.,]))?|(\d{1,3}(?:[.,]\d{3})+)\s?k(?![a-z])|(\d{1,3}(?:[.,]\d{3}){1,2})(?![\d])|(\d{2,4})\s?k(?![a-z])|(\d{5,9})(?![\d.,])|(\d{3,4})(?![\d.,]))/g;
  for (const m of norm.matchAll(re)) {
    let value = NaN;
    if (m[1] !== undefined) value = Math.round((Number(m[1]) + Number(`0.${m[2] ?? m[3] ?? "0"}`)) * 1_000_000);
    else if (m[4] !== undefined) value = Number(m[4].replace(/[.,]/g, "")) * 1000;
    else if (m[5] !== undefined) value = Number(m[5].replace(/[.,]/g, ""));
    else if (m[6] !== undefined) value = Number(m[6]) * 1000;
    else if (m[7] !== undefined) value = Number(m[7]);
    else if (m[8] !== undefined && bareLead !== null && bareLead.test(norm.slice(0, m.index))) value = Number(m[8]) * 1000;
    if (Number.isFinite(value) && value >= minAmount && value <= AMOUNT_MAX) out.push({ value, at: m.index ?? 0, raw: m[0] });
  }
  return out;
}

/** Puts the check sentence once at the end of what is kept. */
function withCheck(kept: string[], check: string): string {
  const has = kept.some((s) => gateNormalize(s) === gateNormalize(check));
  return tidy([...kept, ...(has ? [] : [check])].join(" "));
}

export class PriceStoryRule implements ReplyRule {
  readonly id = "priceStory";

  apply(reply: string, g: GateContext): RuleResult | null {
    const cfg = g.cfg.priceStory;
    if (cfg.reply.trim() === "") return null;
    // A reason a person on duty / the policy / the profile gave is a source: that pattern no longer cuts.
    const story = cfg.story.map((p) => g.re(p)).filter(present).filter((re) => !re.test(g.source));
    if (story.length === 0) return null;
    const sentences = splitSentences(reply);
    const kept = sentences.filter((s) => !story.some((re) => re.test(gateNormalize(s))));
    if (kept.length === sentences.length) return null;
    return { reply: withCheck(kept, g.fill(cfg.reply)), trace: [cfg.storyReason || "price_story"], needsHuman: true, handoffReason: cfg.storyReason };
  }
}

export class PriceDisputeRule implements ReplyRule {
  readonly id = "priceDispute";

  apply(reply: string, g: GateContext): RuleResult | null {
    const cfg = g.cfg.priceStory;
    if (cfg.reply.trim() === "" || !g.test(cfg.contest, g.custNow)) return null;
    const min = Math.max(1, g.cfg.money.minAmount);
    const bare = g.re(cfg.bareLead);
    // The amount the customer names: in the message being answered, or the line just before it ("trên web 1250" / "sao lại khác").
    let said = amountsIn(g.custNow, min, bare).map((a) => a.value);
    if (said.length === 0) {
      const lines = String(g.src.customerSaid ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(-2);
      said = lines.flatMap((l) => amountsIn(gateNormalize(l), min, bare).map((a) => a.value));
    }
    if (said.length === 0) return null;
    const moneyContext = g.re(g.cfg.evidence.moneyContext);
    const differs = (sentence: string): boolean => {
      const n = gateNormalize(sentence);
      return amountsIn(n, min).some((a) => !(moneyContext?.test(n.slice(0, a.at)) ?? false) && said.every((c) => Math.abs(c - a.value) > SAME_PRICE));
    };
    const sentences = splitSentences(reply);
    const kept = sentences.filter((s) => !differs(s));
    if (kept.length === sentences.length) return null;
    return { reply: withCheck(kept, g.fill(cfg.reply)), trace: [`${cfg.contestReason || "price_dispute"}:${said.join("/")}`], needsHuman: true, handoffReason: cfg.contestReason };
  }
}
