/**
 * @file Knocks on the image tool's door when there is work.
 *
 * Decided 21/09/2026: Xeon talks to the image tool, not the other way round, because Xeon already
 * holds the authentication with every landing. The tool sits behind a Cloudflare tunnel at
 * `imagetool.elevenvoice.site`; this class is the only thing on Xeon that calls it.
 *
 * The push is a KNOCK, not the work order. The tool answers `202` immediately and then claims the
 * job through `/image-worker/nhan` like before, so the lease — the thing that stops two machines
 * scraping the same code — keeps living in one place, here.
 *
 * That makes a lost knock harmless rather than fatal: the job stays `waiting` in the queue, and
 * `sweep()` knocks again a minute later. Without the sweep, one dropped call during a tunnel
 * restart would strand a code until somebody happened to enqueue another one.
 */

import type { ImageJobQueue } from "./image-job-queue";
import type { Logger } from "../support/logger";

/** The subset of `fetch` we need; tests inject a fake. */
export type ImageToolFetch = (url: string, init: {
  method: string;
  signal: AbortSignal;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number }>;

export interface ImageToolDispatcherOptions {
  /** Origin of the tool, for example "https://imagetool.elevenvoice.site". Empty = disabled. */
  url: string;
  /** The key the tool checks. Empty = disabled: an unguarded door is worse than no door. */
  key: string;
  queue: ImageJobQueue;
  logger: Logger;
  fetch?: ImageToolFetch | undefined;
  timeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class ImageToolDispatcher {
  private readonly url: string;
  private readonly key: string;
  private readonly queue: ImageJobQueue;
  private readonly logger: Logger;
  private readonly send: ImageToolFetch;
  private readonly timeoutMs: number;
  private quietUntil = 0;

  constructor(options: ImageToolDispatcherOptions) {
    this.url = options.url.trim().replace(/\/+$/, "");
    this.key = options.key.trim();
    this.queue = options.queue;
    this.logger = options.logger;
    this.send = options.fetch ?? ((url, init) => fetch(url, init as RequestInit));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Both an address and a key, or we are off. Half-configured must not look like working. */
  ready(): boolean { return this.url !== "" && this.key !== ""; }

  /** Knock for one code. Never throws: a failed knock is a warning, not a lost job. */
  async knock(code: string): Promise<boolean> {
    if (!this.ready()) return false;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), this.timeoutMs);
    try {
      const reply = await this.send(`${this.url}/jobs`, {
        method: "POST",
        signal: stop.signal,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      if (!reply.ok) { this.warn(`[image-tool] ${this.url} tra HTTP ${reply.status} cho ma ${code}`); return false; }
      return true;
    } catch (error) {
      this.warn(`[image-tool] khong goi duoc ${this.url}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Knock once if anything is waiting. Runs on a timer, and after every enqueue.
   *
   * One knock covers the whole queue because the tool drains until Xeon says empty, so there is no
   * point sending one call per code — and doing so would mean a thousand calls when a shop loads
   * its catalogue.
   */
  async sweep(): Promise<boolean> {
    if (!this.ready()) return false;
    const waiting = this.queue.control().waiting;
    if (waiting === 0) return false;
    return this.knock(`${waiting} ma dang cho`);
  }

  /** One warning a minute: a tunnel that is down would otherwise fill the log every sweep. */
  private warn(message: string): void {
    const now = Date.now();
    if (now < this.quietUntil) return;
    this.quietUntil = now + 60_000;
    this.logger.warn(message);
  }
}
