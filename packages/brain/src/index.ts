/**
 * @file The brain: runs on Xeon and serves every merchant.
 *
 * The engine in `engine/` knows NOTHING about shoes, medicine or spas. Industry knowledge lives
 * in `packs/`. Selling to a new industry = writing a new pack, never touching the engine.
 *
 * Layout (Ports & Adapters):
 *   ports/      the interfaces the engine needs from the outside world
 *   engine/     the deterministic turn pipeline and its collaborators
 *   pack/       the industry pack shape, its validator and the registry
 *   packs/      the built-in industry packs (data)
 */

// Re-exported from the contract: the brain is where these are used.
export { assertNoStoredPII, findPIIInText, redactPII } from "@sp/contract";
export * from "./pack/types";
export * from "./pack/validator";
export * from "./pack/registry";
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
export { runningShoesPack } from "./packs/running-shoes";
export { pharmacyPack } from "./packs/pharmacy";
