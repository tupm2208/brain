/**
 * @file Where the landings' pushed log lines are kept on Xeon — ONE FOLDER PER MERCHANT.
 *
 *   <root>/<shop>/<ngày>.jsonl
 *
 * Per merchant for the same reason the activity buffer now shares out fairly: with many landings,
 * one shop in a retry storm must not cost the others their evidence. Here it is enforced by a
 * per-shop rate at the door and by files that cannot grow past a day.
 *
 * These lines are INFRASTRUCTURE, not conversations: paths, statuses, timings, trace ids. The
 * customer's words live in the turn dossier, which travels no further than Xeon's own disk.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { safeName } from "./disk-dossier-store";

/** Lines one merchant may push per minute before the rest are refused and counted. */
export const DEFAULT_PUSH_PER_MINUTE = 600;
export const DEFAULT_KEEP_DAYS = 14;
/** A batch larger than this is cut: a landing must not be able to post a book. */
export const MAX_BATCH = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

/** One line as the landing sent it. Unknown fields are kept: the landing may be newer than Xeon. */
export interface LandingLogLine {
  stt?: number;
  luc?: string;
  muc?: string;
  huong?: string;
  vet?: string;
  method?: string;
  duong?: string;
  status?: number;
  ms?: number;
  module?: string;
  tomTat?: string;
  [key: string]: unknown;
}

export interface AcceptResult {
  nhan: number;
  boQua: number;
}

export interface LandingLogStoreOptions {
  root: string;
  clock: Clock;
  logger: Logger;
  keepDays?: number | undefined;
  perMinute?: number | undefined;
}

export class LandingLogStore {
  private readonly root: string;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly keepDays: number;
  private readonly perMinute: number;
  private readonly rates = new Map<string, { windowStart: number; count: number }>();
  private sweptAt = 0;

  constructor(options: LandingLogStoreOptions) {
    this.root = options.root;
    this.clock = options.clock;
    this.logger = options.logger;
    this.keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
    this.perMinute = options.perMinute ?? DEFAULT_PUSH_PER_MINUTE;
  }

  fileFor(shop: string, at: Date): string {
    return path.join(this.root, safeName(shop), `${at.toISOString().slice(0, 10)}.jsonl`);
  }

  /**
   * Takes one batch. Returns how many were written and how many the rate refused — the landing is
   * told, so its own log can say "Xeon refused N" rather than silently losing them.
   */
  async accept(shop: string, lines: readonly LandingLogLine[], extra: { daBo?: number } = {}): Promise<AcceptResult> {
    const now = this.clock.now();
    const batch = lines.slice(0, MAX_BATCH);
    const allowed = this.allowance(shop, now.getTime());
    const taking = batch.slice(0, allowed);
    const skipped = (lines.length - taking.length) + (extra.daBo ?? 0);

    if (taking.length > 0) {
      const file = this.fileFor(shop, now);
      // `nhanLuc` is Xeon's own clock: a landing with a wrong clock must still be orderable.
      const text = taking.map((line) => JSON.stringify({ ...line, nhanLuc: now.toISOString() })).join("\n");
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, `${text}\n`, "utf8");
      } catch (error) {
        this.logger.warn(`[nhat-ky] khong ghi duoc nhat ky landing "${shop}": ${error instanceof Error ? error.message : String(error)}`);
        return { nhan: 0, boQua: lines.length + (extra.daBo ?? 0) };
      }
      // Quota is spent only on lines actually written: a failed disk must not also cost the
      // merchant its allowance for the minute.
      this.spend(shop, taking.length);
    }
    if (skipped > 0) this.logger.warn(`[nhat-ky] landing "${shop}" vuot muc — bo ${skipped} dong`);
    await this.sweepIfDue(now);
    return { nhan: taking.length, boQua: skipped };
  }

  /** How many more lines this merchant may write in the current minute. */
  private allowance(shop: string, nowMs: number): number {
    const rate = this.rates.get(shop);
    if (rate === undefined || nowMs - rate.windowStart >= MINUTE_MS) {
      this.rates.set(shop, { windowStart: nowMs, count: 0 });
      return this.perMinute;
    }
    return Math.max(0, this.perMinute - rate.count);
  }

  /** Records what was actually taken. Split from `allowance` so a failed write costs no quota. */
  private spend(shop: string, taken: number): void {
    const rate = this.rates.get(shop);
    if (rate !== undefined) rate.count += taken;
  }

  async listShops(): Promise<string[]> {
    const names = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    return names.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  }

  /** One merchant's lines from the last `hours`, oldest first. */
  async read(shop: string, options: { hours?: number; vet?: string; muc?: string } = {}): Promise<LandingLogLine[]> {
    const folder = path.join(this.root, safeName(shop));
    const names = (await fs.readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl")).sort();
    const since = options.hours === undefined ? null : this.clock.now().getTime() - options.hours * 60 * 60 * 1000;
    const out: LandingLogLine[] = [];
    for (const name of names) {
      const text = await fs.readFile(path.join(folder, name), "utf8").catch(() => "");
      for (const raw of text.split("\n")) {
        if (raw.trim() === "") continue;
        let line: LandingLogLine;
        try { line = JSON.parse(raw) as LandingLogLine; } catch { continue; }
        const at = Date.parse(String(line["nhanLuc"] ?? line.luc ?? ""));
        if (since !== null && Number.isFinite(at) && at < since) continue;
        if (options.vet !== undefined && line.vet !== options.vet) continue;
        if (options.muc !== undefined && line.muc !== options.muc) continue;
        out.push(line);
      }
    }
    return out;
  }

  private async sweepIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.sweptAt < 60 * 60 * 1000) return;
    this.sweptAt = now.getTime();
    await this.sweep(now);
  }

  /** Deletes day-files past `keepDays`. Returns how many went. */
  async sweep(now: Date = this.clock.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.keepDays * DAY_MS).toISOString().slice(0, 10);
    let removed = 0;
    for (const shop of await this.listShops()) {
      const folder = path.join(this.root, shop);
      for (const name of await fs.readdir(folder).catch(() => [] as string[])) {
        const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
        if (match === null || match[1]! >= cutoff) continue;
        await fs.rm(path.join(folder, name), { force: true }).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  }
}
