/**
 * @file Meta's `signed_request`: the body of the Data Deletion callback and of the Deauthorize
 * callback of the developer app (02/10/2026).
 *
 * Shape: `<b64url(signature)>.<b64url(payload)>`, the signature being HMAC-SHA256 of the payload
 * PART AS SENT (the base64url text, not the decoded JSON) under the app secret. The payload is JSON
 * `{ algorithm: "HMAC-SHA256", expires, issued_at, user_id }`, `user_id` being the person's
 * APP-SCOPED id.
 *
 * The signature is checked BEFORE the payload is decoded: nothing a stranger wrote is parsed. The
 * expiry is deliberately not enforced — Meta's own sample does not, and a replay can only repeat a
 * deletion that already happened (the erase is idempotent).
 */

import crypto from "node:crypto";

/** Longest `signed_request` accepted, in characters. Meta's are a few hundred. */
export const SIGNED_REQUEST_MAX_CHARS = 8 * 1024;
/** Largest callback body read, in bytes. */
export const SIGNED_REQUEST_BODY_MAX_BYTES = 16 * 1024;
/** The only algorithm Meta signs with. */
export const SIGNED_REQUEST_ALGORITHM = "HMAC-SHA256";

/** What a verified request says. */
export interface SignedRequestPayload {
  /** The person's app-scoped id. Never stored or logged as is — see `MetaAppUserBook.keyOf`. */
  userId: string;
  /** Seconds since the epoch, when Meta sent it; `null` when absent. */
  issuedAt: number | null;
  /** Seconds since the epoch; `null` when absent (Meta often sends 0). */
  expires: number | null;
}

export type SignedRequestFailure =
  | "chua_cau_hinh"
  | "thieu_signed_request"
  | "qua_dai"
  | "sai_dinh_dang"
  | "sai_chu_ky"
  | "sai_thuat_toan"
  | "thieu_user_id";

export type SignedRequestResult = { ok: true; value: SignedRequestPayload } | { ok: false; viSao: SignedRequestFailure };

/** base64url (Meta) or base64, optional padding — anything else is not one of Meta's parts. */
const BASE64_PART = /^[A-Za-z0-9_+/-]+={0,2}$/;
/** App-scoped ids are digits; letters, `_` and `-` are tolerated, length is bounded. */
const USER_ID = /^[0-9A-Za-z_-]{1,64}$/;

/**
 * The `signed_request` field of a callback body: form-encoded (what Meta sends) or JSON
 * `{ signed_request }` (tools, tests). `null` when the body carries none.
 */
export function signedRequestFromBody(raw: Buffer, contentType: string): string | null {
  const text = raw.toString("utf8").trim();
  if (text === "") return null;
  const looksJson = /application\/json/i.test(contentType) || text.startsWith("{");
  if (looksJson) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const value = (parsed as Record<string, unknown>)["signed_request"];
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text).get("signed_request");
}

/** Verifies a `signed_request` with the app secret and returns the person's app-scoped id. */
export function verifySignedRequest(signedRequest: string | null, appSecret: string): SignedRequestResult {
  if (!appSecret) return { ok: false, viSao: "chua_cau_hinh" };
  const text = String(signedRequest ?? "").trim();
  if (text === "") return { ok: false, viSao: "thieu_signed_request" };
  if (text.length > SIGNED_REQUEST_MAX_CHARS) return { ok: false, viSao: "qua_dai" };

  const parts = text.split(".");
  if (parts.length !== 2) return { ok: false, viSao: "sai_dinh_dang" };
  const [signaturePart, payloadPart] = parts as [string, string];
  if (!BASE64_PART.test(signaturePart) || !BASE64_PART.test(payloadPart)) return { ok: false, viSao: "sai_dinh_dang" };

  const received = Buffer.from(signaturePart, "base64url");
  const computed = crypto.createHmac("sha256", appSecret).update(payloadPart, "utf8").digest();
  // Length first: timingSafeEqual throws on unequal lengths, and a 31-byte "signature" is simply wrong.
  if (received.length !== computed.length || !crypto.timingSafeEqual(received, computed)) return { ok: false, viSao: "sai_chu_ky" };

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, viSao: "sai_dinh_dang" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, viSao: "sai_dinh_dang" };
  }
  if (String(payload["algorithm"] ?? "").toUpperCase() !== SIGNED_REQUEST_ALGORITHM) return { ok: false, viSao: "sai_thuat_toan" };

  const rawId = payload["user_id"];
  const userId = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  if (!USER_ID.test(userId)) return { ok: false, viSao: "thieu_user_id" };
  return { ok: true, value: { userId, issuedAt: secondsOrNull(payload["issued_at"]), expires: secondsOrNull(payload["expires"]) } };
}

/**
 * Builds a `signed_request` exactly as Meta does. For tests and for the operator's own checks —
 * Xeon never sends one.
 */
export function signRequest(payload: Record<string, unknown>, appSecret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signaturePart = crypto.createHmac("sha256", appSecret).update(payloadPart, "utf8").digest("base64url");
  return `${signaturePart}.${payloadPart}`;
}

function secondsOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
