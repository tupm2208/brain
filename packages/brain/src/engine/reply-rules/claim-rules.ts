/**
 * @file Two rules about what the bot ASSERTS on the customer's behalf (05/10/2026, phiếu Desk):
 *
 * - `PhotoClaimRule` — a match from the customer's photo is a guess. "Đúng là mẫu … bên em", "đúng
 *   màu" turn a guess into a promise (the colourway in the photo may not be the one the shop has).
 *   The sentence is rewritten to a likeness, or cut, and the customer is asked to confirm.
 * - `PushCloseRule` — a customer with no sign of buying is not pushed to close; only the PUSH clause
 *   goes, a condition that explains the process stays, and a reply that is nothing but push is kept
 *   whole with a person called (never a farewell in place of an answer).
 *
 * Both work clause by clause and keep every other word of the draft. Every pattern and sentence is
 * data (`cong-soat-chung.json` ⊕ `nganh/<id>/cong-soat.json`); an empty list switches the rule off.
 */

import { itemKey } from "../order-care";
import { capitalizeFirst, gateNormalize, hasLetters, splitSentences, tidy, wordIn, type GateContext, type ReplyRule, type RuleResult } from "./support";

const present = <T>(x: T | null): x is T => x !== null;

export class PhotoClaimRule implements ReplyRule {
  readonly id = "photoClaim";

  apply(reply: string, g: GateContext): RuleResult | null {
    const cfg = g.cfg.photoClaim;
    if (g.src.photoContext !== true && g.src.hasImages !== true) return null;
    const claims = cfg.claims.map((p) => g.re(p)).filter(present);
    if (claims.length === 0) return null;
    const hedge = g.re(cfg.hedgeBefore);
    const question = g.re(cfg.question);
    const codeRe = g.re(g.cfg.evidence.codePattern, "g");
    const printed = new Set((g.src.photoCodesRead ?? []).map(itemKey).filter((c) => c !== ""));

    /** The claim in a sentence, or null: questions and hedged words are not claims. */
    const claimIn = (sentence: string): RegExpExecArray | null => {
      const n = gateNormalize(sentence);
      if (question?.test(n) ?? false) return null;
      for (const re of claims) {
        const m = re.exec(n);
        if (m === null) continue;
        if (hedge?.test(n.slice(Math.max(0, m.index - 30), m.index)) ?? false) continue;
        return m;
      }
      return null;
    };

    let changed = false;
    const kept: string[] = [];
    for (const sentence of splitSentences(reply)) {
      const claim = claimIn(sentence);
      if (claim === null) { kept.push(sentence); continue; }
      // The code is the evidence when the customer typed it or it is printed on the photo; a person's word stands.
      const codes = codeRe === null ? [] : [...sentence.toUpperCase().matchAll(codeRe)].map((m) => m[0]);
      if (codes.some((c) => printed.has(itemKey(c)) || wordIn(g.cust, gateNormalize(c)))) { kept.push(sentence); continue; }
      if (g.echoedPhrase(claim[0])) { kept.push(sentence); continue; }
      changed = true;
      let rewritten = sentence;
      for (const [pattern, replacement] of Object.entries(cfg.rewrite)) {
        const re = g.re(pattern, "giu");
        if (re !== null) rewritten = rewritten.replace(re, replacement);
      }
      if (/^\p{Lu}/u.test(sentence)) rewritten = capitalizeFirst(rewritten);
      if (rewritten !== sentence && claimIn(rewritten) === null && hasLetters(rewritten)) kept.push(rewritten);
    }
    if (!changed) return null;
    let out = tidy(kept.join(" "));
    const ask = g.fill(g.src.cardsSent === true ? cfg.confirmCards : cfg.confirmNoCards);
    if (!hasLetters(out)) out = capitalizeFirst(ask);
    else if (ask !== "" && !g.test(cfg.confirmAsked, gateNormalize(out))) out = `${out} ${ask}`;
    return { reply: out.trim(), trace: ["image_match_needs_confirm"] };
  }
}

/**
 * 05/10/2026 (phiếu Desk "khách gửi ảnh rồi hỏi, bot vẫn xin ảnh", Desk v29 `image_ack_fix`): the customer
 * sent a photo within the fresh window and the draft asks for "a photo" again. The asking sentence becomes
 * the data's acknowledgement + name / code request; every other sentence stays. Asking for ANOTHER picture
 * (a label, the box — `other`) is not asking again; a reply that already says the photo arrived is left.
 * Patterns run on the original sentence: "anh" the pronoun is not "ảnh".
 */
export class PhotoAgainRule implements ReplyRule {
  readonly id = "photoAgain";

  apply(reply: string, g: GateContext): RuleResult | null {
    const cfg = g.cfg.photoAgain;
    if (g.src.photoSent !== true || cfg.replacement.trim() === "") return null;
    const asks = cfg.asks.map((p) => g.re(p, "iu")).filter(present);
    if (asks.length === 0) return null;
    const other = cfg.other.map((p) => g.re(p, "iu")).filter(present);
    if (g.re(cfg.acknowledged, "iu")?.test(reply) ?? false) return null;
    let changed = false;
    const kept: string[] = [];
    for (const sentence of splitSentences(reply)) {
      const asking = asks.some((re) => re.test(sentence)) && !other.some((re) => re.test(sentence));
      if (!asking) { kept.push(sentence); continue; }
      if (!changed) kept.push(g.fill(cfg.replacement));
      changed = true;
    }
    if (!changed) return null;
    return { reply: tidy(kept.join(" ")).trim(), trace: ["photo_already_sent"] };
  }
}

export class PushCloseRule implements ReplyRule {
  readonly id = "pushClose";

  apply(reply: string, g: GateContext): RuleResult | null {
    const cfg = g.cfg.pushClose;
    const push = cfg.push.map((p) => g.re(p)).filter(present);
    if (push.length === 0) return null;
    const condition = g.re(cfg.condition);
    /** A real invitation to close: a push phrase that is not a condition explaining the process. */
    const pushHit = (clause: string): boolean => {
      const n = gateNormalize(clause);
      return push.some((re) => re.test(n)) && !(condition?.test(n) ?? false);
    };
    const sentences = splitSentences(reply).map((s) => s.split(/(?<=[,;])\s+/));
    if (!sentences.some((clauses) => clauses.some(pushHit))) return null;
    // Already thinking of buying: the model's / router's reading first, the customer's words as the net.
    if (g.src.buyingSignals === true || g.src.closing === true || g.test(cfg.buySignal, g.cust)) return null;

    const kept: string[] = [];
    for (const clauses of sentences) {
      const rest = clauses.filter((c) => !pushHit(c));
      if (rest.length === clauses.length) { kept.push(clauses.join(" ")); continue; }
      const text = rest.join(" ").trim().replace(/[,;]\s*$/, ".");
      if (hasLetters(text)) kept.push(text);
    }
    const out = tidy(kept.join(" "));
    if (!hasLetters(out)) {
      // Nothing but push: the customer still gets the answer as written, and a person decides.
      return { reply, trace: ["no_push_close_all_cut"], needsHuman: true, handoffReason: cfg.handoffReason };
    }
    return { reply: out, trace: ["no_push_close"] };
  }
}
