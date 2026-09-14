/**
 * @file BrainService: wires the engine to merchants and their landings.
 *
 * One Xeon serves MANY merchants. Which merchant is served, where its landing is, which ticket
 * to use: all of it comes from the LICENCE LEDGER (decided 14/09/2026). Adding a customer means
 * issuing a key on the admin page; no code or environment change.
 *
 * A legacy "shared token" mode remains for local trials: merchants declared by hand, one common
 * token, memory in RAM.
 */

import type { ConversationId, TenantId } from "@sp/contract";
import { TurnEngine, loadPack, redactPII, type IndustryPack, type MemoryPort } from "@sp/brain";
import type { LicenseService } from "../license/license-service";
import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import { InMemoryConversationMemory } from "../gateway/conversation-memory";
import type { InboundMessageBody, InboundResult } from "../protocol";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";

/** A merchant declared by hand in legacy test mode. */
export interface LegacyShop {
  diaChi: string;
  ma: string;
  nganh?: string | undefined;
}

export interface BrainServiceOptions {
  /** Licensed mode. When present, `legacyShops` is ignored. */
  license?: LicenseService | null | undefined;
  /** Legacy test mode: { [tenant]: { diaChi, ma, nganh } }. */
  legacyShops?: Record<string, LegacyShop> | undefined;
  /** Memory used in legacy mode; licensed mode keeps memory on the landing. */
  memory?: MemoryPort | undefined;
  fetch?: FetchLike | undefined;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
}

/** Everything the service holds for one merchant. */
export interface MerchantBinding {
  gateway: LandingGateway;
  pack: IndustryPack;
  origin: string;
  packId: string;
  /** Tool-list mismatch with the pack has been reported once. */
  mismatchReported: boolean;
}

export class BrainService {
  private readonly license: LicenseService | null;
  private readonly memory: MemoryPort;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly merchants = new Map<string, MerchantBinding>();

  constructor(options: BrainServiceOptions = {}) {
    this.license = options.license ?? null;
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetchImpl = options.fetch;
    this.logger = options.logger ?? { info: (m) => console.log(m), warn: (m) => console.warn(m) };
    this.clock = options.clock ?? { now: () => new Date() };

    if (this.license === null) {
      for (const [tenant, shop] of Object.entries(options.legacyShops ?? {})) {
        if (!shop?.diaChi) throw new Error(`Shop "${tenant}" thiếu địa chỉ server.`);
        this.merchants.set(tenant, {
          gateway: new LandingGateway({ origin: shop.diaChi, ticket: shop.ma, fetch: this.fetchImpl, logger: this.logger, clock: this.clock }),
          pack: loadPack(shop.nganh || "giay-chay"),
          origin: shop.diaChi, packId: shop.nganh || "giay-chay", mismatchReported: false
        });
      }
    }
  }

  /** The binding for a merchant, for diagnostics and tests. */
  merchant(tenant: string): MerchantBinding | undefined {
    return this.merchants.get(tenant);
  }

  /** Handles one inbound message end to end and returns what the landing should know. */
  async handleInbound(message: InboundMessageBody & { tenant: string }): Promise<InboundResult> {
    const tenant = String(message.tenant || "");
    const binding = this.bindingFor(tenant);
    if (binding === null) return { daTraLoi: false, viSao: "khong_phuc_vu_shop" };
    if (binding.gateway.toolListStale()) await this.refreshTools(tenant, binding);

    const conversationId = String(message.maHoiThoai || `${message.kenh || "facebook"}:${message.nguoi}`);
    const engine = new TurnEngine(binding.pack, {
      tools: binding.gateway.tools,
      catalog: binding.gateway.catalog,
      // Licensed mode: memory on the merchant's own landing. Legacy mode: RAM.
      memory: this.license !== null ? binding.gateway.memory : this.memory,
      clock: this.clock
    });
    const result = await engine.handle({
      tenant: tenant as TenantId,
      conversationId: conversationId as ConversationId,
      text: String(message.chu || ""),
      imageCount: Number(message.soAnh || 0),
      at: String(message.luc || this.clock.now().toISOString())
    });

    // The engine has three outcomes. "handoff" is a DELIBERATE non-answer: a human beats a wrong
    // reply. It is still logged and the merchant is told there is work waiting.
    if (result.action === "handoff") {
      this.logger.info(`[bo-nao] chuyen nguoi that: ${tenant} / ${message.nguoi}`);
      await binding.gateway.notifyHandoff({
        kenh: message.kenh, nguoi: message.nguoi,
        maHoiThoai: conversationId,
        // Reason from the gate that blocked (`gates[].reason`); a generic one otherwise.
        lyDo: String((result.gates ?? []).find((g) => g.action === "handoff" || g.action === "block")?.reason || "bot khong chac, chuyen nguoi that"),
        tinCuoi: redactPII(String(message.chu || ""))
      });
      return { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: result.reply };
    }

    await binding.gateway.sendReply({ kenh: message.kenh, nguoi: message.nguoi, chu: result.reply });
    return {
      daTraLoi: true,
      hanhDong: result.action,
      // The log must not carry the customer's exact words; phone numbers are redacted first.
      traLoi: redactPII(result.reply)
    };
  }

  // ---------------------------------------------------------------- internals

  /** Finds (or builds) the binding for a merchant. Licensed mode consults the ledger every message. */
  private bindingFor(tenant: string): MerchantBinding | null {
    if (this.license === null) return this.merchants.get(tenant) ?? null;
    const eligibility = this.license.serviceEligibility(tenant);
    if (!eligibility.ok) {
      this.logger.warn(`[bo-nao] khong phuc vu shop "${tenant}": ${eligibility.viSao}`);
      return null;
    }
    const existing = this.merchants.get(tenant);
    if (existing && existing.origin === eligibility.diaChi && existing.packId === eligibility.nganh) return existing;
    const tickets = new ServiceTicketProvider(this.license, tenant, this.clock);
    const binding: MerchantBinding = {
      origin: eligibility.diaChi, packId: eligibility.nganh, mismatchReported: false,
      gateway: new LandingGateway({ origin: eligibility.diaChi, ticket: () => tickets.ticket(), fetch: this.fetchImpl, logger: this.logger, clock: this.clock }),
      pack: loadPack(eligibility.nganh || "giay-chay")
    };
    this.merchants.set(tenant, binding);
    return binding;
  }

  /**
   * Refreshes the tool list from the landing. On the first successful read, tools the pack wants
   * but the landing does not open are reported once; earlier this mismatch was silent and every
   * policy question fell into "ask back".
   */
  private async refreshTools(tenant: string, binding: MerchantBinding): Promise<void> {
    const open = await binding.gateway.refreshToolList();
    if (binding.mismatchReported) return;
    binding.mismatchReported = true;
    const missing = (binding.pack.allowedTools ?? []).filter((t) => !open.includes(t));
    if (missing.length > 0) {
      this.logger.warn(`[bo-nao] shop "${tenant}": bo luat "${binding.pack.id}" muon dung ${missing.join(", ")} nhung landing khong mo — phan do bot se khong tra loi`);
    }
  }
}
