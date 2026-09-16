/**
 * @file Hands a Meta packet to the landing of the merchant that owns the page — and keeps it when
 * the landing cannot take it.
 *
 * Meta retries a webhook that did not get a 200, but a retry re-delivers the pages of every OTHER
 * merchant in the same packet too. So Xeon answers Meta 200 once the packet is split, and a packet a
 * landing could not take waits here, in `meta-cho-chuyen.json` next to the ledger, until the next
 * webhook call. There is no timer on purpose: Passenger stops an idle app, so the next delivery from
 * Meta is the heartbeat.
 */

import fs from "node:fs";
import path from "node:path";
import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import type { LicenseService } from "../license/license-service";
import type { Clock } from "../support/clock";
import type { ActivityLog } from "../support/activity-log";
import type { Logger } from "../support/logger";
import type { PagePacket } from "./meta-packet";

/** File name is part of the data directory layout. */
export const PENDING_FILE = "meta-cho-chuyen.json";
export const PENDING_KEEP_MAX = 500;
/** Meta's own 24-hour messaging window: a message older than that cannot be answered anyway. */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PendingItem {
  shop: string;
  goi: PagePacket;
  nhanLuc: string;
  lanThu: number;
  loiCuoi: string;
}

interface PendingBook {
  phienBan: 1;
  muc: PendingItem[];
}

export type DeliveryResult = { ok: true } | { ok: false; viSao: string };

export interface MetaForwarderOptions {
  license: LicenseService;
  clock: Clock;
  logger: Logger;
  /** Where waiting packets are kept. `null` / absent = memory only (tests). */
  dataDirectory?: string | null | undefined;
  fetch?: FetchLike | undefined;
  /** Per landing call. Meta wants its answer within 20 seconds. */
  timeoutMs?: number | undefined;
  activityLog?: ActivityLog | undefined;
}

export class MetaForwarder {
  private readonly gateways = new Map<string, { origin: string; gateway: LandingGateway }>();
  private readonly filePath: string | null;
  private book: PendingBook;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: MetaForwarderOptions) {
    this.filePath = options.dataDirectory ? path.join(options.dataDirectory, PENDING_FILE) : null;
    this.book = this.load();
  }

  /** How many packets are waiting for a landing. */
  pendingCount(): number {
    return this.book.muc.length;
  }

  /** Delivers one merchant's packet; on failure it waits for the next webhook call. */
  async deliver(shop: string, packet: PagePacket): Promise<DeliveryResult> {
    const start = Date.now();
    const result = await this.send(shop, packet);
    if (!result.ok) {
      this.options.logger.warn(`[meta] chua chuyen duoc goi cho shop "${shop}": ${result.viSao} — giu lai thu sau`);
      await this.keep({ shop, goi: packet, nhanLuc: this.options.clock.now().toISOString(), lanThu: 1, loiCuoi: result.viSao });
    }
    this.options.activityLog?.add({
      huong: "out", loai: "meta-chuyen", method: "POST", duong: "/api/hop-thu/meta-tu-xeon",
      shop, status: result.ok ? 200 : 0, ms: Date.now() - start,
      tomTat: result.ok ? "đã chuyển" : `lỗi: ${result.viSao}`,
      chiTiet: { soEntry: packet.entry.length },
    });
    return result;
  }

  /** Tries every waiting packet once and drops those past Meta's 24-hour window. Returns how many went through. */
  retryPending(): Promise<number> {
    return this.serial(async () => {
      if (this.book.muc.length === 0) return 0;
      const now = this.options.clock.now().getTime();
      const still: PendingItem[] = [];
      let delivered = 0;
      for (const item of this.book.muc) {
        if (now - Date.parse(item.nhanLuc) > PENDING_MAX_AGE_MS) {
          this.options.logger.warn(`[meta] bo goi cua shop "${item.shop}" qua 24 gio (thu ${item.lanThu} lan, loi cuoi: ${item.loiCuoi})`);
          this.options.activityLog?.add({
            huong: "internal", loai: "meta-retry", shop: item.shop,
            tomTat: `bỏ gói quá 24h (thử ${item.lanThu} lần, lỗi cuối: ${item.loiCuoi})`,
          });
          continue;
        }
        const start = Date.now();
        const result = await this.send(item.shop, item.goi);
        if (result.ok) {
          delivered += 1;
          this.options.activityLog?.add({
            huong: "out", loai: "meta-retry", shop: item.shop, status: 200, ms: Date.now() - start,
            tomTat: `chuyển bù thành công (lần ${item.lanThu + 1})`,
          });
        } else {
          still.push({ ...item, lanThu: item.lanThu + 1, loiCuoi: result.viSao });
          this.options.activityLog?.add({
            huong: "out", loai: "meta-retry", shop: item.shop, status: 0, ms: Date.now() - start,
            tomTat: `thử lại lần ${item.lanThu + 1} thất bại: ${result.viSao}`,
          });
        }
      }
      this.book = { phienBan: 1, muc: still };
      await this.persist();
      if (delivered > 0) this.options.logger.info(`[meta] da chuyen bu ${delivered} goi dang cho`);
      return delivered;
    });
  }

  private async send(shop: string, packet: PagePacket): Promise<DeliveryResult> {
    const landing = this.options.license.landingFor(shop);
    if (!landing.ok) return { ok: false, viSao: landing.viSao };
    return this.gatewayFor(shop, landing.diaChi).forwardMetaPacket(packet);
  }

  private gatewayFor(shop: string, origin: string): LandingGateway {
    const known = this.gateways.get(shop);
    if (known && known.origin === origin) return known.gateway;
    const tickets = new ServiceTicketProvider(this.options.license, shop, this.options.clock);
    const gateway = new LandingGateway({
      origin, ticket: () => tickets.ticket(), fetch: this.options.fetch,
      timeoutMs: this.options.timeoutMs ?? 8_000, logger: this.options.logger, clock: this.options.clock
    });
    this.gateways.set(shop, { origin, gateway });
    return gateway;
  }

  private keep(item: PendingItem): Promise<void> {
    return this.serial(async () => {
      this.book = { phienBan: 1, muc: [...this.book.muc, item].slice(-PENDING_KEEP_MAX) };
      await this.persist();
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private load(): PendingBook {
    if (this.filePath === null || !fs.existsSync(this.filePath)) return { phienBan: 1, muc: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PendingBook>;
      return { phienBan: 1, muc: Array.isArray(parsed.muc) ? parsed.muc : [] };
    } catch (error) {
      this.options.logger.warn(`[meta] khong doc duoc ${this.filePath}: ${error instanceof Error ? error.message : String(error)} — bat dau hang cho rong`);
      return { phienBan: 1, muc: [] };
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
