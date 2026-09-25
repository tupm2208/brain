/**
 * @file The intent classifier: Sales Desk's 15 keyword intents, copied as data (24/09/2026).
 *
 * Copied from Desk `ai_router.js`: `INTENT_RULES` (28–120), `PAID_MONEY_RE` / `PAID_ABOUT_GOODS_RE`
 * (~2623), `detectDepositInstruction` (~2702), `detectIntent` (~2713), `isPureGreeting` (~2771),
 * `resolvePaymentConversationFrame` (~2635) and `extractClosingSignals`. Pure: no model, no clock.
 *
 * Every keyword and regex is data (`loi-chung/y-dinh-chung.json` ⊕ `nganh/<id>/y-dinh.json`),
 * because "size" is an intent word for a shoe shop and noise for a pharmacy. The engine only knows
 * HOW to match: whole words on accent-stripped text, the highest confidence wins, small talk yields
 * to any transactional intent in the same message, and a message that only greets is a greeting.
 *
 * Three semantic detectors come first, in Desk's order, because keywords alone got them wrong in
 * production: "da chuyen 500k vao stk" is a payment claim, not a bank-account request (08/09); "co
 * cach nao khong chuyen khoan coc van mua duoc ko" asks about the deposit, it does not report one.
 */

import type { IntentRules, PaymentFramePatterns } from "../pack/types";
import type { Turn } from "../ports/index";
import { packRegex } from "./fill-text";
import { escapeRe, normalize } from "./text-analysis";

/** What the classifier concluded. `matched` lists the keywords and rule names that fired, for the trace. */
export interface IntentVerdict {
  intent: string;
  confidence: number;
  matched: string[];
}

export interface ClassifyOptions {
  /** Number of attachments (images) on the message: any means "send_image" is a candidate. */
  attachments?: number | undefined;
}

/**
 * The payment conversation frame (Desk `resolvePaymentConversationFrame`): the customer says money
 * was ALREADY sent, possibly disputing what the shipper collected on top of it.
 */
export interface PaymentFrame {
  kind: "payment_claim" | "payment_dispute";
  dispute: boolean;
  claimedAmount: number;
  collectedAmount: number;
  receiptSeen: boolean;
  confidence: number;
  evidence: string[];
}

/** Whole-word keyword test on normalised text (Desk `hasKeyword`). */
export function hasKeyword(normalizedText: string, keyword: string): boolean {
  const k = normalize(keyword);
  if (k === "") return false;
  return new RegExp(`(^|\\s)${escapeRe(k)}(?=\\s|$|[.,-])`).test(normalizedText);
}

/** "500k" → 500000, "1tr2" → 1200000, "1,2 trieu" → 1200000, "1.190.000" → 1190000; 0 when no amount (Desk `depositAmountFromText`). */
export function moneyAmountInText(message: string): number {
  const text = normalize(message);
  const short = /\b(\d{2,4})\s*k\b/.exec(text);
  if (short) return Number(short[1]) * 1000;
  // "1tr2" / "1 trieu 2" — a million with a tenth written after the unit (Desk read only the "1").
  const millionTenth = /\b(\d+)\s*(?:tr|trieu)\s*(\d)\b(?!\s*(?:k|nghin|ngan|\d))/.exec(text);
  if (millionTenth) return Number(millionTenth[1]) * 1_000_000 + Number(millionTenth[2]) * 100_000;
  const million = /\b(\d+(?:[.,]\d+)?)\s*(?:tr|trieu)\b/.exec(text);
  if (million) return Math.round(Number(million[1]!.replace(",", ".")) * 1_000_000);
  const full = /\b(\d{1,3}(?:[.,]\d{3})+)\s*(?:d|vnd)?\b/.exec(text);
  if (full) return Number(full[1]!.replace(/[.,]/g, ""));
  return 0;
}

/** Classifies one customer message with the merged intent rules of an industry. */
export class IntentClassifier {
  private readonly paidMoney: RegExp | null;
  private readonly paidAboutGoods: RegExp | null;

  constructor(private readonly rules: IntentRules) {
    this.paidMoney = packRegex(rules.paidMoney);
    this.paidAboutGoods = packRegex(rules.paidAboutGoods);
  }

