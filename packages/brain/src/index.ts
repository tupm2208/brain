/**
 * @file The brain: runs on Xeon and serves every merchant.
 *
 * The engine in `engine/` knows NOTHING about shoes, medicine or spas. Industry knowledge lives
 * in JSON under `bo-nao/nganh/<id>/`, read through a `PackSource` installed from outside. Selling
 * to a new industry = adding a folder of JSON, never touching the engine and never rebuilding.
 *
 * Layout (Ports & Adapters):
 *   ports/      the interfaces the engine needs from the outside world
 *   engine/     the deterministic turn pipeline and its collaborators
 *   pack/       the industry pack shape, its reader, its validator and the registry
 */

// Re-exported from the contract: the brain is where these are used.
export { assertNoStoredPII, findPIIInText, redactPII } from "@sp/contract";
export * from "./pack/types";
export * from "./pack/parse";
export * from "./pack/validator";
export * from "./pack/registry";
export * from "./pack/agent-text";
export * from "./pack/prompt-text";
export * from "./pack/shop-overlay";
export * from "./ports/index";
export * from "./engine/text-analysis";
export * from "./engine/conversation-state";
export * from "./engine/number-scan";
export * from "./engine/gates";
export * from "./engine/intent";
export * from "./engine/axis";
export * from "./engine/template";
export * from "./engine/variant-numbers";
export * from "./engine/tool-handlers";
export * from "./engine/catalog";
export * from "./engine/turn-engine";
// Tier 1 of Sales Desk (24/09/2026): ledger, soft episode, dialogue frame, system note.
export * from "./engine/fill-text";
export * from "./engine/ledger";
export * from "./engine/episode";
export * from "./engine/dialogue-frame";
export * from "./engine/fact-note";
// Stage 2 of tier 1 (24/09/2026): the intent classifier, the entity extractor and the rule router.
export * from "./engine/intent-rules";
export * from "./engine/entities";
export * from "./engine/rule-router";
// Stage 3 of tier 1 (25/09/2026): catalog scoring, the resolver, the uncertain-product gate, the focus, the stock facts.
export * from "./engine/size-match";
export * from "./engine/catalog-score";
export * from "./engine/catalog-resolver";
export * from "./engine/uncertain-product";
export * from "./engine/focus-resolver";
export * from "./engine/stock-facts";
// Stage 6 (25/09/2026): the reply gate AFTER the draft (Desk enforceReplyEvidence / enforcePolicyClaims / payment_claim_kit).
export * from "./engine/payment-claim";
export * from "./engine/reply-gate";
