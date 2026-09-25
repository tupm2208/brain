/**
 * @file The policy rules of Desk `enforcePolicyClaims` (a) → (b3b): the bot's identity, money
 * received, contact details at closing, warranty, the deposit, any amount, exchange promises.
 * Each rule reads its regexes and sentences from the pack (`ReplyGateConfig`) and nothing else.
 */

import { PaymentClaimKit } from "../payment-claim";
import { gateNormalize, hasLetters, splitSentences, tidy, wordIn, type GateContext, type ReplyRule, type RuleResult } from "./support";

/** "em là người thật" / "em đang trực chat" → the sentence says what the bot is. */
export class IdentityRule implements ReplyRule {
  readonly id = "identity";
  apply(reply: string, g: GateContext): RuleResult | null {
    const patterns = g.cfg.identity.falseHuman.map((p) => g.re(p)).filter((r): r is RegExp => r !== null);
    if (patterns.length === 0) return null;
    let changed = false;
    const kept = splitSentences(reply).map((part) => {
      if (!patterns.some((re) => re.test(gateNormalize(part)))) return part;
      changed = true;
      return g.fill(g.cfg.identity.replacement);
    });
    return changed ? { reply: kept.join(" ").trim(), trace: ["false_human_identity"] } : null;
  }
}

/** The bot never confirms money arrived (Desk `payment_claim_kit`). Hands off with the reason. */
export class PaymentRule implements ReplyRule {
  readonly id = "payment";
  apply(reply: string, g: GateContext): RuleResult | null {
    if (g.cfg.payment.claims.length === 0) return null;
    const kit = new PaymentClaimKit(g.cfg.payment);
    const out = kit.stripPaymentReceivedClaims(reply, { pronoun: g.vars["khach"], customerMessage: g.src.customerMessage ?? g.custNow, vars: g.vars });
    if (!out.changed) return null;
    return { reply: out.reply, trace: ["payment_received_claim"], needsHuman: true, handoffReason: g.cfg.payment.handoffReason };
  }
}

/** At closing the system sends the order form: a sentence asking for phone / address / name is dropped. */
export class ContactRule implements ReplyRule {
  readonly id = "contact";
  apply(reply: string, g: GateContext): RuleResult | null {
    if (g.src.closing !== true) return null;
    const asks = g.re(g.cfg.contact.asks);
    const contact = g.re(g.cfg.contact.contact);
    if (asks === null || contact === null) return null;
    let changed = false;
    const kept = splitSentences(reply).filter((part) => {
      const text = gateNormalize(part);
      if (!(asks.test(text) && contact.test(text))) return true;
      changed = true;
      return false;
    });
    if (!changed) return null;
    const viaPerson = g.src.hoSo?.banHang.khiChot === "goi-nguoi";
    const note = g.fill(viaPerson ? g.cfg.contact.personNote : g.cfg.contact.formNote);
    if (note !== "" && !kept.some((part) => g.test(g.cfg.contact.formNoteMarker, gateNormalize(part)))) kept.push(note);
    return { reply: kept.join(" ").trim(), trace: ["closing_contact_request"] };
  }
}

/** Warranty / "bao check" / "100% chính hãng" without a source: the clause is cut, the rest kept. */
export class WarrantyRule implements ReplyRule {
  readonly id = "warranty";
  apply(reply: string, g: GateContext): RuleResult | null {
    const w = g.cfg.warranty;
    const trace: string[] = [];
    let out = reply;
    const sourced = w.sourceWords.some((word) => wordIn(g.source, gateNormalize(word)));
    if (g.test(w.detect, gateNormalize(out)) && !sourced) {
      const before = out;
      for (const p of w.cut) { const re = g.re(p, "giu"); if (re !== null) out = out.replace(re, ""); }
      out = tidy(out.replace(/\s{2,}/g, " "));
      if (!hasLetters(out)) out = g.fill(w.fallback);
      if (out !== before) trace.push("warranty_claim");
    }
    if (g.test(w.percentAuthenticity, gateNormalize(out)) && !g.test(w.percentSource, g.source)) {
      out = out.replace(/100\s*%\s*/g, "");
      trace.push("percent_authenticity");
    }
    return trace.length > 0 ? { reply: out, trace } : null;
  }
}

/** An amount or a percentage written in DEPOSIT context must come from a person, the policy, the profile or the customer. */
export class DepositRule implements ReplyRule {
  readonly id = "deposit";
  apply(reply: string, g: GateContext): RuleResult | null {
    const d = g.cfg.deposit;
    const norm = gateNormalize(reply);
    if (!g.test(d.context, norm)) return null;
    const nums: { raw: string; key: string; alt: string; percent: boolean }[] = [];
    for (const m of norm.matchAll(/(\d{1,3})\s*%/g)) nums.push({ raw: m[0], key: `${m[1]}%`, alt: `${m[1]} %`, percent: true });
    const moneyRe = g.re(d.money, "g");
    if (moneyRe !== null) for (const m of norm.matchAll(moneyRe)) { const amount = m[2] ?? m[1] ?? m[0]; nums.push({ raw: amount, key: amount.replace(/\s+/g, ""), alt: amount, percent: false }); }
    if (nums.length === 0) return null;
    const sourceText = `${g.source} ${g.cust}`;
    const srcValues = new Set<number>(g.knownPrices);
    for (const m of sourceText.matchAll(/(\d{1,3}(?:[.,]\d{3}){1,2}|\d{2,4}\s?k\b|\d(?:[.,]\d{1,2})?\s?(tr|trieu)\b|\d{5,})/g)) {
      const v = toValue(m[0]);
      if (Number.isFinite(v)) srcValues.add(v);
    }
    const bad = nums.filter((n) => (n.percent ? !(g.source.includes(n.key) || g.source.includes(n.alt)) : !srcValues.has(toValue(n.raw))));
    if (bad.length === 0) return null;
    const kept = splitSentences(reply).filter((sen) => !bad.some((b) => gateNormalize(sen).includes(b.raw)));
    return {
      reply: kept.join(" ").trim() || g.fill(d.fallback),
      trace: ["deposit_amount_no_source:" + bad.map((b) => b.raw).join(",")],
      needsHuman: true
    };
  }
}

