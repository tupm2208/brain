/**
 * @file Safety gates: the most expensive part of the system.
 *
 * This is what a year of tuition bought. In the legacy system it was scattered across
 * `ai_fallback_gate.js` and hundreds of lines of `ai_router.js`. Here it is a NEUTRAL engine
 * reading rules from the industry pack.
 *
 * Root principle, never to be relaxed: SILENCE IS BETTER THAN A WRONG ANSWER.
 *
 * Design: every rule kind has one evaluator class (Strategy). `GateChain` runs every rule of the
 * pack, collects all verdicts, and returns the most severe one (Chain of Responsibility where
 * every link is consulted and the worst outcome wins).
 */

import type { GateRule, IndustryPack, PackIntent } from "../pack/types";
import type { ConversationState } from "../ports/index";
import { askedBackWithin } from "./conversation-state";
import { scanNumbers, wordQuantityClaims } from "./number-scan";
import { normalize, soft, squash, stripDiacritics } from "./text-analysis";

/** One piece of evidence from a tool result. Every number the bot says must trace back to one. */
export interface Fact {
  source: string;
  text: string;
  numbers: number[];
}

export type GateAction = "send" | "ask_back" | "handoff" | "block";

export interface GateVerdict {
  action: GateAction;
  rule?: GateRule["kind"] | undefined;
  /** Written for the operator log; kept in Vietnamese because operators read it. */
  reason: string;
}

export interface GateInput {
  pack: IndustryPack;
  state: ConversationState;
  now: Date;
  draft: string;
  facts: Fact[];
  intent: PackIntent | null;
  itemIdentified: boolean;
  /**
   * The engine intends to ASK the customer back this turn. The `ask_back_once` gate only fires
   * when this is true, and it must be true on EVERY ask-back path, including those that bypass
   * intents; otherwise the bot loops on one question without ever calling a human.
   */
  wouldAskBack: boolean;
  online: boolean;
  catalogSize: number;
  claimsBrandNotCarried: boolean;
  hasPolicySource: boolean;
  /** Slot values the customer supplied. The bot may repeat them. */
  echoedValues: string[];
  /**
   * Text WRITTEN BY THE MERCHANT that tools returned (policy text, order status). Unlike pack
   * templates the validator cannot force it to carry diacritics, so forbidden patterns are also
   * compared in diacritic-stripped form on this text only.
   */
  toolText?: string[] | undefined;
}

const SEVERITY: Record<GateAction, number> = { send: 0, ask_back: 1, handoff: 2, block: 3 };

const RULE_PRIORITY: Record<GateRule["kind"], number> = {
  forbidden_phrases: 70,
  forbidden_patterns: 65,
  no_facts_when_offline: 50,
  no_unsourced_numbers: 40,
  require_source_for_claims: 30,
  brand_not_carried_needs_catalog: 20,
  require_item_before_stock: 10,
  ask_back_once: 5
};

function rank(verdict: GateVerdict): number {
  return SEVERITY[verdict.action] * 100 + (verdict.rule === undefined ? 0 : RULE_PRIORITY[verdict.rule]);
}

/**
 * Forbidden phrases and policy topics are checked in BOTH forms:
 *  - with diacritics: the canonical spelling of the pack;
 *  - without: to catch merchants who write templates without diacritics (very common).
 * Only MULTI-WORD phrases get the stripped comparison; single words would collide on "đôi/đổi".
 */
function phraseHit(draft: string, phrase: string): boolean {
  if (soft(draft).includes(soft(phrase))) return true;
  // Punctuation inserted in the middle must not let a phrase escape: "rẻ nhất - thị trường".
  if (squash(draft).includes(squash(phrase))) return true;
  const flat = normalize(phrase);
  if (flat.includes(" ")) return normalize(draft).includes(flat);
  return false;
}

/**
 * Compares a pack regex against the bot's sentence.
 *
 * ONLY on the DIACRITIC form, and that is a deliberate constraint: once stripped, "đôi" (pair of
 * shoes) and "đổi" (exchange) are ONE string, and no algorithm can tell them apart. Checking the
 * stripped form would read the ordinary sales line "còn 3 đôi size 42" as an exchange promise.
 *
 * In return, PACK TEMPLATES MUST BE WRITTEN WITH DIACRITICS; `PackValidator` rejects packs
 * written without them and says why.
 */
function patternHit(draft: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "u").test(soft(draft));
  } catch {
    return false;
  }
}

/** Strategy interface: one evaluator per rule kind. Returns `null` when the rule does not fire. */
interface RuleEvaluator<R extends GateRule = GateRule> {
  evaluate(rule: R, input: GateInput): GateVerdict | null;
}

