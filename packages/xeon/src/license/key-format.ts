/**
 * @file Licence key format and small value helpers.
 *
 * A key is a random string that is easy to read out loud: `TR-XXXX-XXXX-XXXX-XXXX`, without
 * 0/O/1/I. Keys are NOT signed: Xeon is the verifier, and signatures are only needed for TICKETS,
 * which the landing must verify without asking Xeon.
 */

import crypto from "node:crypto";

/** Alphabet without look-alike characters. */
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const LICENSE_KEY_PATTERN = /^TR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const SHOP_CODE_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
export const MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Generates a fresh licence key. */
export function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(16);
  const chars = [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join("");
  return `TR-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

/** Upper-cases and strips whitespace so keys typed by hand still match. */
export function normalizeLicenseKey(key: unknown): string {
  return String(key ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Timing-safe string equality, for tokens and passwords. */
export function constantTimeEqual(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Whether the value is an http(s) origin with nothing after the host (no path, query or hash). */
export function isValidOrigin(value: unknown): boolean {
  try {
    const url = new URL(String(value ?? ""));
    return (url.protocol === "http:" || url.protocol === "https:") && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Short display id of a machine: a hash of the machine id, stable, never revealing the id itself.
 * Shown on the admin and machine pages so a machine can be named without leaking its identifier.
 */
export function machineDisplayId(machineId: string): string {
  return crypto.createHash("sha256").update(String(machineId), "utf8").digest("base64url").slice(0, 10);
}

/** Random private token given to a landing at registration; identifies the merchant on `/tin-den`. */
export function generateInboxToken(): string {
  return `nt-${crypto.randomBytes(24).toString("base64url")}`;
}