/** "400K" / "400.000" / "1,2tr" → the number. */
export function toValue(raw: string): number {
  const k = String(raw).toLowerCase().replace(/\s+/g, "");
  const mk = k.match(/^(\d{2,4})k$/);
  const mt = k.match(/^(\d(?:[.,]\d{1,2})?)(tr|trieu)$/);
  if (mk) return Number(mk[1]) * 1000;
  if (mt) return Math.round(Number(mt[1]!.replace(",", ".")) * 1000000);
  const digits = k.replace(/[^\d]/g, "");
  return digits === "" ? NaN : Number(digits);
}

/** Every amount at or above `minAmount` in the reply must appear somewhere in the turn's data. */
export class MoneyRule implements ReplyRule {
  readonly id = "money";
  apply(reply: string, g: GateContext): RuleResult | null {
    const min = g.cfg.money.minAmount;
    if (min <= 0) return null;
    const prices = [...g.knownPrices].map(String).join(" ");
    const evidence = `${g.source} ${g.catalog} ${g.cust} ${prices}`.replace(/\s+/g, "");
    const moneyAll = /(\d{1,3}(?:[.,]\d{3}){1,2}\s?(d|đ|vnd)?|\d{3,4}\s?k\b|\d(?:[.,]\d{1,2})?\s?(tr|trieu)\b)/gi;
    const bad: string[] = [];
    for (const m of reply.matchAll(moneyAll)) {
      const raw = m[0];
      const value = toValue(raw.replace(/[đd]$|vnd$/i, ""));
      if (!Number.isFinite(value) || value < min) continue;
      const forms = [String(value), value.toLocaleString("vi-VN"), value.toLocaleString("en-US"), `${value / 1000}k`, `${value / 1000}K`, `${(value / 1000000).toString().replace(".", ",")}tr`, raw.replace(/\s+/g, "")];
      const found = g.knownPrices.has(value) || forms.some((f) => evidence.includes(gateNormalize(f).replace(/\s+/g, "")));
      if (!found) bad.push(raw);
    }
    if (bad.length === 0) return null;
    const kept = splitSentences(reply).filter((sen) => !bad.some((b) => sen.includes(b)));
    return { reply: kept.join(" ").trim() || g.fill(g.cfg.money.fallback), trace: ["money_no_source:" + bad.join(",")] };
  }
}

/**
 * A promise to exchange without a policy that says so (Desk v24/v28/v92): an ORDER item never
 * exchanges once bought; a stock item needs the policy or the profile to mention exchange; an open
 * exchange window from the order lookup is a source.
 */
export class ExchangeRule implements ReplyRule {
  readonly id = "exchange";
  apply(reply: string, g: GateContext): RuleResult | null {
    const e = g.cfg.exchange;
    const promise = g.re(e.promise);
    if (promise === null || !promise.test(gateNormalize(reply))) return null;
    if (g.src.lookups.exchange?.allowed === true) return null;
    const kind = g.src.stockFacts?.stockType;
    const orderItem = kind === "order" && !g.test(e.policyWords, gateNormalize(g.src.hoSo?.banHang.doiTraHangOrder ?? ""));
    const sanItem = kind === "san";
    const policyHasIt = g.test(e.policyWords, `${g.policy} ${g.profileText}`);
    if (!orderItem && (sanItem || policyHasIt)) return null;
    const kept = splitSentences(reply).filter((sen) => !promise.test(gateNormalize(sen)));
    const note = g.fill(orderItem ? e.orderItemNote : e.noPolicyNote);
    return {
      reply: `${kept.join(" ").trim()} ${note}`.trim(),
      trace: [orderItem ? "exchange_promise_order_item" : "exchange_promise_no_policy"],
      needsHuman: !orderItem
    };
  }
}

/** "em đã đổi sang size 40 cho bác rồi": the bot has no tool to edit an order (Desk v92). */
export class ExchangeDoneRule implements ReplyRule {
  readonly id = "done";
  apply(reply: string, g: GateContext): RuleResult | null {
    const done = g.re(g.cfg.exchange.done);
    if (done === null || !done.test(gateNormalize(reply))) return null;
    const kept = splitSentences(reply).filter((sen) => !done.test(gateNormalize(sen)));
    return { reply: `${kept.join(" ").trim()} ${g.fill(g.cfg.exchange.doneNote)}`.trim(), trace: ["exchange_claimed_done"] };
  }
}