  /** The intent of one message on its own (Desk `detectIntent`), before any history or model is consulted. */
  classify(message: string, options: ClassifyOptions = {}): IntentVerdict {
    const normalized = normalize(message);
    const matches: IntentVerdict[] = [];
    if ((options.attachments ?? 0) > 0) matches.push({ intent: "send_image", confidence: 0.94, matched: ["attachment"] });

    for (const rule of this.rules.rules) {
      const matched = rule.keywords.filter((keyword) => hasKeyword(normalized, keyword));
      if (matched.length > 0) {
        matches.push({ intent: rule.intent, confidence: Math.min(0.99, rule.confidence + Math.min(matched.length - 1, 3) * 0.03), matched });
      }
    }

    // Money already sent, and the sentence is about money (not "shop da chuyen hang chua").
    if (this.saysMoneySent(normalized)) return { intent: "payment_confirmation", confidence: 0.95, matched: ["paid_money_phrase"] };
    // "gửi mình số tài khoản để chuyển cọc" asks FOR the account: the bank script, not the deposit terms (kb2-20).
    if (packRegex(this.rules.deposit.asksAccount)?.test(normalized) ?? false) return { intent: "asks_bank_info", confidence: 0.95, matched: ["asks_account_phrase"] };
    if (this.depositQuestion(message) !== null) return { intent: "deposit_instruction", confidence: 0.96, matched: ["deposit_question_semantic"] };

    matches.sort((left, right) => right.confidence - left.confidence);
    const best = matches[0];
    if (best !== undefined) {
      // "ok shop toi lay mau nay": small talk only wins when nothing transactional is in the message.
      if (best.intent === "small_talk") {
        const transactional = matches.find((item) => this.rules.transactionalIntents.includes(item.intent));
        if (transactional !== undefined) return { ...transactional, matched: [...transactional.matched, "small_talk_demoted"] };
      }
      return best;
    }
    if (this.isPureGreeting(normalized)) return { intent: "greeting", confidence: 0.9, matched: ["pure_greeting"] };
    return { intent: "unknown", confidence: 0.35, matched: [] };
  }

  /** Desk `PAID_MONEY_RE && !PAID_ABOUT_GOODS_RE`: past tense + a transfer verb + a sign of money. */
  saysMoneySent(normalized: string): boolean {
    return (this.paidMoney?.test(normalized) ?? false) && !(this.paidAboutGoods?.test(normalized) ?? false);
  }

  /**
   * The customer asks about the deposit of an order ("coc bao nhieu la len don", "khong ck coc van
   * mua duoc ko") — a question, not a report of having paid. Returns the amount named, or `null`.
   */
  depositQuestion(message: string): { amount: number } | null {
    const d = this.rules.deposit;
    const text = normalize(message);
    if (!(packRegex(d.moneyWords)?.test(text) ?? false)) return null;
    if ((this.paidMoney?.test(text) ?? false) || (packRegex(d.pastPayment)?.test(text) ?? false)) return null;
    if (!(packRegex(d.asksCondition)?.test(text) ?? false) || !(packRegex(d.orderTalk)?.test(text) ?? false)) return null;
    return { amount: moneyAmountInText(message) };
  }

  /** A short message made only of greeting words (or only of icons, which normalisation strips to nothing). */
  isPureGreeting(normalized: string): boolean {
    const text = normalized.replace(/[.\-_~]+/g, " ").replace(/\s+/g, " ").trim();
    if (text === "") return true;
    if (text.split(" ").length > this.rules.greetingMaxWords) return false;
    return this.rules.greetingTokens.some((token) => hasKeyword(text, token));
  }

  /**
   * The payment frame of the message against the recent turns (Desk `resolvePaymentConversationFrame`).
   * `null` when the message is not about money already sent, when it asks for the bank account, or
   * when the plain classifier already said "payment_confirmation" and there is no dispute to add.
   */
  paymentFrame(message: string, turns: readonly Turn[], localIntent: IntentVerdict): PaymentFrame | null {
    const pf: PaymentFramePatterns = this.rules.paymentFrame;
    const text = normalize(message);
    if (!(packRegex(pf.moneyTalk)?.test(text) ?? false)) return null;
    if (localIntent.intent === "deposit_instruction") return null;
    if ((this.paidAboutGoods?.test(text) ?? false) && !/\bchuyen khoan\b/.test(text)) return null;
    const explicitlyAsksBank = packRegex(pf.explicitlyAsksBank)?.test(text) ?? false;
    const pastPayment = (this.paidMoney?.test(text) ?? false) || pf.pastPayment.some((p) => p !== "" && new RegExp(p).test(text));
    if (!pastPayment || explicitlyAsksBank) return null;

    const history = turns.slice(-(pf.historyDepth > 0 ? pf.historyDepth : 10));
    const customerHistory = history.filter((t) => t.role === "customer").map((t) => normalize(t.text)).join(" | ");
    const dispute = packRegex(pf.dispute)?.test(`${customerHistory} | ${text}`) ?? false;
    if (!dispute && localIntent.intent === "payment_confirmation") return null;
    const receiptRe = packRegex(pf.receiptSeen);
    const receiptSeen = receiptRe !== null && history.some((t) => t.role === "customer" && receiptRe.test(normalize(t.text)));
    const collectedRe = packRegex(pf.collected);
    let collectedAmount = 0;
    for (const t of [...history].reverse()) {
      if (t.role !== "customer" || collectedRe === null) continue;
      const line = normalize(t.text);
      if (!collectedRe.test(line)) continue;
      collectedAmount = moneyAmountInText(line);
      if (collectedAmount > 0) break;
    }
    return {
      kind: dispute ? "payment_dispute" : "payment_claim",
      dispute,
      claimedAmount: moneyAmountInText(message),
      collectedAmount,
      receiptSeen,
      confidence: dispute || receiptSeen ? 0.99 : 0.97,
      evidence: ["past_payment_language", dispute ? "recent_payment_dispute" : "", receiptSeen ? "recent_payment_receipt" : ""].filter((e) => e !== "")
    };
  }
}
