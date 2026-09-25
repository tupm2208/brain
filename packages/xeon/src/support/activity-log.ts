/**
 * @file In-memory ring buffer that records every interesting thing Xeon does: webhooks received,
 * messages processed, outbound calls to landings, licence checks.
 *
 * The buffer holds up to `capacity` entries (default 500). When full, the oldest entry is dropped.
 * Nothing is written to disk — the log is meant for live debugging and disappears on restart.
 *
 * Every component that wants to log receives the same `ActivityLog` instance from `app.ts`.
 */

import type { Clock } from "./clock";

/** Direction of the logged event. */
export type ActivityDirection = "in" | "out" | "internal";

/** Broad category so the viewer can filter. */
export type ActivityKind =
  | "meta-webhook"   // POST /meta/webhook from Meta
  | "tin-den"        // POST /tin-den from a landing
  | "meta-chuyen"    // forwarding a Meta packet to a landing
  | "meta-retry"     // retrying a pending Meta packet
  | "goi-landing"    // any outbound call to a landing (tool, memory, reply, …)
  | "license"        // licence check / duty / leave / register
  | "viet-bai"       // POST /viet-bai
  | "admin"          // admin API calls
  | "http";          // catch-all for any other request

export interface ActivityEntry {
  /** Monotonic sequence number (1-based). */
  stt: number;
  /** ISO 8601 timestamp. */
  luc: string;
  /** In / out / internal. */
  huong: ActivityDirection;
  /** Event category. */
  loai: ActivityKind;
  /** HTTP method (when applicable). */
  method?: string;
  /** Path or destination URL. */
  duong?: string;
  /** The merchant this event belongs to, when known. */
  shop?: string;
  /** HTTP status code of the response. */
  status?: number;
  /** Wall-clock milliseconds the operation took. */
  ms?: number;
  /** One-line human-readable summary (Vietnamese is fine). */
  tomTat?: string;
  /** Truncated body / payload for deeper debugging. */
  chiTiet?: unknown;
  /** MÃ VẾT: the same id on both sides of a call, so one incident is one search (21/09/2026). */
  vet?: string;
}

export const DEFAULT_CAPACITY = 500;
/** Individual `chiTiet` values are truncated to this many characters. */
export const DETAIL_MAX_CHARS = 2_000;
/**
 * Entries ONE merchant may record per minute. Past it its entries are dropped and a single line
 * says how many — one landing in a retry storm must not spend the whole buffer (21/09/2026).
 */
export const DEFAULT_SHOP_RATE_PER_MINUTE = 240;
/** Entries with no merchant (health, admin, unknown routes) share this bucket. */
const NO_SHOP = "\u0000khong-shop";
const MINUTE_MS = 60_000;

interface ShopRate {
  windowStart: number;
  count: number;
  dropped: number;
}

export class ActivityLog {
  private readonly buffer: ActivityEntry[] = [];
  private readonly capacity: number;
  private readonly clock: Clock;
  private readonly ratePerMinute: number;
  /** How many entries each merchant currently holds in the buffer — used for fair eviction. */
  private readonly held = new Map<string, number>();
  private readonly rates = new Map<string, ShopRate>();
  private seq = 0;

