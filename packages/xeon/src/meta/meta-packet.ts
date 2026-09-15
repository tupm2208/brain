/**
 * @file Meta's webhook packet on Xeon: the signature check and the split by Fanpage.
 *
 * One developer app serves every merchant (decided 15/09/2026), so Meta calls ONE address for all
 * of their pages, and one packet may carry entries of several pages. Each entry belongs to the
 * merchant that connected that page; this file only splits, `MetaController` routes.
 */

import crypto from "node:crypto";

/** A packet in Meta's own shape, narrowed to the entries of some pages. */
export interface PagePacket {
  object: "page";
  entry: Record<string, unknown>[];
}

/**
 * Checks `X-Hub-Signature-256` over the RAW BYTES — parsing and re-serialising changes bytes, and
 * the signature would never match.
 */
export function verifyMetaSignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
  const s = String(signature ?? "").trim();
  if (!s.startsWith("sha256=") || !appSecret) return false;
  const received = Buffer.from(s.slice("sha256=".length), "hex");
  const computed = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(received, computed);
}

/** Entries grouped by page id, each group a packet of its own. `null` when it is not a page packet at all. */
export function splitByPage(payload: unknown): Map<string, PagePacket> | null {
  if (payload === null || typeof payload !== "object" || (payload as { object?: unknown }).object !== "page") return null;
  const entries = (payload as { entry?: unknown }).entry;
  const out = new Map<string, PagePacket>();
  for (const raw of Array.isArray(entries) ? entries : []) {
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const pageId = String(entry["id"] ?? "").trim();
    if (!pageId) continue;
    const packet = out.get(pageId) ?? { object: "page" as const, entry: [] };
    packet.entry.push(entry);
    out.set(pageId, packet);
  }
  return out;
}
