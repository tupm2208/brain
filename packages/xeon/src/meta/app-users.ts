/**
 * @file Who connected which pages through the developer app's Facebook Login — kept ONLY so the
 * app's "delete my data" and "remove app" callbacks know what to undo (02/10/2026).
 *
 * Meta tells us a person by their APP-SCOPED id and nothing else. Before this book, Xeon kept
 * nothing about the person (login sessions live in memory for 15 minutes), so a deletion request
 * could not be traced to the pages it should disconnect. The book keeps the least that answers it:
 *
 *   - the person as an HMAC of their app-scoped id under the app secret — never the id itself,
 *     never a name, an e-mail or a token;
 *   - per shop, the page ids that shop's landing collected from that person's login, and when.
 *
 * A page belongs to the LATEST person whose login a shop collected it from: the landing replaces
 * the page's token with the newest one, so an older person's record stops covering it (otherwise
 * the first admin removing the app would cut a page another admin reconnected since).
 *
 * The book also keeps each callback's outcome under its confirmation code, for Meta's status page:
 * kind, times, status, count — nothing that names the person. Same file discipline as the Meta
 * forwarder's queue: one JSON file next to the ledger, written whole to a temp file then renamed,
 * writes queued one at a time.
 *
 * Changing FACEBOOK_APP_SECRET orphans every recorded person (their key no longer matches); a
 * callback then answers "khong-co-du-lieu" until the person connects pages again.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

/** File name is part of the data directory layout. */
export const APP_USERS_FILE = "meta-nguoi-cap-quyen.json";
/** Requests are kept at least this long (Meta's reviewers and the person may come back to the status page). */
export const REQUEST_KEEP_DAYS = 180;
/** Hard cap on kept requests; the oldest go first, never one younger than `REQUEST_KEEP_MIN_DAYS`. */
export const REQUEST_KEEP_MAX = 5_000;
export const REQUEST_KEEP_MIN_DAYS = 90;
/** Pages recorded per person and shop (`/me/accounts` returns at most 100 per page of results). */
export const PAGES_PER_SHOP_MAX = 200;
/** Confirmation codes: uppercase letters and digits. */
export const CONFIRMATION_CODE_LENGTH = 12;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Which callback a request came through. */
export type AppUserRequestKind = "xoa-du-lieu" | "go-app";
/** What became of it. */
export type AppUserRequestStatus = "da-xoa" | "khong-co-du-lieu" | "landing-chua-nhan";

/** One callback's outcome, under its confirmation code. Names no person. */
export interface AppUserRequest {
  loai: AppUserRequestKind;
  nhanLuc: string;
  xongLuc: string;
  trangThai: AppUserRequestStatus;
  /** Page connections removed (Xeon's routing and the landing's tokens, each page once). */
  soTrang: number;
}

/** One person: per shop, the pages that shop collected from their login. */
export interface AppUserRecord {
  theoShop: Record<string, { trang: string[]; luc: string }>;
}

interface AppUserBookFile {
  phienBan: 1;
  /** By `keyOf(app-scoped id)`. */
  nguoi: Record<string, AppUserRecord>;
  /** By confirmation code. */
  yeuCau: Record<string, AppUserRequest>;
}

export interface MetaAppUserBookOptions {
  /** The app secret — the HMAC key. Empty = the book records nothing (and the callbacks answer 503). */
  secret: string;
  clock: Clock;
  logger: Logger;
  /** Where the file lives. `null` / absent = memory only (tests). */
  dataDirectory?: string | null | undefined;
}

