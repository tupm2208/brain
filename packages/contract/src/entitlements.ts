/**
 * @file Entitlements: which modules and tools a licence turns on.
 *
 * Decided 09/09: ONE installer contains every module; the licence decides which are enabled.
 * The "separate packages" a customer perceives live in the licence, not in the installer.
 *
 * Important rule (part 17): the licence is verified on the SERVER, never on the customer's
 * machine. Any licence check inside the app is defeated within an hour. This file describes the
 * entitlement shape and the pure functions the brain uses to decide; the deciding party is the
 * brain, not the console.
 */

import type { MachineId, TenantId } from "./ids";
import { MODULES, CORE_MODULE_IDS, type ModuleId, isModuleId } from "./modules";
import { TOOLS, TOOL_NAMES, type ToolName } from "./tools";

/** The entitlement payload a licence carries. */
export interface LicensePayload {
  tenant: TenantId;
  /** Merchant name, for display in the console. */
  tenantName: string;
  machine: MachineId;
  /** Industry pack this merchant uses. Selling by industry means the licence must say which. */
  packId: string;
  /** Enabled modules. The three core modules are always added whether declared or not. */
  modules: ModuleId[];
  /** Maximum staff accounts. 0 = unlimited. */
  seats: number;
  /** Expiry, ISO. After that the brain stops serving. */
  expiresAt: string;
  /** Minimum contract version the console must meet, to refuse builds that are too old. */
  minContract: string;
  issuedAt: string;
}

/**
 * Canonical serialisation for signing and verification. Both sides must use EXACTLY this:
 * keys sorted ascending, no whitespace, `modules` sorted so that declaration order does not
 * change the signature.
 */
export function canonicalLicenseJSON(payload: LicensePayload): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    ordered[key] = (payload as unknown as Record<string, unknown>)[key];
  }
  if (Array.isArray(ordered["modules"])) {
    ordered["modules"] = [...(ordered["modules"] as string[])].sort();
  }
  return JSON.stringify(ordered);
}

export interface LicenseIssue {
  kind: "unknown_module" | "expired" | "not_yet_valid" | "bad_date";
  detail: string;
}

/**
 * Inspects a licence before use. Unknown module ids used to be SWALLOWED silently: a customer
 * paid for shipping, one letter was mistyped in the licence, and the bot quietly lacked the
 * tracking tool with nobody knowing why.
 */
export function licenseIssues(license: LicensePayload, now: Date = new Date()): LicenseIssue[] {
  const out: LicenseIssue[] = [];
  for (const id of license.modules) {
    if (!isModuleId(id)) out.push({ kind: "unknown_module", detail: String(id) });
  }
  const expires = Date.parse(license.expiresAt);
  const issued = Date.parse(license.issuedAt);
  if (!Number.isFinite(expires)) out.push({ kind: "bad_date", detail: `expiresAt="${license.expiresAt}"` });
  else if (expires <= now.getTime()) out.push({ kind: "expired", detail: license.expiresAt });
  if (!Number.isFinite(issued)) out.push({ kind: "bad_date", detail: `issuedAt="${license.issuedAt}"` });
  else if (issued > now.getTime()) out.push({ kind: "not_yet_valid", detail: license.issuedAt });
  return out;
}

export function isExpired(license: LicensePayload, now: Date = new Date()): boolean {
  const t = Date.parse(license.expiresAt);
  return !Number.isFinite(t) || t <= now.getTime();
}

/** Modules actually enabled: those declared, plus the core modules. */
export function enabledModules(license: LicensePayload): ModuleId[] {
  const set = new Set<ModuleId>(CORE_MODULE_IDS);
  for (const id of license.modules) {
    if (isModuleId(id)) set.add(id);
  }
  return [...set];
}

export function isModuleEnabled(license: LicensePayload, id: ModuleId): boolean {
  return MODULES[id].core || license.modules.includes(id);
}

/**
 * BOT tools callable under this licence.
 *
 * Two rules live here:
 *  - a disabled module's tools DO NOT EXIST for the bot (trap number 3 of the specification);
 *  - an expired licence yields NOTHING, so "the brain refuses to serve after the subscription
 *    ends". An earlier version ignored expiry and a licence expired since 2020 still had full tools.
 */
export function enabledTools(license: LicensePayload, now: Date = new Date()): ToolName[] {
  if (isExpired(license, now)) return [];
  const on = new Set<ModuleId>(enabledModules(license));
  return TOOL_NAMES.filter((name) => TOOLS[name].audience === "bot" && on.has(TOOLS[name].module));
}
