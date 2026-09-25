/**
 * Installs the real `nganh/` folder as the brain's pack source, the way `buildXeonApp` does.
 *
 * Since 21/09/2026 packs are JSON on disk, so a test that answers a customer needs a source
 * installed — the core ships with an empty one on purpose (it may not open files). Importing this
 * module is what the tests do instead of repeating the wiring; it also proves the shipped folder
 * parses, because `loadPack` validates.
 */

import { loadPack, usePackSource, type IndustryPack } from "@sp/brain";
import { DiskPackSource, INDUSTRY_DIRECTORY } from "@sp/xeon";

/** The folder the tests read industries from: the one that ships. */
export const TEST_INDUSTRY_DIRECTORY = INDUSTRY_DIRECTORY;

usePackSource(new DiskPackSource());

/** The running-shoes pack, the industry every merchant on the platform runs today. */
export const runningShoesPack: IndustryPack = loadPack("giay-chay");

/** The pharmacy pack: a second industry, deliberately shaped differently (two axes, its own gate). */
export const pharmacyPack: IndustryPack = loadPack("nha-thuoc");
