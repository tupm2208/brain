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
}

export const DEFAULT_CAPACITY = 500;
/** Individual `chiTiet` values are truncated to this many characters. */
export const DETAIL_MAX_CHARS = 2_000;

export class ActivityLog {
  private readonly buffer: ActivityEntry[] = [];
  private readonly capacity: number;
  private readonly clock: Clock;
  private seq = 0;

  constructor(options: { capacity?: number; clock: Clock }) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.clock = options.clock;
  }

  /** Records one event. Returns the entry (useful for setting `status` / `ms` after the fact). */
  add(fields: Omit<ActivityEntry, "stt" | "luc">): ActivityEntry {
    const entry: ActivityEntry = {
      stt: ++this.seq,
      luc: this.clock.now().toISOString(),
      ...fields,
    };
    if (entry.chiTiet !== undefined) {
      entry.chiTiet = truncateDetail(entry.chiTiet);
    }
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    return entry;
  }

  /**
   * Returns the most recent entries, newest first.
   *
   * @param n      How many entries (default: all).
   * @param loai   Comma-separated kinds to include (default: all).
   * @param since  Only entries with `stt` strictly greater than this.
   */
  recent(options: { n?: number; loai?: string; since?: number } = {}): ActivityEntry[] {
    let list = [...this.buffer];
    if (options.since !== undefined && options.since > 0) {
      list = list.filter((e) => e.stt > options.since!);
    }
    if (options.loai) {
      const kinds = new Set(options.loai.split(",").map((s) => s.trim()).filter(Boolean));
      if (kinds.size > 0) list = list.filter((e) => kinds.has(e.loai));
    }
    list.reverse();
    if (options.n !== undefined && options.n > 0) list = list.slice(0, options.n);
    return list;
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
