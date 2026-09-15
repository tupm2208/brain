/**
 * @file The licence ledger: one JSON file, written atomically, updated serially.
 *
 * A few hundred merchants is a lot for this product, and one JSON file is enough. Writes go to a
 * TEMPORARY file that is then renamed (rename is atomic on the same disk), so a power cut leaves
 * either the old file or a complete new one, never half of each. Memory is updated AFTER the
 * write succeeds; a failed write leaves memory equal to what is safely on disk.
 *
 * The field names inside the file are the on-disk format of existing installations and stay in
 * Vietnamese; the types below document them.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../support/logger";

/** File name is part of the on-disk layout; do not rename. */
export const LEDGER_FILE = "license.json";

/** One machine that has activated a key. */
export interface MachineRecord {
  /** Machine id (a hash the console computes from its disk serial). Never shown to users. */
  maMay: string;
  tenMay: string;
  /** ISO time the machine first activated. */
  ghepLuc: string;
  /** ISO time of the most recent licence check. */
  kiemLuc: string;
}

/** The landing (merchant server) registered for a key. */
export interface LandingRecord {
  diaChi: string;
  dangKyLuc: string;
  /** Private inbox token the landing uses on `/tin-den`; identifies the merchant. */
  maNhanTin: string;
}

/** One licence key. */
export interface LicenseRecord {
  key: string;
  shop: string;
  tenShop: string;
  /** Industry pack id ("giay-chay", "nha-thuoc"). */
  nganh: string;
  /** Purchased modules (module ids). Core modules are implied. */
  manh: string[];
  /** ISO expiry. */
  hetHan: string;
  /** Maximum machines. */
  soMay: number;
  capLuc: string;
  /** ISO time the key was locked; empty when not locked. */
  khoaLuc: string;
  lyDoKhoa: string;
  may: MachineRecord[];
  /** Machine id of the machine on duty (runs the automation channels); empty when none. */
  mayTruc: string;
  landing: LandingRecord | null;
  /** Fanpages the merchant connected; Meta events of these pages go to this merchant's landing. Absent in older files. */
  trang?: PageRecord[];
}

/**
 * A Fanpage connected to the developer's Meta app (decided 15/09/2026: one app for every merchant,
 * events routed by page id). No token is kept — Meta confirmed the landing holds one.
 */
export interface PageRecord {
  /** Page id — `entry.id` in Meta's webhook. */
  ma: string;
  ten: string;
  /** ISO time Meta last confirmed the landing holds this page's token. */
  xacMinhLuc: string;
}

export interface LedgerState {
  phienBan: 1;
  cacKey: Record<string, LicenseRecord>;
}

export function emptyLedgerState(): LedgerState {
  return { phienBan: 1, cacKey: {} };
}

export interface LedgerOptions {
  /** Data directory. `null` keeps the ledger in memory only (tests). */
  directory?: string | null | undefined;
  logger?: Logger | undefined;
}

/** Persistent, serialised store of licence records. */
export class LicenseLedger {
  private state: LedgerState = emptyLedgerState();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string | null;

  private constructor(directory: string | null) {
    this.filePath = directory === null ? null : path.join(directory, LEDGER_FILE);
  }

  /** Opens (or creates) the ledger. A file with an unexpected shape is refused, never overwritten. */
  static async open(options: LedgerOptions = {}): Promise<LicenseLedger> {
    const directory = options.directory ?? null;
    const ledger = new LicenseLedger(directory);
    if (directory !== null && ledger.filePath !== null) {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(ledger.filePath)) {
        const parsed: unknown = JSON.parse(fs.readFileSync(ledger.filePath, "utf8"));
        if (!isLedgerState(parsed)) {
          throw new Error(`So license ${ledger.filePath} khong dung hinh dang — khong tu ghi de, kiem tay.`);
        }
        ledger.state = parsed;
        options.logger?.info(`[license] nap so: ${Object.keys(parsed.cacKey).length} key`);
      }
    }
    return ledger;
  }

  /** Current state, READ ONLY. Mutations go through `update`. */
  read(): LedgerState {
    return this.state;
  }

  /**
   * Applies `mutate` to a deep copy, writes the copy to disk, then swaps memory. Serialised:
   * two updates never interleave. The return value of `mutate` is returned to the caller.
   */
  update<T>(mutate: (draft: LedgerState) => T): Promise<T> {
    return this.enqueue(async () => {
      const draft = JSON.parse(JSON.stringify(this.state)) as LedgerState;
      const result = mutate(draft);
      await this.persist(draft);
      this.state = draft;
      return result;
    });
  }

  /** Path of the ledger file, or `null` for an in-memory ledger. */
  path(): string | null {
    return this.filePath;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async persist(next: LedgerState): Promise<void> {
    if (this.filePath === null) return;
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
    await fs.promises.rename(temporary, this.filePath);
  }
}

function isLedgerState(value: unknown): value is LedgerState {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v["phienBan"] === 1 && typeof v["cacKey"] === "object" && v["cacKey"] !== null;
}
