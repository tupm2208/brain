/**
 * @file Typed access to the SHARED machine-ticket kit (`chung/ve-may.js`).
 *
 * The kit is plain JavaScript living outside this package because the merchant server verifies
 * tickets with the very same file. Xeon signs with it; the landing verifies with it; the ticket
 * shape therefore exists in exactly one place. This module only adds TypeScript types.
 */

import { createRequire } from "node:module";

/** Roles a ticket can carry: the merchant's console, or the brain itself. */
export type TicketRole = "quan-tri" | "dich-vu";

/** Signed body of a machine ticket. Field names are the wire format shared with the landing. */
export interface TicketBody {
  v: 1;
  vai: TicketRole;
  shop: string;
  tenShop: string;
  maMay: string;
  tenMay: string;
  manh: string[];
  truc: boolean;
  phatLuc: number;
  hetLuc: number;
  keyId: string;
}

/** Input to `signTicket`: the body without the version and key id, which the kit adds. */
export type TicketClaims = Omit<TicketBody, "v" | "keyId">;

export interface SigningKeyPair {
  khoaRiengPem: string;
  khoaCongPem: string;
  keyId: string;
}

export type TicketVerification =
  | { hopLe: true; than: TicketBody }
  | { hopLe: false; viSao: string };

interface SharedTicketKit {
  TIEN_TO: string;
  VAI: readonly string[];
  LECH_GIO_CHO_PHEP_MS: number;
  sinhKhoaKy(): SigningKeyPair;
  keyIdCuaKhoaCong(publicKeyPem: string): string;
  kyChuoi(privateKeyPem: string, text: string): string;
  kiemChuKy(publicKeyPem: string, text: string, signatureB64url: string): boolean;
  chuoiChuan(body: object): string;
  kyVe(claims: TicketClaims, key: { khoaRiengPem: string; keyId: string }): string;
  docVe(ticket: string, options: { khoaCongTheoKeyId: (keyId: string) => string | null; bayGio: Date }): TicketVerification;
  laVe(value: string): boolean;
}

const requireShared = createRequire(__filename);
// From `packages/xeon/dist/support/` up to the repo root `bo-nao/`, then `kit/ve-may.js` — a byte-identical
// copy of `chung/ve-may.js` kept inside this repo, because Xeon deploys on its own.
const kit: SharedTicketKit = requireShared("../../../../kit/ve-may.js");

export const TICKET_PREFIX: string = kit.TIEN_TO;
export const CLOCK_SKEW_TOLERANCE_MS: number = kit.LECH_GIO_CHO_PHEP_MS;

/** Generates a new Ed25519 signing key pair with its stable key id. */
export function generateSigningKey(): SigningKeyPair {
  return kit.sinhKhoaKy();
}

/** Stable identifier of a public key: `ky-` + 16 base64url characters of SHA-256(SPKI). */
export function keyIdOfPublicKey(publicKeyPem: string): string {
  return kit.keyIdCuaKhoaCong(publicKeyPem);
}

/** Signs a UTF-8 string; returns base64url. */
export function signText(privateKeyPem: string, text: string): string {
  return kit.kyChuoi(privateKeyPem, text);
}

/** Verifies a signature. A broken key or signature is FALSE, never an exception. */
export function verifyText(publicKeyPem: string, text: string, signatureB64url: string): boolean {
  return kit.kiemChuKy(publicKeyPem, text, signatureB64url);
}

/** Signs a machine ticket. Throws on a malformed body; signing garbage is a programming error. */
export function signTicket(claims: TicketClaims, key: { khoaRiengPem: string; keyId: string }): string {
  return kit.kyVe(claims, key);
}

/** Parses and verifies a ticket. Never throws; an invalid ticket is a normal event at a door. */
export function verifyTicket(
  ticket: string,
  options: { publicKeyForKeyId: (keyId: string) => string | null; now: Date }
): TicketVerification {
  return kit.docVe(ticket, { khoaCongTheoKeyId: options.publicKeyForKeyId, bayGio: options.now });
}

/** Whether a string looks like a ticket (as opposed to a long-lived token). */
export function looksLikeTicket(value: string): boolean {
  return kit.laVe(value);
}