class NoFactsWhenOfflineRule implements RuleEvaluator<Extract<GateRule, { kind: "no_facts_when_offline" }>> {
  evaluate(rule: Extract<GateRule, { kind: "no_facts_when_offline" }>, input: GateInput): GateVerdict | null {
    if (input.online) return null;
    if (input.facts.length > 0) {
      return { action: "block", rule: rule.kind, reason: "Mat ket noi may shop ma cau tra loi lai mang so lieu." };
    }
    const scan = scanNumbers(input.draft);
    if (scan.numbers.length > 0 || scan.structured.length > 0 || wordQuantityClaims(input.draft).length > 0) {
      return { action: "handoff", rule: rule.kind, reason: "Mat ket noi ma cau tra loi co con so — chuyen nguoi that." };
    }
    return null;
  }
}

class RequireItemBeforeStockRule implements RuleEvaluator<Extract<GateRule, { kind: "require_item_before_stock" }>> {
  evaluate(rule: Extract<GateRule, { kind: "require_item_before_stock" }>, input: GateInput): GateVerdict | null {
    const needsItem = input.intent?.requiredSlots.includes("item") === true;
    if (!needsItem || input.itemIdentified) return null;
    return { action: "ask_back", rule: rule.kind, reason: "Chua nhan ra dung mon hang ma da dinh tra loi ton kho." };
  }
}

class AskBackOnceRule implements RuleEvaluator<Extract<GateRule, { kind: "ask_back_once" }>> {
  evaluate(rule: Extract<GateRule, { kind: "ask_back_once" }>, input: GateInput): GateVerdict | null {
    if (!input.wouldAskBack) return null;
    const max = rule.maxTimes ?? 1;
    const count = input.state.askBackCount ?? 0;
    const withinWindow = askedBackWithin(input.state, input.now, rule.windowMinutes);
    // Two roads to a human: consecutive ask-backs within the window, OR the allowed number of
    // ask-backs used up in this episode even though the customer answered slowly.
    if (!withinWindow && count < max) return null;
    return {
      action: "handoff",
      rule: rule.kind,
      reason: withinWindow
        ? `Da hoi nguoc khach trong ${rule.windowMinutes} phut truoc ma van chua du thong tin.`
        : `Da hoi nguoc khach ${count} lan trong phien nay ma van chua du thong tin.`
    };
  }
}

class RequireSourceForClaimsRule implements RuleEvaluator<Extract<GateRule, { kind: "require_source_for_claims" }>> {
  evaluate(rule: Extract<GateRule, { kind: "require_source_for_claims" }>, input: GateInput): GateVerdict | null {
    const touched = rule.topics.filter((t) => phraseHit(input.draft, t));
    for (const p of rule.patterns ?? []) {
      if (patternHit(input.draft, p)) touched.push(p);
    }
    if (touched.length === 0 || input.hasPolicySource) return null;
    return {
      action: "block",
      rule: rule.kind,
      reason: `Khang dinh ve "${touched.join(", ")}" ma khong co ket qua tra chinh sach lam nguon.`
    };
  }
}

class NoUnsourcedNumbersRule implements RuleEvaluator<Extract<GateRule, { kind: "no_unsourced_numbers" }>> {
  evaluate(rule: Extract<GateRule, { kind: "no_unsourced_numbers" }>, input: GateInput): GateVerdict | null {
    const allowed = new Set<number>();
    const allowedText: string[] = [];
    for (const fact of input.facts) {
      for (const n of fact.numbers) allowed.add(n);
      scanNumbers(fact.text).structured.forEach((x) => allowedText.push(x));
    }
    for (const value of input.echoedValues) {
      const scan = scanNumbers(value);
      scan.numbers.forEach((n) => allowed.add(n));
      scan.structured.forEach((x) => allowedText.push(x));
    }

    const scan = scanNumbers(input.draft);
    const invented = scan.numbers.filter((n) => !allowed.has(n));
    const inventedStructured = scan.structured.filter((x) => !allowedText.includes(x));
    const wordy = wordQuantityClaims(input.draft);
    if (invented.length === 0 && inventedStructured.length === 0 && wordy.length === 0) return null;

    const parts: string[] = [];
    if (invented.length > 0) parts.push(`so khong truy duoc nguon: ${invented.join(", ")}`);
    if (inventedStructured.length > 0) parts.push(`gio/ngay khong co nguon: ${inventedStructured.join(", ")}`);
    if (wordy.length > 0) parts.push(`so luong viet bang chu: ${wordy.join(", ")}`);
    return { action: "block", rule: rule.kind, reason: `Cau tra loi co ${parts.join("; ")}.` };
  }
}

