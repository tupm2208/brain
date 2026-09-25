/**
 * @file Turn dossiers on Xeon's disk, ONE FOLDER PER MERCHANT.
 *
 *   <root>/<shop>/muc-luc.jsonl            one short row per turn — what `tim` / `gan-day` read
 *   <root>/<shop>/<hoi-thoai>/<stt>-<hạng>.json   the dossier itself
 *
 * Per merchant, because Xeon serves many landings: one shop having a bad hour must not push
 * another shop's evidence out (which is exactly what the shared 500-entry ring buffer does).
 *
 * The retention class is IN THE FILE NAME so the sweep never has to open a file: `-hong` (a turn
 * that went wrong) is kept four times as long as `-thuong`.
 *
 * Writing a dossier must never break the turn that produced it. Every failure here is logged and
 * swallowed: a customer does not go unanswered because a disk is full.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import {
  RETENTION_DAYS, indexRow, retentionClass, scrubSecrets,
  type DossierIndexRow, type DossierStore, type TurnDossier, type TurnOutcomeKind
} from "./turn-dossier";

/** One hit: which merchant it belongs to, and the index row that describes it. */
export interface FoundTurn {
  shop: string;
  row: DossierIndexRow;
}

export interface SearchOptions {
  shop?: string | undefined;
  /** Matched without accents or case, against the customer's message and the bot's reply. */
  text?: string | undefined;
  /** Only turns from the last N hours. */
  hours?: number | undefined;
  /** Only turns that did NOT end in a plain answer. */
  hong?: boolean | undefined;
  ketCuc?: TurnOutcomeKind | undefined;
  limit?: number | undefined;
}

/**
 * Accents and case removed, so a search types the way people speak. Vietnamese "đ" is not covered
 * by NFD, so it is replaced by hand — the same trick `stripDiacritics` uses in the engine.
 */
function plainText(value: string): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export const INDEX_FILE = "muc-luc.jsonl";
/** Rows kept in one merchant's index before the oldest are dropped. */
export const INDEX_MAX_ROWS = 20_000;
/** The sweep is not worth running on every message. */
export const SWEEP_EVERY_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A file name that is safe on every platform this runs on. Conversation ids may contain `:` and
 * `@` (`CONVERSATION_ID_PATTERN`), and `:` is illegal on Windows. A short hash of the original is
 * appended whenever anything was replaced, so two different ids never land in one folder.
 */
export function safeName(value: string): string {
  const raw = String(value ?? "");
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "_";
  if (cleaned === raw) return cleaned;
  return `${cleaned}-${createHash("sha1").update(raw).digest("hex").slice(0, 8)}`;
}

export interface DiskDossierStoreOptions {
  /** Where the folders live, e.g. `bo-nao/logs/ho-so`. */
  root: string;
  clock: Clock;
  logger: Logger;
  /** Overrides `RETENTION_DAYS` (tests, and a merchant who asks for less). */
  retentionDays?: Partial<Record<keyof typeof RETENTION_DAYS, number>> | undefined;
}

export class DiskDossierStore implements DossierStore {
  private readonly root: string;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly retention: Record<keyof typeof RETENTION_DAYS, number>;
  /** Conversation folder -> last sequence number written, so a busy conversation skips the readdir. */
  private readonly sequences = new Map<string, number>();
  private sweptAt = 0;

  constructor(options: DiskDossierStoreOptions) {
    this.root = options.root;
    this.clock = options.clock;
    this.logger = options.logger;
    this.retention = { ...RETENTION_DAYS, ...(options.retentionDays ?? {}) };
  }

  /** Folder holding one conversation's dossiers. */
  folderFor(shop: string, conversationId: string): string {
    return path.join(this.root, safeName(shop), safeName(conversationId));
  }

