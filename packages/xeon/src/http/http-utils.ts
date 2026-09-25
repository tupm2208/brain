/**
 * @file Small HTTP helpers shared by the controllers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** Maximum request body accepted, in bytes. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Writes a JSON response with the security headers every Xeon reply carries. */
export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(text);
}

class BodyTooLargeError extends Error {
  readonly tooLarge = true;
}

/** Reads the raw body (at most `MAX_BODY_BYTES`). Signatures such as Meta's are computed over these bytes. */
export function readRawBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new BodyTooLargeError("body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Reads a JSON object body. On a malformed or oversized body the error response is written and
 * `null` is returned, so callers simply stop.
 */
export async function readJsonObject(req: IncomingMessage, res: ServerResponse, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readRawBody(req, maxBytes);
    const parsed: unknown = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    const tooLarge = error instanceof BodyTooLargeError;
    sendJson(res, tooLarge ? 413 : 400, { ok: false, error: "than_khong_hop_le" });
    return null;
  }
}

/** The bearer token of the request, or an empty string. */
export function bearerToken(req: IncomingMessage): string {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

/** Client address, honouring `X-Forwarded-For` only when a trusted proxy sits in front. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() ?? "";
    if (forwarded) return forwarded;
  }
  return String(req.socket?.remoteAddress || "");
}

/** Parses the `Cookie` header into a map. */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** What every controller receives about the current request. */
export interface RequestContext {
  method: string;
  /** Path without query string. */
  path: string;
  ip: string;
  /** Reads the JSON body; writes the error response and returns `null` when invalid. */
  readJson(maxBytes?: number): Promise<Record<string, unknown> | null>;
  /** MÃ VẾT of this request — taken from `x-ma-vet` or minted by the server. */
  maVet?: string | undefined;
  /**
   * Which merchant this request turned out to belong to. A controller sets it once it knows —
   * derived from the token, never read from the body. The activity log reads it afterwards so one
   * merchant's flood cannot spend the shared buffer (21/09/2026).
   */
  shop?: string | undefined;
}

/**
 * Chain-of-responsibility link: returns `true` when the request was handled, `false` to pass it
 * to the next controller.
 */
export interface RequestController {
  handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean>;
}
