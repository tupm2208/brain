/**
 * @file VIDEO STUDIO TICKETS — how OMI opens Video Studio in its own window (Đ9).
 *
 * Sales Desk embedded the studio in an iframe behind its own admin login. OMI has no login of its
 * own and the studio is a separate service on Xeon, so the door is a SHORT-LIVED TICKET signed with
 * Xeon's licence key: OMI → landing → Xeon `POST /video/ve` → `VS1.<body>.<signature>` → OMI opens
 * `<studio>/video-studio/?ve=…` in a window → the studio verifies with Xeon's PUBLIC key, trades the
 * ticket for a session cookie, and never sees a licence key or a machine ticket.
 *
 * Five minutes and one use: a ticket leaked from a window title or a log is worthless by the time
 * anyone reads it.
 */

import crypto from "node:crypto";
import { verifyText } from "../support/ticket-kit";

export const STUDIO_TICKET_PREFIX = "VS1.";
export const STUDIO_TICKET_TTL_MS = 5 * 60 * 1000;
export const STUDIO_PURPOSE = "video-studio";

export interface StudioTicketBody {
  v: 1;
  muc: typeof STUDIO_PURPOSE;
  shop: string;
  tenShop: string;
  phatLuc: number;
  hetLuc: number;
  nonce: string;
  keyId: string;
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

/** Signs a studio ticket. `sign` is the licence service's detached signer: the private key stays there. */
export function issueStudioTicket(input: { shop: string; tenShop?: string; now: Date; sign: (text: string) => { keyId: string; chuKy: string }; keyId: string }): { ve: string; hetLuc: number } {
  const phatLuc = input.now.getTime();
  const body: StudioTicketBody = {
    v: 1, muc: STUDIO_PURPOSE, shop: input.shop, tenShop: input.tenShop ?? "", phatLuc, hetLuc: phatLuc + STUDIO_TICKET_TTL_MS,
    nonce: crypto.randomBytes(9).toString("base64url"), keyId: input.keyId
  };
  const payload = b64(JSON.stringify(body));
  const signed = input.sign(`${STUDIO_TICKET_PREFIX}${payload}`);
  return { ve: `${STUDIO_TICKET_PREFIX}${payload}.${signed.chuKy}`, hetLuc: body.hetLuc };
}

export type StudioTicketCheck = { ok: true; body: StudioTicketBody } | { ok: false; viSao: string };

/** Verifies a studio ticket. Never throws: a bad ticket is an ordinary event at a door. */
export function verifyStudioTicket(ticket: string, options: { publicKeyForKeyId: (keyId: string) => string | null; now: Date; skewMs?: number }): StudioTicketCheck {
  const value = String(ticket ?? "").trim();
  if (!value.startsWith(STUDIO_TICKET_PREFIX) || value.length > 4000) return { ok: false, viSao: "khong_phai_ve" };
  const rest = value.slice(STUDIO_TICKET_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return { ok: false, viSao: "ve_hong" };
  const payload = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  let body: StudioTicketBody;
  try { body = JSON.parse(unb64(payload)) as StudioTicketBody; } catch { return { ok: false, viSao: "ve_hong" }; }
  if (body?.v !== 1 || body.muc !== STUDIO_PURPOSE || typeof body.shop !== "string" || body.shop === "") return { ok: false, viSao: "ve_sai_muc_dich" };
  const pem = options.publicKeyForKeyId(String(body.keyId ?? ""));
  if (!pem) return { ok: false, viSao: "khoa_khong_biet" };
  if (!verifyText(pem, `${STUDIO_TICKET_PREFIX}${payload}`, signature)) return { ok: false, viSao: "sai_chu_ky" };
  const now = options.now.getTime();
  const skew = options.skewMs ?? 60_000;
  if (Number(body.hetLuc) < now) return { ok: false, viSao: "ve_het_han" };
  if (Number(body.phatLuc) > now + skew) return { ok: false, viSao: "ve_tu_tuong_lai" };
  return { ok: true, body };
}
