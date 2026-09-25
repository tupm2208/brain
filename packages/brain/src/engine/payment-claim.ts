/**
 * @file Desk `payment_claim_kit.js` (24/09/2026, Dũng — case Duy Pham ORD-1790226471756): THE BOT
 * NEVER SAYS "we received your money". Only a person (or the bank notification the server sends)
 * confirms money; every sentence of the draft that claims it is dropped and a neutral "em đã nhận
 * thông tin, em báo người phụ trách đối chiếu" goes first.
 *
 * Every regex is data (`cong-soat-chung.json` → `payment`), because the claim shapes are the
 * language's, not one shop's. Pure: no file, no clock.
 */

import type { ReplyGatePayment } from "../pack/types";
import { fillText } from "./fill-text";
import { capitalizeFirst, gateNormalize, splitSentences } from "./reply-rules/support";

export type PaymentClaimConfig = ReplyGatePayment;

export interface PaymentPendingTexts {
  /** The neutral sentence of tier 1 (`payment.pendingText`). */
  neutral: string;
  /** What the shop configured instead, if anything; used only when it does not itself claim money. */
  shopText?: string | undefined;
  /** Extra `{…}` values (`tenNguoiPhuTrach`). `{khach}` / `{Khach}` come from the pronoun. */
  vars?: Record<string, string> | undefined;
}

export interface StripOptions {
  pronoun?: string | undefined;
  /** The customer's current message: "nhận được tiền chưa?" turns "Dạ nhận rồi ạ" into a claim. */
  customerMessage?: string | undefined;
  vars?: Record<string, string> | undefined;
  shopText?: string | undefined;
}

/** The detector and the stripper, built once per config. */
export class PaymentClaimKit {
  private readonly claims: RegExp[];
  private readonly notClaimWindow: RegExp | null;
  private readonly refund: RegExp | null;
  private readonly customerReceives: RegExp | null;
  private readonly shopPays: RegExp | null;
  private readonly customerAsks: RegExp | null;
  private readonly filler: Set<string>;
  private readonly affirm: RegExp | null;
  private readonly notAffirm: RegExp | null;
  private readonly orderActions: RegExp | null;
  private readonly abbreviations: [RegExp, string][];

  constructor(readonly cfg: PaymentClaimConfig) {
    const re = (p: string): RegExp | null => { if (p === "") return null; try { return new RegExp(p); } catch { return null; } };
    this.claims = cfg.claims.map((p) => re(p.split("{money}").join(cfg.money))).filter((x): x is RegExp => x !== null);
    this.notClaimWindow = re(cfg.notClaimWindow);
    this.refund = re(cfg.refund);
    this.customerReceives = re(cfg.customerReceives);
    this.shopPays = re(cfg.shopPays);
    this.customerAsks = re(cfg.customerAsks);
    this.filler = new Set(cfg.fillerWords);
    this.affirm = re(cfg.affirm);
    this.notAffirm = re(cfg.notAffirm);
    this.orderActions = re(cfg.orderActions);
    this.abbreviations = Object.entries(cfg.abbreviations).map(([short, full]) => [new RegExp(`\\b${short}\\b`, "g"), full]);
  }

  /** Accent-stripped text with chat shorthand opened ("nhan dc ck r a" → "nhan duoc ck roi a"). */
  fold(text: string): string {
    let out = gateNormalize(text);
    for (const [re, full] of this.abbreviations) out = out.replace(re, full);
    return out;
  }

  private negatedBefore(text: string, index: number): boolean {
    if (this.notClaimWindow === null) return false;
    const words = text.slice(0, index).replace(/\bkhi (nay|nai|sang)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).slice(-3).join(" ");
    return this.notClaimWindow.test(words);
  }

  /** One sentence states the money arrived (not a question, not a refund, not the customer receiving). */
  sentenceClaimsReceived(sentence: string): boolean {
    const raw = String(sentence ?? "").trim();
    if (raw === "" || /\?\s*$/.test(raw)) return false;
    const text = this.fold(raw);
    if (this.refund?.test(text) === true || this.customerReceives?.test(text) === true || this.shopPays?.test(text) === true) return false;
    for (const re of this.claims) {
      const match = re.exec(text);
      if (match === null) continue;
      const verb = match[0].indexOf("nhan");
      if (this.negatedBefore(text, match.index + (verb >= 0 ? verb : 0))) continue;
      return true;
    }
    return false;
  }

