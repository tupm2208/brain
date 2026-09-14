/**
 * @file The contract between the three parts of the platform: merchant server, brain, console.
 *
 * Changing anything here changes all three parts at once. That is the point: the legacy TopRun
 * system copied one formula into three places by hand, and this package ends that.
 */

export * from "./ids";
export * from "./text";
export * from "./money";
export * from "./errors";
export * from "./events";
export * from "./catalog";
export * from "./pii";
export * from "./tools";
export * from "./modules";
export * from "./entitlements";

import { assertModuleGraph } from "./modules";
import { assertToolsSafeForBot } from "./tools";

/** Contract version. The brain uses it to refuse console builds that are too old. */
export const CONTRACT_VERSION = "0.4.0";

/**
 * Runs the architectural self-checks. Called at brain start-up and in the tests, so that a
 * change violating a principle fails immediately instead of being discovered with real money.
 */
export function selfCheck(): void {
  assertModuleGraph();
  assertToolsSafeForBot();
}
