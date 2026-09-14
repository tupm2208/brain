/**
 * @file Sliding-window rate limiter kept in memory. Enough for one Xeon; no Redis needed.
 */

import type { Clock } from "../support/clock";

export interface RateLimitOptions {
  /** Calls allowed per key within the window. */
  limit: number;
  windowMs: number;
  clock: Clock;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  /** Bound on tracked keys so a scan of random addresses cannot grow memory without limit. */
  private static readonly MAX_KEYS = 10_000;

  constructor(private readonly options: RateLimitOptions) {}

  /** Records a call for `key` and returns whether it is within the limit. */
  allow(key: string): boolean {
    const now = this.options.clock.now().getTime();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.options.windowMs);
    if (recent.length >= this.options.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > SlidingWindowRateLimiter.MAX_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    return true;
  }
}