class BrandNotCarriedNeedsCatalogRule implements RuleEvaluator<Extract<GateRule, { kind: "brand_not_carried_needs_catalog" }>> {
  evaluate(rule: Extract<GateRule, { kind: "brand_not_carried_needs_catalog" }>, input: GateInput): GateVerdict | null {
    if (!input.claimsBrandNotCarried) return null;
    if (input.catalogSize >= rule.minItems) return null;
    return {
      action: "ask_back",
      rule: rule.kind,
      reason:
        `Muc luc moi co ${input.catalogSize} mon (can it nhat ${rule.minItems}) — ` +
        `chua du de dam noi shop khong kinh doanh hang do.`
    };
  }
}

class ForbiddenPhrasesRule implements RuleEvaluator<Extract<GateRule, { kind: "forbidden_phrases" }>> {
  evaluate(rule: Extract<GateRule, { kind: "forbidden_phrases" }>, input: GateInput): GateVerdict | null {
    const hit = input.pack.identity.neverSay.find((p) => phraseHit(input.draft, p));
    if (hit === undefined) return null;
    return { action: "block", rule: rule.kind, reason: `Cau chua cum bi cam: "${hit}".` };
  }
}

class ForbiddenPatternsRule implements RuleEvaluator<Extract<GateRule, { kind: "forbidden_patterns" }>> {
  evaluate(rule: Extract<GateRule, { kind: "forbidden_patterns" }>, input: GateInput): GateVerdict | null {
    for (const p of rule.patterns) {
      if (patternHit(input.draft, p)) {
        return { action: "block", rule: rule.kind, reason: `${rule.reason} (khop mau: ${p})` };
      }
      // Merchant-written text: also compare the stripped form. No "đôi/đổi" collision risk here,
      // because this is not a pack template and industry patterns are domain verbs ("liều dùng",
      // "uống ... viên"), not ordinary sales words.
      for (const t of input.toolText ?? []) {
        try {
          if (new RegExp(stripDiacritics(p), "u").test(stripDiacritics(t))) {
            return {
              action: "block", rule: rule.kind,
              reason: `${rule.reason} (khop mau "${p}" trong van ban cua shop)`
            };
          }
        } catch { /* PackValidator already reported the broken regex */ }
      }
    }
    return null;
  }
}

/** Registry of evaluators keyed by rule kind. Adding a rule kind = adding one class and one line. */
const EVALUATORS: { [K in GateRule["kind"]]: RuleEvaluator<Extract<GateRule, { kind: K }>> } = {
  no_facts_when_offline: new NoFactsWhenOfflineRule(),
  require_item_before_stock: new RequireItemBeforeStockRule(),
  ask_back_once: new AskBackOnceRule(),
  require_source_for_claims: new RequireSourceForClaimsRule(),
  no_unsourced_numbers: new NoUnsourcedNumbersRule(),
  brand_not_carried_needs_catalog: new BrandNotCarriedNeedsCatalogRule(),
  forbidden_phrases: new ForbiddenPhrasesRule(),
  forbidden_patterns: new ForbiddenPatternsRule()
};

function evaluateRule(rule: GateRule, input: GateInput): GateVerdict | null {
  const evaluator = EVALUATORS[rule.kind] as RuleEvaluator | undefined;
  if (evaluator === undefined) {
    return { action: "block", reason: `Luat khong hieu duoc: ${JSON.stringify(rule)}` };
  }
  return evaluator.evaluate(rule, input);
}

export interface GateOutcome {
  /** The most severe verdict. */
  verdict: GateVerdict;
  /** Every verdict that fired, for logging and tests. */
  all: GateVerdict[];
}

/** Runs every gate rule of the pack and returns the most severe verdict. */
export class GateChain {
  run(input: GateInput): GateOutcome {
    const all: GateVerdict[] = [];
    for (const rule of input.pack.gates) {
      const verdict = evaluateRule(rule, input);
      if (verdict !== null) all.push(verdict);
    }
    let worst: GateVerdict = { action: "send", reason: "Khong cong nao can." };
    for (const verdict of all) {
      if (rank(verdict) > rank(worst)) worst = verdict;
    }
    return { verdict: worst, all };
  }
}

const DEFAULT_CHAIN = new GateChain();

/** Function facade over `GateChain` for callers that do not need an instance. */
export function runGates(input: GateInput): GateOutcome {
  return DEFAULT_CHAIN.run(input);
}
