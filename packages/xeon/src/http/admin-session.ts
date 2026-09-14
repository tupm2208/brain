/**
 * @file Administrator session: an HMAC-signed, HttpOnly, SameSite=Strict cookie living 12 hours.
 */

import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { Clock } from "../support/clock";
import { parseCookies } from "./http-utils";

export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_COOKIE = "xeon_qt";

export interface AdminSessionOptions {
  /** Secret used to sign the cookie. A random one is generated when absent (restart = logout). */
  secret?: string | undefined;
  clock: Clock;
  /** Cookie carries the `Secure` flag when Xeon sits behind HTTPS. */
  secure?: boolean | undefined;
  /** Cookie path; defaults to the admin page prefix. */
  cookiePath?: string | undefined;
}

export class AdminSessionManager {
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly secure: boolean;
  private readonly cookiePath: string;

  constructor(options: AdminSessionOptions) {
    this.secret = options.secret || crypto.randomBytes(32).toString("base64url");
    this.clock = options.clock;
    this.secure = options.secure === true;
    this.cookiePath = options.cookiePath ?? "/quan-tri";
  }

  /** A fresh signed session token. */
  issue(): string {
    const now = this.clock.now().getTime();
    const body = Buffer.from(JSON.stringify({ phatLuc: now, hetLuc: now + ADMIN_SESSION_TTL_MS }), "utf8").toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  /** Whether the request carries a valid, unexpired session cookie. */
  isValid(req: IncomingMessage): boolean {
    const cookie = parseCookies(req)[ADMIN_COOKIE];
    if (!cookie) return false;
    const dot = cookie.lastIndexOf(".");
    if (dot <= 0) return false;
    const body = cookie.slice(0, dot);
    if (!constantTimeEqual(cookie.slice(dot + 1), this.sign(body))) return false;
    try {
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { hetLuc?: unknown };
      return typeof parsed.hetLuc === "number" && Number.isFinite(parsed.hetLuc) && this.clock.now().getTime() < parsed.hetLuc;
    } catch {
      return false;
    }
  }

  /** `Set-Cookie` value that installs the session. */
  cookieFor(token: string): string {
    return this.cookie(token, Math.floor(ADMIN_SESSION_TTL_MS / 1000));
  }

  /** `Set-Cookie` value that removes the session. */
  clearingCookie(): string {
    return this.cookie("", 0);
  }

  private cookie(value: string, maxAge: number): string {
    const parts = [`${ADMIN_COOKIE}=${value}`, `Path=${this.cookiePath}`, "HttpOnly", "SameSite=Strict"];
    if (this.secure) parts.push("Secure");
    parts.push(`Max-Age=${maxAge}`);
    return parts.join("; ");
  }

  private sign(body: string): string {
    return crypto.createHmac("sha256", this.secret).update(body, "utf8").digest("base64url");
  }
}