  async write(dossier: TurnDossier): Promise<void> {
    try {
      const folder = this.folderFor(dossier.shop, dossier.maHoiThoai);
      await fs.mkdir(folder, { recursive: true });
      const stt = dossier.stt > 0 ? dossier.stt : await this.nextSequence(folder);
      const complete: TurnDossier = scrubSecrets({ ...dossier, stt });
      const file = path.join(folder, `${String(stt).padStart(4, "0")}-${retentionClass(complete)}.json`);
      await fs.writeFile(file, JSON.stringify(complete, null, 2), "utf8");
      await this.appendIndex(complete, path.relative(path.join(this.root, safeName(dossier.shop)), file));
      await this.sweepIfDue();
    } catch (error) {
      // Never let bookkeeping cost a customer an answer.
      this.logger.warn(`[ho-so] khong ghi duoc ho so luot ${dossier.shop}/${dossier.maHoiThoai}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The number this turn takes in its conversation. Counted from disk so a restart does not reset it. */
  private async nextSequence(folder: string): Promise<number> {
    const cached = this.sequences.get(folder);
    if (cached !== undefined) {
      const next = cached + 1;
      this.sequences.set(folder, next);
      return next;
    }
    let highest = 0;
    for (const name of await fs.readdir(folder).catch(() => [] as string[])) {
      const n = Number(name.split("-")[0]);
      if (Number.isFinite(n) && n > highest) highest = n;
    }
    this.sequences.set(folder, highest + 1);
    return highest + 1;
  }

  private async appendIndex(dossier: TurnDossier, relativeFile: string): Promise<void> {
    const shopFolder = path.join(this.root, safeName(dossier.shop));
    const file = path.join(shopFolder, INDEX_FILE);
    await fs.appendFile(file, `${JSON.stringify(indexRow(dossier, relativeFile.split(path.sep).join("/")))}\n`, "utf8");
    // Cheap guard against unbounded growth; the dossiers themselves are swept by date.
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    if (lines.length > INDEX_MAX_ROWS) {
      await fs.writeFile(file, `${lines.slice(-INDEX_MAX_ROWS).join("\n")}\n`, "utf8");
    }
  }

  /** Reads back one merchant's index, newest last. Rows that cannot be parsed are skipped. */
  async readIndex(shop: string): Promise<DossierIndexRow[]> {
    const file = path.join(this.root, safeName(shop), INDEX_FILE);
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const rows: DossierIndexRow[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try { rows.push(JSON.parse(line) as DossierIndexRow); } catch { /* a half-written line at the tail */ }
    }
    return rows;
  }

  /** Every merchant with dossiers kept, by folder name. */
  async listShops(): Promise<string[]> {
    const names = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    return names.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  }

  /**
   * The turns of one conversation, oldest first. Without `shop` every merchant is searched — when
   * someone pastes a conversation id they rarely know which shop it belongs to.
   */
  async findByConversation(conversationId: string, shop?: string): Promise<{ shop: string; row: DossierIndexRow }[]> {
    const shops = shop !== undefined ? [shop] : await this.listShops();
    const found: { shop: string; row: DossierIndexRow }[] = [];
    for (const name of shops) {
      for (const row of await this.readIndex(name)) {
        if (row.maHoiThoai === conversationId) found.push({ shop: name, row });
      }
    }
    return found.sort((a, b) => a.row.luc.localeCompare(b.row.luc) || a.row.stt - b.row.stt);
  }

  /**
   * The turns matching a search, NEWEST FIRST — the way `tim` and `gan-day` look for a case.
   *
   * `text` is matched without accents and without case, because the person searching types what
   * the shop told them on the phone ("doi nay con khong"), not what is in the database.
   */
  async search(options: SearchOptions = {}): Promise<FoundTurn[]> {
    const shops = options.shop !== undefined ? [options.shop] : await this.listShops();
    const needle = options.text === undefined ? null : plainText(options.text);
    const since = options.hours === undefined ? null : this.clock.now().getTime() - options.hours * 60 * 60 * 1000;
    const found: FoundTurn[] = [];
    for (const shop of shops) {
      for (const row of await this.readIndex(shop)) {
        if (since !== null && Date.parse(row.luc) < since) continue;
        if (options.hong === true && row.ketCuc === "da-tra-loi") continue;
        if (options.ketCuc !== undefined && row.ketCuc !== options.ketCuc) continue;
        if (needle !== null && !plainText(`${row.tin} ${row.traLoi ?? ""}`).includes(needle)) continue;
        found.push({ shop, row });
      }
    }
    found.sort((a, b) => b.row.luc.localeCompare(a.row.luc) || b.row.stt - a.row.stt);
    return options.limit === undefined ? found : found.slice(0, options.limit);
  }

  /**
   * The same search, but reading every dossier instead of the index. Slower by a lot; it is the
   * only way to find a phrase that appears in a tool result or in a reply that was blocked.
   */
  async searchDeep(options: SearchOptions = {}): Promise<FoundTurn[]> {
    const needle = options.text === undefined ? null : plainText(options.text);
    const shallow = await this.search({ ...options, text: undefined, limit: undefined });
    if (needle === null) return options.limit === undefined ? shallow : shallow.slice(0, options.limit);
    const found: FoundTurn[] = [];
    for (const hit of shallow) {
      const dossier = await this.load(hit.shop, hit.row.tep);
      if (dossier !== null && plainText(JSON.stringify(dossier)).includes(needle)) found.push(hit);
      if (options.limit !== undefined && found.length >= options.limit) break;
    }
    return found;
  }

  /** Loads one dossier by the `tep` of its index row. */
  async load(shop: string, relativeFile: string): Promise<TurnDossier | null> {
    const file = path.join(this.root, safeName(shop), ...relativeFile.split("/"));
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (text === "") return null;
    try { return JSON.parse(text) as TurnDossier; } catch { return null; }
  }

  private async sweepIfDue(): Promise<void> {
    const now = this.clock.now().getTime();
    if (now - this.sweptAt < SWEEP_EVERY_MS) return;
    this.sweptAt = now;
    await this.sweep();
  }

  /** Deletes dossiers past their deadline and the folders left empty. Returns how many went. */
  async sweep(): Promise<number> {
    const now = this.clock.now().getTime();
    let removed = 0;
    for (const shop of await fs.readdir(this.root).catch(() => [] as string[])) {
      const shopFolder = path.join(this.root, shop);
      for (const conversation of await fs.readdir(shopFolder).catch(() => [] as string[])) {
        if (conversation === INDEX_FILE) continue;
        const folder = path.join(shopFolder, conversation);
        const names = await fs.readdir(folder).catch(() => [] as string[]);
        for (const name of names) {
          const kind = name.includes("-hong") ? "hong" : "thuong";
          const file = path.join(folder, name);
          const stat = await fs.stat(file).catch(() => null);
          if (stat === null) continue;
          if (now - stat.mtimeMs <= this.retention[kind] * DAY_MS) continue;
          await fs.rm(file, { force: true }).catch(() => undefined);
          removed += 1;
        }
        const left = await fs.readdir(folder).catch(() => ["keep"]);
        if (left.length === 0) {
          await fs.rmdir(folder).catch(() => undefined);
          this.sequences.delete(folder);
        }
      }
    }
    if (removed > 0) this.logger.info(`[ho-so] don ${removed} ho so qua han`);
    return removed;
  }

  /** Erases everything kept for one merchant — the answer to "shop asks us to delete it". */
  async forget(shop: string): Promise<void> {
    const folder = path.join(this.root, safeName(shop));
    await fs.rm(folder, { recursive: true, force: true });
    for (const key of [...this.sequences.keys()]) if (key.startsWith(folder)) this.sequences.delete(key);
    this.logger.info(`[ho-so] da xoa toan bo ho so cua shop "${shop}"`);
  }
}