  /** The customer asked whether the money arrived, or announced they sent it. */
  customerAsksPaymentReceived(customerMessage: string): boolean {
    return this.customerAsks !== null && this.customerAsks.test(this.fold(customerMessage));
  }

  /** A short "Dạ nhận rồi ạ" / "Dạ vâng ạ": an affirmation when the customer just asked about the money. */
  shortAffirmation(sentence: string): boolean {
    const raw = String(sentence ?? "").trim();
    if (raw === "" || /\?\s*$/.test(raw)) return false;
    const words = this.fold(raw).replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter((w) => w !== "" && !this.filler.has(w));
    if (words.length > 5) return false;
    const rest = words.join(" ");
    if (this.notAffirm?.test(rest) === true) return false;
    return rest === "" || this.affirm?.test(rest) === true;
  }

  isClaimSentence(sentence: string, asked: boolean): boolean {
    return this.sentenceClaimsReceived(sentence) || (asked && this.shortAffirmation(sentence));
  }

  /** Any sentence of the text claims the money arrived. */
  claimsPaymentReceived(text: string, customerMessage = ""): boolean {
    const asked = this.customerAsksPaymentReceived(customerMessage);
    return splitSentences(text).some((s) => this.isClaimSentence(s, asked));
  }

  /**
   * The sentence sent when the customer says they paid: the shop's configured text when it has one
   * that does not itself claim money, else tier 1's neutral one. `{khach}` / `{Khach}` are filled
   * from the pronoun (Desk's `{xung}` is accepted too).
   */
  paymentPendingText(texts: PaymentPendingTexts, pronoun: string): string {
    const shopText = (texts.shopText ?? "").trim();
    const text = shopText !== "" && !this.claimsPaymentReceived(shopText) ? shopText : texts.neutral;
    const who = (pronoun ?? "").trim() || "mình";
    const filled = fillText(text, { khach: who, Khach: capitalizeFirst(who), tenNguoiPhuTrach: "người phụ trách", ...(texts.vars ?? {}) });
    return filled.replace(/\{Xung\}/g, capitalizeFirst(who)).replace(/\{xung\}/g, who);
  }

  /** Drops every claim sentence (and the order actions built on it), puts the neutral sentence first. */
  stripPaymentReceivedClaims(reply: string, options: StripOptions = {}): { reply: string; changed: boolean } {
    const asked = this.customerAsksPaymentReceived(options.customerMessage ?? "");
    const parts = splitSentences(reply);
    const kept = parts.filter((s) => !this.isClaimSentence(s, asked));
    if (kept.length === parts.length) return { reply: String(reply ?? ""), changed: false };
    const neutral = this.paymentPendingText({ neutral: this.cfg.pendingText, shopText: options.shopText, vars: options.vars }, options.pronoun ?? "");
    const rest = kept.filter((s) => this.fold(s) !== this.fold(neutral) && this.orderActions?.test(this.fold(s)) !== true);
    return { reply: [neutral, ...rest].join(" ").trim(), changed: true };
  }
}

/** Function facades over `PaymentClaimKit` (Desk's exported names). */
export function isPaymentReceivedClaim(text: string, cfg: PaymentClaimConfig, customerMessage = ""): boolean {
  return new PaymentClaimKit(cfg).claimsPaymentReceived(text, customerMessage);
}

export function stripPaymentReceivedClaims(reply: string, cfg: PaymentClaimConfig, options: StripOptions = {}): { reply: string; changed: boolean } {
  return new PaymentClaimKit(cfg).stripPaymentReceivedClaims(reply, options);
}

export function paymentPendingText(texts: PaymentPendingTexts, pronoun: string, cfg: PaymentClaimConfig): string {
  return new PaymentClaimKit(cfg).paymentPendingText(texts, pronoun);
}
