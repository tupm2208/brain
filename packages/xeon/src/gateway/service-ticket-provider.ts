/**
 * @file Hands the gateway a service ticket, renewing it shortly before expiry.
 */

import type { LicenseService } from "../license/license-service";
import type { Clock } from "../support/clock";

/** Renew when less than this remains, so a ticket never expires mid-call. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;

export class ServiceTicketProvider {
  private current: { ve: string; hetLuc: number } | null = null;

  constructor(
    private readonly license: LicenseService,
    private readonly shop: string,
    private readonly clock: Clock
  ) {}

  /** Returns a valid ticket, issuing a new one when the current one is missing or nearly expired. */
  ticket(): string {
    const now = this.clock.now().getTime();
    if (this.current === null || this.current.hetLuc - now < RENEW_BEFORE_MS) {
      this.current = this.license.issueServiceTicket(this.shop);
    }
    return this.current.ve;
  }
}
