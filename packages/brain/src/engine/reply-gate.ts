/**
 * @file The reply gate: the SECOND check of a draft, after the agent / LLM#3 wrote it and before it
 * is sent (stage 6, 25/09/2026). Copied from Desk `ai_fallback.js` `enforceReplyEvidence` and
 * `ai_fallback_gate.js` `enforcePolicyClaims`, with every regex and replacement sentence moved into
 * `loi-chung/cong-soat-chung.json` (all shops) and `nganh/<id>/cong-soat.json` (one industry).
 *
 * The agent's own `reviewReply` (round 1) BLOCKS a draft for a price with no source, a foreign
 * link, a banned phrase; this gate (round 2) REPAIRS a draft: it cuts the sentence, swaps the
 * number, or replaces the reply with a safe sentence, and says when a person must follow up.
 *
 * Order = Desk's order: the evidence rules of `enforceReplyEvidence` first, then the policy rules of
 * `enforcePolicyClaims`, tracking last (an earlier rule may replace the whole reply, so the tracking
 * link is added after all of them), and the forgotten links at the very end (`server.js` after
 * level 2). `needsHuman` never flips back to false (Desk).
 *
 * The pipeline should call it after the agent / LLM#3 and before sending: `needsHuman` → send the
 * repaired reply AND notify the shop (Desk `handoffAfterSend`), with `handoffReason` in the alert.
 */

import type { ReplyGateConfig } from "../pack/types";
import { AdviceRule, AppendLinksRule, EtaRule, LinkRule, PhotoLinkClaimRule, PhotosRule, PriceRangeRule, SizeChartRule, TrackingRule } from "./reply-rules/content-rules";
import { PhotoAgainRule, PhotoClaimRule, PushCloseRule } from "./reply-rules/claim-rules";
import { ConsultAskRule } from "./reply-rules/consult-rules";
import { EvidenceRule } from "./reply-rules/evidence-rules";
import { PriceDisputeRule, PriceStoryRule } from "./reply-rules/price-rules";
import { BargainRule } from "./reply-rules/bargain-rules";
import { OrderedItemRule } from "./reply-rules/order-rules";
import { SizePairRule, SizePendingRule } from "./reply-rules/size-rules";
import { StockLabelRule } from "./reply-rules/label-rules";
import { ContactRule, CustomerPaidRule, DepositRule, ExchangeDoneRule, ExchangeRule, IdentityRule, MoneyRule, PaymentRule, WarrantyRule } from "./reply-rules/policy-rules";
import { GateContext, type GateSources, type ReplyRule } from "./reply-rules/support";

export type { GateLinks, GateLookups, GateOrder, GateSources, GateProduct, ReplyRule, RuleResult } from "./reply-rules/support";
export { GateContext, gateNormalize, maskPronoun, pricesIn, splitSentences } from "./reply-rules/support";
export { OrderedItemRule } from "./reply-rules/order-rules";
export { PhotoAgainRule, PhotoClaimRule, PushCloseRule } from "./reply-rules/claim-rules";
export { ConsultAskRule } from "./reply-rules/consult-rules";
export { acceptableSizes } from "./reply-rules/content-rules";
export { SizePairRule, SizePendingRule, splitPieces } from "./reply-rules/size-rules";
export { toValue } from "./reply-rules/policy-rules";
export { PriceDisputeRule, PriceStoryRule, amountsIn } from "./reply-rules/price-rules";
export { BargainRule, bargainSaid } from "./reply-rules/bargain-rules";

export interface ReplyGateResult {
  reply: string;
  needsHuman: boolean;
  /** Desk's trace names, verbatim, in the order the rules fired. */
  trace: string[];
  handoffReason: string;
}

/** The rules in Desk's order. A new rule = one class and one line here. */
export function defaultReplyRules(): ReplyRule[] {
  return [
    // 05/10/2026 (phiếu Desk "bịa lý do đổi giá"): a reason for a price change is cut BEFORE the evidence rule
    // rewrites the amounts inside it.
    new PriceStoryRule(),
    // 05/10/2026 (phiếu Desk "khách mặc cả"): a promise to lower the price / accepting the customer's amount is cut
    // BEFORE the evidence rule turns that amount into the catalogue's ("1tr em để cho anh" → "1.290.000 em để…").
    new BargainRule(),
    new EvidenceRule(),
    new StockLabelRule(),
    // 05/10/2026: after the evidence rule (which may itself write "out of stock" from the stock facts).
    new OrderedItemRule(),
    // 05/10/2026: a guess from the customer's photo said as a fact ("đúng là mẫu … bên em", "đúng màu").
    new PhotoClaimRule(),
    // 05/10/2026: the customer just sent a photo and the draft asks for "a photo" again.
    new PhotoAgainRule(),
    // 05/10/2026 (phiếu Desk nhóm nhu cầu): a profile question the customer must not be asked (item named, known, asked once).
    new ConsultAskRule(),
    new IdentityRule(),
    new PaymentRule(),
    new CustomerPaidRule(),
    new ContactRule(),
    new WarrantyRule(),
    new DepositRule(),
    new MoneyRule(),
    new PriceRangeRule(),
    // 05/10/2026: after the evidence / money rules settled the draft's amounts on the data — what still
    // disagrees with the amount the customer is checking is not argued, a person checks.
    new PriceDisputeRule(),
    new ExchangeRule(),
    new ExchangeDoneRule(),
    new PhotosRule(),
    new PhotoLinkClaimRule(),
    new LinkRule(),
    // 05/10/2026 (phiếu Desk nhóm số đo): measurements still missing → no variant yet, ask (before the chart fix);
    // then the conversion sentence alone is fixed; then every pair (variant ↔ cm ↔ another system) follows the chart.
    new SizePendingRule(),
    new SizeChartRule(),
    new SizePairRule(),
    new EtaRule(),
    new AdviceRule(),
    // 05/10/2026: after every rule that may itself write a sentence — only a real push clause goes.
    new PushCloseRule(),
    new TrackingRule(),
    new AppendLinksRule()
  ];
}

/** Runs the rules in order on one draft. Pure: one config, one set of sources, one result. */
export class ReplyGate {
  private readonly rules: ReplyRule[];

  constructor(readonly cfg: ReplyGateConfig, rules?: ReplyRule[]) {
    this.rules = rules ?? defaultReplyRules();
  }

  run(reply: string, sources: GateSources, draft: { needsHuman?: boolean | undefined } = {}): ReplyGateResult {
    const gate = new GateContext(this.cfg, sources);
    let out = String(reply ?? "").trim();
    let needsHuman = draft.needsHuman === true;
    let handoffReason = "";
    if (out === "") return { reply: out, needsHuman, trace: [], handoffReason };
    for (const rule of this.rules) {
      const result = rule.apply(out, gate);
      if (result === null) continue;
      out = result.reply;
      if (result.needsHuman === true) needsHuman = true;
      if (handoffReason === "" && result.handoffReason !== undefined && result.handoffReason !== "") handoffReason = result.handoffReason;
      for (const t of result.trace ?? []) gate.trace.push(t);
    }
    return { reply: out, needsHuman, trace: [...gate.trace], handoffReason };
  }
}

/** Function facade: one call, the merged config of the industry. */
export function runReplyGate(cfg: ReplyGateConfig, reply: string, sources: GateSources, draft: { needsHuman?: boolean | undefined } = {}): ReplyGateResult {
  return new ReplyGate(cfg).run(reply, sources, draft);
}
