/**
 * @file Pages that stay with an older inbox while sharing Xeon's Meta app (decided 28/09/2026).
 *
 * OMI moved onto the TopRun Sales Desk app so a merchant's Facebook account can grant page
 * permissions (that app is live and reviewed). Meta allows ONE webhook address per app, so the
 * address is Xeon's — and TopRun's own pages, which Sales Desk still answers, must keep reaching
 * `toprun.site/api/facebook/webhook` exactly as before.
 *
 * Only the listed pages' entries leave, re-signed with the SAME app secret Meta uses: the old inbox
 * stores the body and signature, Sales Desk checks the signature when it consumes them, and another
 * merchant's entries never ride along in the same packet.
 */

import crypto from "node:crypto";
import type { FetchLike } from "../gateway/landing-gateway";
import type { PagePacket } from "./meta-packet";

export interface MetaPassthroughOptions {
  /** Full webhook address of the old inbox, for example "https://toprun.site/api/facebook/webhook". */
  url: string;
  /** Page ids routed there instead of to a merchant's landing. */
  pages: string[];
  appSecret: string;
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

export interface PassResult { ok: boolean; status: number; message: string }

export class MetaPassthrough {
  private readonly pages: Set<string>;
  private readonly fetch: FetchLike;

  constructor(private readonly options: MetaPassthroughOptions) {
    this.pages = new Set(options.pages.map((p) => p.trim()).filter(Boolean));
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  /** Configured with an address, at least one page and the app secret to sign with. */
  get enabled(): boolean {
    return this.options.url !== "" && this.pages.size > 0 && this.options.appSecret !== "";
  }

  owns(pageId: string): boolean {
    return this.enabled && this.pages.has(pageId);
  }

  /** Sends one packet, signed the way Meta signs: `sha256=` + HMAC-SHA256(app secret, exact body). */
  async send(packet: PagePacket): Promise<PassResult> {
    const body = JSON.stringify(packet);
    const signature = `sha256=${crypto.createHmac("sha256", this.options.appSecret).update(body, "utf8").digest("hex")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const r = await this.fetch(this.options.url, {
        method: "POST", signal: controller.signal, body,
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }
      });
      return { ok: r.ok, status: r.status, message: r.ok ? "" : `HTTP ${r.status}` };
    } catch (error) {
      return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}