export class MetaAppUserBook {
  private readonly filePath: string | null;
  private book: AppUserBookFile;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: MetaAppUserBookOptions) {
    this.filePath = options.dataDirectory ? path.join(options.dataDirectory, APP_USERS_FILE) : null;
    this.book = this.load();
  }

  /** Whether there is a secret to key people with. */
  ready(): boolean {
    return this.options.secret !== "";
  }

  /** The person's key: HMAC-SHA256 of the app-scoped id under the app secret, hex. The id itself is never kept. */
  keyOf(appScopedUserId: string): string {
    return crypto.createHmac("sha256", this.options.secret).update(String(appScopedUserId), "utf8").digest("hex");
  }

  /**
   * Records that `shop`'s landing collected `pageIds` from this person's login. Pages already
   * recorded for the same shop are kept (the same person connecting again adds pages); the same
   * pages are taken off any OTHER person's record for that shop — the landing now holds this
   * person's tokens for them.
   */
  recordConnection(userKey: string, shop: string, pageIds: readonly string[]): Promise<void> {
    const ids = [...new Set(pageIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
    if (!this.ready() || !userKey || !shop || ids.length === 0) return Promise.resolve();
    return this.serial(async () => {
      const at = this.options.clock.now().toISOString();
      for (const [key, person] of Object.entries(this.book.nguoi)) {
        if (key === userKey) continue;
        const theirs = person.theoShop[shop];
        if (!theirs) continue;
        theirs.trang = theirs.trang.filter((id) => !ids.includes(id));
        if (theirs.trang.length === 0) delete person.theoShop[shop];
        if (Object.keys(person.theoShop).length === 0) delete this.book.nguoi[key];
      }
      const person = this.book.nguoi[userKey] ?? { theoShop: {} };
      const before = person.theoShop[shop]?.trang ?? [];
      person.theoShop[shop] = { trang: [...new Set([...before, ...ids])].slice(-PAGES_PER_SHOP_MAX), luc: at };
      this.book.nguoi[userKey] = person;
      await this.persist();
    });
  }

  /** A copy of what is recorded about a person, or `null`. */
  person(userKey: string): AppUserRecord | null {
    const found = this.book.nguoi[userKey];
    if (!found) return null;
    return { theoShop: Object.fromEntries(Object.entries(found.theoShop).map(([shop, v]) => [shop, { trang: [...v.trang], luc: v.luc }])) };
  }

  /** Forgets a person entirely. Forgetting an unknown person is a no-op. */
  forget(userKey: string): Promise<void> {
    return this.serial(async () => {
      if (!(userKey in this.book.nguoi)) return;
      delete this.book.nguoi[userKey];
      await this.persist();
    });
  }

  /** Records a callback's outcome under a fresh confirmation code and returns the code. */
  addRequest(request: AppUserRequest): Promise<string> {
    return this.serial(async () => {
      let code = newConfirmationCode();
      while (code in this.book.yeuCau) code = newConfirmationCode();
      this.book.yeuCau[code] = { ...request };
      this.prune();
      await this.persist();
      return code;
    });
  }

  /** One request by its confirmation code, or `null`. */
  request(code: string): AppUserRequest | null {
    const found = this.book.yeuCau[String(code ?? "").trim().toUpperCase()];
    return found ? { ...found } : null;
  }

  /** How many people are recorded (health and tests; no detail). */
  personCount(): number {
    return Object.keys(this.book.nguoi).length;
  }

  /** Drops requests past `REQUEST_KEEP_DAYS`, then the oldest past `REQUEST_KEEP_MAX` — never one younger than `REQUEST_KEEP_MIN_DAYS`. */
  private prune(): void {
    const now = this.options.clock.now().getTime();
    const entries = Object.entries(this.book.yeuCau)
      .filter(([, r]) => now - Date.parse(r.nhanLuc) <= REQUEST_KEEP_DAYS * DAY_MS)
      .sort((a, b) => Date.parse(a[1].nhanLuc) - Date.parse(b[1].nhanLuc));
    while (entries.length > REQUEST_KEEP_MAX && now - Date.parse(entries[0]![1].nhanLuc) > REQUEST_KEEP_MIN_DAYS * DAY_MS) entries.shift();
    this.book.yeuCau = Object.fromEntries(entries);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private load(): AppUserBookFile {
    const empty: AppUserBookFile = { phienBan: 1, nguoi: {}, yeuCau: {} };
    if (this.filePath === null || !fs.existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AppUserBookFile>;
      const nguoi = parsed.nguoi && typeof parsed.nguoi === "object" && !Array.isArray(parsed.nguoi) ? parsed.nguoi : {};
      const yeuCau = parsed.yeuCau && typeof parsed.yeuCau === "object" && !Array.isArray(parsed.yeuCau) ? parsed.yeuCau : {};
      return { phienBan: 1, nguoi, yeuCau };
    } catch (error) {
      // Not silently empty: a lost book means deletion requests can no longer find their pages.
      this.options.logger.warn(`[meta] khong doc duoc ${this.filePath}: ${error instanceof Error ? error.message : String(error)} — bat dau so nguoi cap quyen rong`);
      return empty;
    }
  }

  private async persist(): Promise<void> {
    if (this.filePath === null) return;
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(this.book, null, 2), "utf8");
    await fs.promises.rename(temporary, this.filePath);
  }
}

/** A confirmation code: `CONFIRMATION_CODE_LENGTH` uppercase letters and digits from the CSPRNG. */
export function newConfirmationCode(): string {
  let code = "";
  for (let i = 0; i < CONFIRMATION_CODE_LENGTH; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}
