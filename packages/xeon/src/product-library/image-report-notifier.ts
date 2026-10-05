/**
 * @file Gõ cửa các landing khi sổ ảnh báo sai đổi (04/10/2026).
 *
 * Anh chốt: shop báo sai một ảnh thì ảnh đó ẩn ở MỌI shop ngay. Xeon không biết shop nào đã tải tấm
 * nào, nên nó không tự sửa kho của ai: nó gõ cửa mọi landing đã đăng ký, landing tự đọc luồng của
 * mình rồi ẩn / trả / chặn bản sao của nó (`landing_page` hang-kho `image-reports.ts`).
 *
 * - Gộp: nhiều thay đổi trong vài giây chỉ gõ một lượt.
 * - Không bao giờ ném lỗi ra ngoài (chạy kiểu "bắn rồi quên").
 * - Landing im hay trả lỗi thì thôi, không gọi lại: lần sau OMI mở màn ảnh, landing tự đọc luồng.
 */

import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import type { LicenseService } from "../license/license-service";
import type { ActivityLog } from "../support/activity-log";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

const DEBOUNCE_MS = 3_000;
const NUDGE_TIMEOUT_MS = 60_000;

export class ImageReportNotifier {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<number> | null = null;
  private again = false;
  private readonly gateways = new Map<string, { origin: string; gateway: LandingGateway }>();

  constructor(private readonly options: {
    license: LicenseService; clock: Clock; logger: Logger; fetch?: FetchLike; activityLog?: ActivityLog; debounceMs?: number;
  }) {}

  /** Sổ vừa đổi: gõ cửa sau một quãng ngắn (gộp các thay đổi liền nhau). */
  changed(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; void this.nudgeAll(); }, this.options.debounceMs ?? DEBOUNCE_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Gõ cửa mọi landing đã đăng ký ngay. Trả số landing đã nhận. */
  async nudgeAll(): Promise<number> {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.sweep().finally(() => { this.running = null; });
    const sent = await this.running;
    if (this.again) { this.again = false; void this.nudgeAll(); }
    return sent;
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<number> {
    let shops: string[] = [];
    try { shops = [...new Set(this.options.license.listKeys().map((k) => k.shop).filter(Boolean))]; } catch { return 0; }
    const results = await Promise.all(shops.map(async (shop) => {
      try {
        const landing = this.options.license.landingFor(shop);
        if (!landing.ok) return false;
        const r = await this.gatewayFor(shop, landing.diaChi).nudgeImageReports();
        if (!r.ok && r.status !== 404) this.options.logger.warn(`[bao-anh-sai] khong go cua duoc landing shop "${shop}": ${r.viSao}`);
        return r.ok;
      } catch (error) {
        this.options.logger.warn(`[bao-anh-sai] go cua shop "${shop}" hong: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }));
    return results.filter(Boolean).length;
  }

  private gatewayFor(shop: string, origin: string): LandingGateway {
    const known = this.gateways.get(shop);
    if (known && known.origin === origin) return known.gateway;
    const tickets = new ServiceTicketProvider(this.options.license, shop, this.options.clock);
    const gateway = new LandingGateway({
      origin, ticket: () => tickets.ticket(), fetch: this.options.fetch, timeoutMs: NUDGE_TIMEOUT_MS,
      logger: this.options.logger, clock: this.options.clock, activityLog: this.options.activityLog, shop
    });
    this.gateways.set(shop, { origin, gateway });
    return gateway;
  }
}
