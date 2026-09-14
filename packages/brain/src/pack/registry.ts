/**
 * @file Registry of the built-in industry packs.
 *
 * Adding an industry = adding one pack and one line here. The engine is never touched.
 */

import { pharmacyPack } from "../packs/pharmacy";
import { runningShoesPack } from "../packs/running-shoes";
import type { IndustryPack } from "./types";
import { assertPackValid } from "./validator";

/** Built-in packs keyed by id. The id is what licences carry as the merchant's industry. */
export const BUILTIN_PACKS: Record<string, IndustryPack> = {
  [runningShoesPack.id]: runningShoesPack,
  [pharmacyPack.id]: pharmacyPack
};

/** Returns a validated built-in pack, or throws when the id is unknown or the pack is invalid. */
export function loadPack(id: string): IndustryPack {
  const pack = BUILTIN_PACKS[id];
  if (pack === undefined) throw new Error(`Khong co bo luat nganh "${id}".`);
  assertPackValid(pack);
  return pack;
}

/** Validates every built-in pack. Called at start-up and in the tests. */
export function selfCheckPacks(): void {
  for (const id of Object.keys(BUILTIN_PACKS)) loadPack(id);
}