  constructor(options: { capacity?: number; clock: Clock; ratePerMinute?: number }) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.clock = options.clock;
    this.ratePerMinute = options.ratePerMinute ?? DEFAULT_SHOP_RATE_PER_MINUTE;
  }

  /**
   * Records one event. Returns the entry, or `null` when the merchant is over its rate and the
   * entry was dropped.
   *
   * ONE XEON SERVES MANY MERCHANTS, so the buffer is shared but NOT first-come-first-served: a
   * merchant having a bad hour used to push every other merchant's evidence out within seconds.
   * Two guards now: a per-merchant rate, and eviction that takes from whoever holds the most.
   */
  add(fields: Omit<ActivityEntry, "stt" | "luc">): ActivityEntry | null {
    const now = this.clock.now();
    const key = fields.shop ?? NO_SHOP;
    const dropped = this.overRate(key, now.getTime());
    if (dropped !== null) {
      // Say it once per window, then stay quiet: the note must not itself become the flood.
      if (dropped === 1) this.push({ stt: ++this.seq, luc: now.toISOString(), huong: "internal", loai: "http", ...(fields.shop !== undefined ? { shop: fields.shop } : {}), tomTat: `vượt mức ${this.ratePerMinute} mục/phút — đang bỏ bớt mục của shop này` });
      return null;
    }
    const entry: ActivityEntry = {
      stt: ++this.seq,
      luc: now.toISOString(),
      ...fields,
    };
    if (entry.chiTiet !== undefined) {
      entry.chiTiet = truncateDetail(entry.chiTiet);
    }
    this.push(entry);
    return entry;
  }

  /** Whether this merchant has spent its minute. Returns the running dropped count, or `null`. */
  private overRate(key: string, nowMs: number): number | null {
    const rate = this.rates.get(key);
    if (rate === undefined || nowMs - rate.windowStart >= MINUTE_MS) {
      this.rates.set(key, { windowStart: nowMs, count: 1, dropped: 0 });
      return null;
    }
    if (rate.count < this.ratePerMinute) { rate.count += 1; return null; }
    rate.dropped += 1;
    return rate.dropped;
  }

  /** Appends, then makes room by taking from whoever currently holds the most. */
  private push(entry: ActivityEntry): void {
    this.buffer.push(entry);
    this.held.set(entry.shop ?? NO_SHOP, (this.held.get(entry.shop ?? NO_SHOP) ?? 0) + 1);
    while (this.buffer.length > this.capacity) this.evictFromLargest();
  }

  /**
   * Drops the oldest entry of the merchant holding the most of the buffer — NOT the globally
   * oldest. With many landings, plain FIFO means the noisiest shop silently erases every other
   * shop's evidence, which is the opposite of what the buffer is for.
   */
  private evictFromLargest(): void {
    let biggest = NO_SHOP;
    let most = -1;
    for (const [key, count] of this.held) if (count > most) { most = count; biggest = key; }
    const at = this.buffer.findIndex((e) => (e.shop ?? NO_SHOP) === biggest);
    const index = at < 0 ? 0 : at;
    const [gone] = this.buffer.splice(index, 1);
    if (gone === undefined) return;
    const key = gone.shop ?? NO_SHOP;
    const left = (this.held.get(key) ?? 1) - 1;
    if (left <= 0) this.held.delete(key); else this.held.set(key, left);
  }

  /**
   * Returns the most recent entries, newest first.
   *
   * @param n      How many entries (default: all).
   * @param loai   Comma-separated kinds to include (default: all).
   * @param since  Only entries with `stt` strictly greater than this.
   * @param shop   Only one merchant's entries.
   */
  recent(options: { n?: number; loai?: string; since?: number; shop?: string } = {}): ActivityEntry[] {
    let list = [...this.buffer];
    if (options.since !== undefined && options.since > 0) {
      list = list.filter((e) => e.stt > options.since!);
    }
    if (options.loai) {
      const kinds = new Set(options.loai.split(",").map((s) => s.trim()).filter(Boolean));
      if (kinds.size > 0) list = list.filter((e) => kinds.has(e.loai));
    }
    if (options.shop) list = list.filter((e) => e.shop === options.shop);
    list.reverse();
    if (options.n !== undefined && options.n > 0) list = list.slice(0, options.n);
    return list;
  }

  /** How much of the buffer each merchant holds, biggest first — the fleet view's raw material. */
  holdings(): { shop: string; muc: number }[] {
    return [...this.held.entries()]
      .map(([shop, muc]) => ({ shop: shop === NO_SHOP ? "" : shop, muc }))
      .sort((a, b) => b.muc - a.muc);
  }

  /** Total events recorded since start (including those that rolled out of the buffer). */
  totalCount(): number {
    return this.seq;
  }

  /** Current buffer size. */
  size(): number {
    return this.buffer.length;
  }
}

// ---------------------------------------------------------------- helpers

function truncateDetail(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= DETAIL_MAX_CHARS) return value;
  return text.slice(0, DETAIL_MAX_CHARS) + `…(cắt ${text.length - DETAIL_MAX_CHARS} ký tự)`;
}
