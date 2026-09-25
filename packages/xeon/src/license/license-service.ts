/**
 * @file Licence service: the place that decides "this key, this machine, allowed or not".
 *
 * Every decision below (decided 14/09/2026) has a test:
 *   - Each key allows 3 machines by default. The machine id is a disk hash computed by the
 *     console; here it is just a string.
 *   - A fourth machine gets "full" plus the names of the three seated machines; the key owner
 *     removes one on the machine page.
 *   - The FIRST machine to activate is the machine on duty. The owner can change it.
 *   - The console sends { key, maMay } at start and every 6 hours; it receives a signed MACHINE
 *     TICKET valid for 7 hours.
 *   - The landing registers with Xeon at install time using the same key; it receives Xeon's
 *     public key and a private inbox token.
 *   - The brain only serves merchants with a valid key, the chatbot module, and a registered landing.
 *
 * Result objects use the wire field names (`ok`, `viSao`, ...) because the HTTP layer returns
 * them to the console and the landing unchanged.
 */

import { signText, signTicket, type SigningKeyPair } from "../support/ticket-kit";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import {
  LICENSE_KEY_PATTERN, MACHINE_ID_PATTERN, SHOP_CODE_PATTERN,
  constantTimeEqual, generateInboxToken, generateLicenseKey, isValidOrigin, machineDisplayId, normalizeLicenseKey
} from "./key-format";
import type { LicenseLedger, LicenseRecord, MachineRecord } from "./ledger";

export const DEFAULT_MACHINE_LIMIT = 3;
/** Machine tickets (console) live 7 hours; the console renews every 6. */
export const MACHINE_TICKET_TTL_MS = 7 * 60 * 60 * 1000;
/** Service tickets (the brain calling a landing) live 1 hour. */
export const SERVICE_TICKET_TTL_MS = 60 * 60 * 1000;
/** Module id that enables the chatbot; the brain only serves keys carrying it. */
export const CHATBOT_MODULE = "chatbot-cskh";

export type KeyStatus = "dang_dung" | "het_han" | "bi_khoa";

/** A machine as shown on screen: no secrets, and not even the full machine id. */
export interface MachineView {
  id: string;
  tenMay: string;
  ghepLuc: string;
  kiemLuc: string;
  truc: boolean;
}

/** A key as shown on the admin screen. Never carries the inbox token. */
export interface KeyView {
  key: string;
  shop: string;
  tenShop: string;
  nganh: string;
  manh: string[];
  hetHan: string;
  capLuc: string;
  trangThai: KeyStatus;
  khoaLuc: string;
  lyDoKhoa: string;
  soMay: number;
  may: MachineView[];
  landing: { diaChi: string; dangKyLuc: string } | null;
}

export interface IssueKeyInput {
  shop: string;
  tenShop: string;
  nganh?: string | undefined;
  manh?: string[] | undefined;
  hetHan: string;
  soMay?: number | undefined;
}

export type MachineCheckResult =
  | { ok: true; ve: string; hetLuc: number; shop: string; tenShop: string; nganh: string; manh: string[]; truc: boolean; diaChiLanding: string; hetHan: string }
  | { ok: false; viSao: "key_khong_co" | "ma_may_sai" }
  | { ok: false; viSao: "key_bi_khoa"; lyDo: string }
  | { ok: false; viSao: "key_het_han"; hetHan: string }
  | { ok: false; viSao: "da_day"; soMay: number; may: MachineView[] };

export type DutyResult = { ok: true; truc: boolean } | { ok: false; viSao: "key_khong_dung" | "may_khong_co" };

export type MachineListResult = { ok: true; may: MachineView[] } | { ok: false; viSao: "key_khong_co" | "may_khong_co" };

export type LeaveResult = { ok: true; conLai: number } | { ok: false; viSao: "key_khong_co" | "may_khong_co" };

export type LandingRegistrationResult =
  | { ok: true; shop: string; tenShop: string; keyId: string; khoaCongPem: string; maNhanTin: string; diaChiXeon: string }
  | { ok: false; viSao: "key_khong_co" | "key_bi_khoa" | "key_het_han" | "dia_chi_sai" };

export type ServiceEligibility =
  | { ok: true; shop: string; tenShop: string; diaChi: string; nganh: string; manh: string[] }
  | { ok: false; viSao: "khong_co_key" | "key_het_han" | "chua_mua_chatbot" | "landing_chua_dang_ky" };

export interface MachinePageView {
  shop: string;
  tenShop: string;
  soMay: number;
  trangThai: KeyStatus;
  may: MachineView[];
}

export interface LicenseServiceOptions {
  ledger: LicenseLedger;
  signingKey: SigningKeyPair;
  clock: Clock;
  logger?: Logger | undefined;
  /** Public address of Xeon, handed to landings at registration so they know where to call. */
  xeonAddress?: string | undefined;
  /** Module ids that may be sold. */
  sellableModules?: readonly string[] | undefined;
  /** Module ids always enabled. */
  coreModules?: readonly string[] | undefined;
}

export class LicenseService {
  private readonly ledger: LicenseLedger;
  private readonly signingKey: SigningKeyPair;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly xeonAddress: string;
  private readonly sellableModules: readonly string[];
  private readonly coreModules: readonly string[];

  constructor(options: LicenseServiceOptions) {
    this.ledger = options.ledger;
    this.signingKey = options.signingKey;
    this.clock = options.clock;
    this.logger = options.logger ?? { info: () => undefined, warn: () => undefined };
    this.xeonAddress = options.xeonAddress ?? "";
    this.sellableModules = options.sellableModules ?? [];
    this.coreModules = options.coreModules ?? [];
  }

  // ---------------------------------------------------------------- administrator

  /** Issues a key for a merchant. Throws with a readable message on invalid input. */
  async issueKey(input: IssueKeyInput): Promise<{ key: string; shop: string }> {
    const shop = String(input.shop ?? "").trim().toLowerCase();
    if (!SHOP_CODE_PATTERN.test(shop)) throw new Error("Ma shop phai la chu thuong-so-gach noi, 2–41 ky tu, bat dau bang chu.");
    if (typeof input.tenShop !== "string" || input.tenShop.trim() === "") throw new Error("Thieu ten shop.");
    const modules = input.manh ?? [];
    if (!Array.isArray(modules)) throw new Error("`manh` phai la mang.");
    for (const m of modules) if (!this.sellableModules.includes(m)) throw new Error(`Manh khong co: "${m}".`);
    const expires = Date.parse(String(input.hetHan ?? ""));
    if (!Number.isFinite(expires)) throw new Error("`hetHan` phai la ngay ISO.");
    if (expires <= this.now().getTime()) throw new Error("`hetHan` phai o tuong lai.");
    const limit = input.soMay ?? DEFAULT_MACHINE_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("`soMay` phai tu 1 den 20.");

    return this.ledger.update((state) => {
      for (const record of Object.values(state.cacKey)) {
        if (record.shop === shop && !record.khoaLuc) throw new Error(`Shop "${shop}" da co key dang dung (${record.key}). Khoa key cu truoc.`);
      }
      let key = generateLicenseKey();
      while (state.cacKey[key]) key = generateLicenseKey();
      state.cacKey[key] = {
        key, shop, tenShop: input.tenShop.trim(), nganh: String(input.nganh ?? "giay-chay"),
        manh: [...new Set(modules)].sort(), hetHan: new Date(expires).toISOString(), soMay: limit,
        capLuc: this.now().toISOString(), khoaLuc: "", lyDoKhoa: "",
        may: [], mayTruc: "", landing: null
      };
      this.logger.info(`[license] cap key cho shop "${shop}"`);
      return { key, shop };
    });
  }

  viewKey(key: unknown): KeyView | null {
    const record = this.find(key);
    return record ? this.keyView(record) : null;
  }

  listKeys(): KeyView[] {
    return Object.values(this.ledger.read().cacKey)
      .sort((a, b) => String(b.capLuc).localeCompare(String(a.capLuc)))
      .map((record) => this.keyView(record));
  }

  async lockKey(key: unknown, reason = ""): Promise<boolean> {
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(key)];
      if (!record) return false;
      record.khoaLuc = this.now().toISOString();
      record.lyDoKhoa = String(reason ?? "");
      this.logger.info(`[license] khoa key cua "${record.shop}": ${record.lyDoKhoa || "khong ghi ly do"}`);
      return true;
    });
  }

  async unlockKey(key: unknown): Promise<boolean> {
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(key)];
      if (!record) return false;
      record.khoaLuc = ""; record.lyDoKhoa = "";
      return true;
    });
  }

  async extendKey(key: unknown, expiresAt: unknown): Promise<boolean> {
    const expires = Date.parse(String(expiresAt ?? ""));
    if (!Number.isFinite(expires) || expires <= this.now().getTime()) throw new Error("`hetHan` phai la ngay ISO o tuong lai.");
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(key)];
      if (!record) return false;
      record.hetHan = new Date(expires).toISOString();
      return true;
    });
  }

  async setModules(key: unknown, modules: unknown): Promise<boolean> {
    if (!Array.isArray(modules)) throw new Error("`manh` phai la mang.");
    for (const m of modules) if (!this.sellableModules.includes(m)) throw new Error(`Manh khong co: "${m}".`);
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(key)];
      if (!record) return false;
      record.manh = [...new Set(modules as string[])].sort();
      return true;
    });
  }

  // ---------------------------------------------------------------- console (OMI)

  /**
   * Console start-up and every 6 hours: { key, maMay, tenMay } -> machine ticket.
   * An unknown machine is added when a seat is free; otherwise refused with the seated machines.
   */
  async checkMachine(input: { key?: unknown; maMay?: unknown; tenMay?: unknown } = {}): Promise<MachineCheckResult> {
    const record = this.find(input.key);
    if (!record) return { ok: false, viSao: "key_khong_co" };
    if (record.khoaLuc) return { ok: false, viSao: "key_bi_khoa", lyDo: record.lyDoKhoa || "" };
    if (this.status(record) === "het_han") return { ok: false, viSao: "key_het_han", hetHan: record.hetHan };
    const machineId = String(input.maMay ?? "").trim();
    if (!MACHINE_ID_PATTERN.test(machineId)) return { ok: false, viSao: "ma_may_sai" };
    const machineName = String(input.tenMay ?? "").trim().slice(0, 80);

    const seated = await this.ledger.update((state): { ok: true; record: LicenseRecord; machine: MachineRecord } | { ok: false; viSao: "da_day"; soMay: number; may: MachineView[] } => {
      const row = state.cacKey[record.key] as LicenseRecord;
      const at = this.now().toISOString();
      let machine = row.may.find((m) => m.maMay === machineId);
      if (!machine) {
        if (row.may.length >= row.soMay) {
          return { ok: false, viSao: "da_day", soMay: row.soMay, may: row.may.map((m) => this.machineView(m, row.mayTruc)) };
        }
        machine = { maMay: machineId, tenMay: machineName || `may-${row.may.length + 1}`, ghepLuc: at, kiemLuc: at };
        row.may.push(machine);
        if (!row.mayTruc) row.mayTruc = machineId; // first machine to activate is on duty
        this.logger.info(`[license] shop "${row.shop}": may moi "${machine.tenMay}" (${row.may.length}/${row.soMay})`);
      } else {
        machine.kiemLuc = at;
        if (machineName) machine.tenMay = machineName;
      }
      return { ok: true, record: row, machine };
    });
    if (!seated.ok) return seated;

    const { ve, hetLuc } = this.signMachineTicket(seated.record, seated.machine);
    return {
      ok: true, ve, hetLuc,
      shop: seated.record.shop, tenShop: seated.record.tenShop, nganh: seated.record.nganh,
      manh: this.enabledModules(seated.record), truc: seated.record.mayTruc === seated.machine.maMay,
      diaChiLanding: seated.record.landing?.diaChi || "",
      hetHan: seated.record.hetHan
    };
  }

  /** Lightweight poll every 5 minutes: is this machine on duty. No write, no ticket. */
  isOnDuty(input: { key?: unknown; maMay?: unknown } = {}): DutyResult {
    const record = this.find(input.key);
    if (!record || record.khoaLuc || this.status(record) === "het_han") return { ok: false, viSao: "key_khong_dung" };
    const machineId = String(input.maMay ?? "").trim();
    if (!record.may.some((m) => m.maMay === machineId)) return { ok: false, viSao: "may_khong_co" };
    return { ok: true, truc: record.mayTruc === machineId };
  }

  /** A machine leaves the key on its own ("leave this machine" in the console), freeing a seat. */
  async leaveMachine(input: { key?: unknown; maMay?: unknown } = {}): Promise<LeaveResult> {
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(input.key)];
      if (!record) return { ok: false, viSao: "key_khong_co" } as const;
      const machineId = String(input.maMay ?? "").trim();
      const index = record.may.findIndex((m) => m.maMay === machineId);
      if (index < 0) return { ok: false, viSao: "may_khong_co" } as const;
      const [removed] = record.may.splice(index, 1);
      if (removed !== undefined && record.mayTruc === removed.maMay) record.mayTruc = record.may[0]?.maMay || "";
      this.logger.info(`[license] shop "${record.shop}": may "${removed?.tenMay ?? ""}" tu roi key`);
      return { ok: true, conLai: record.may.length } as const;
    });
  }

  // ---------------------------------------------------------------- key owner (machine page)

  /** Machines of a key, for the owner's page. Never returns full machine ids. */
  viewMachines(key: unknown): MachinePageView | null {
    const record = this.find(key);
    if (!record) return null;
    return {
      shop: record.shop, tenShop: record.tenShop, soMay: record.soMay,
      trangThai: this.status(record), may: record.may.map((m) => this.machineView(m, record.mayTruc))
    };
  }

  /** Removes a machine by its DISPLAY id. */
  async removeMachine(input: { key?: unknown; mayId?: unknown } = {}): Promise<MachineListResult> {
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(input.key)];
      if (!record) return { ok: false, viSao: "key_khong_co" } as const;
      const index = record.may.findIndex((m) => machineDisplayId(m.maMay) === String(input.mayId ?? ""));
      if (index < 0) return { ok: false, viSao: "may_khong_co" } as const;
      const [removed] = record.may.splice(index, 1);
      if (removed !== undefined && record.mayTruc === removed.maMay) record.mayTruc = record.may[0]?.maMay || "";
      this.logger.info(`[license] shop "${record.shop}": da may "${removed?.tenMay ?? ""}"`);
      return { ok: true, may: record.may.map((m) => this.machineView(m, record.mayTruc)) } as const;
    });
  }

  async setDutyMachine(input: { key?: unknown; mayId?: unknown } = {}): Promise<MachineListResult> {
    return this.ledger.update((state) => {
      const record = state.cacKey[normalizeLicenseKey(input.key)];
      if (!record) return { ok: false, viSao: "key_khong_co" } as const;
      const machine = record.may.find((m) => machineDisplayId(m.maMay) === String(input.mayId ?? ""));
      if (!machine) return { ok: false, viSao: "may_khong_co" } as const;
      record.mayTruc = machine.maMay;
      return { ok: true, may: record.may.map((m) => this.machineView(m, record.mayTruc)) } as const;
    });
  }

  // ---------------------------------------------------------------- landing

  /**
   * The landing calls ONCE at install time. It receives Xeon's public key and a private inbox
   * token. Registering again (hosting reinstalled) kills the previous token: only one landing is
   * alive per merchant.
   */
  async registerLanding(input: { key?: unknown; diaChi?: unknown } = {}): Promise<LandingRegistrationResult> {
    const record = this.find(input.key);
    if (!record) return { ok: false, viSao: "key_khong_co" };
    if (record.khoaLuc) return { ok: false, viSao: "key_bi_khoa" };
    if (this.status(record) === "het_han") return { ok: false, viSao: "key_het_han" };
    const origin = String(input.diaChi ?? "").trim().replace(/\/+$/, "");
    if (!isValidOrigin(`${origin}/`)) return { ok: false, viSao: "dia_chi_sai" };

    const inboxToken = generateInboxToken();
    await this.ledger.update((state) => {
      const row = state.cacKey[record.key] as LicenseRecord;
      row.landing = { diaChi: origin, dangKyLuc: this.now().toISOString(), maNhanTin: inboxToken };
      this.logger.info(`[license] shop "${row.shop}": landing dang ky o ${origin}`);
    });
    return {
      ok: true, shop: record.shop, tenShop: record.tenShop,
      keyId: this.signingKey.keyId, khoaCongPem: this.signingKey.khoaCongPem,
      maNhanTin: inboxToken, diaChiXeon: this.xeonAddress
    };
  }

  /** Which merchant an inbox token belongs to. The tenant is never read from the message body. */
  tenantForInboxToken(token: unknown): string | null {
    const value = String(token ?? "").trim();
    if (!value) return null;
    for (const record of Object.values(this.ledger.read().cacKey)) {
      if (record.landing?.maNhanTin && constantTimeEqual(value, record.landing.maNhanTin)) return record.shop;
    }
    return null;
  }

  // ---------------------------------------------------------------- brain

  /** Whether the brain serves this merchant, and which landing to talk to. */
  serviceEligibility(shop: string): ServiceEligibility {
    const record = Object.values(this.ledger.read().cacKey).find((x) => x.shop === shop && !x.khoaLuc);
    if (!record) return { ok: false, viSao: "khong_co_key" };
    if (this.status(record) === "het_han") return { ok: false, viSao: "key_het_han" };
    if (!this.enabledModules(record).includes(CHATBOT_MODULE)) return { ok: false, viSao: "chua_mua_chatbot" };
    if (!record.landing?.diaChi) return { ok: false, viSao: "landing_chua_dang_ky" };
    return { ok: true, shop: record.shop, tenShop: record.tenShop, diaChi: record.landing.diaChi, nganh: record.nganh, manh: this.enabledModules(record) };
  }

  /** A `dich-vu` ticket for the brain to call the landing. Lives 1 hour; callers renew near expiry. */
  issueServiceTicket(shop: string): { ve: string; hetLuc: number } {
    const record = Object.values(this.ledger.read().cacKey).find((x) => x.shop === shop && !x.khoaLuc);
    if (!record) throw new Error(`Shop "${shop}" khong co key dang dung.`);
    const issuedAt = this.now().getTime();
    const expiresAt = issuedAt + SERVICE_TICKET_TTL_MS;
    return {
      ve: signTicket({
        vai: "dich-vu", shop: record.shop, tenShop: record.tenShop, maMay: "xeon", tenMay: "bo-nao",
        manh: this.enabledModules(record), truc: false, phatLuc: issuedAt, hetLuc: expiresAt
      }, this.signingKey),
      hetLuc: expiresAt
    };
  }

  /** The industry pack id on a merchant's active key (Đ9 knowledge). Empty when the shop has no active key. */
  industryOf(shop: string): string {
    const record = Object.values(this.ledger.read().cacKey).find((x) => x.shop === shop && !x.khoaLuc);
    return record ? String(record.nganh || "giay-chay") : "";
  }

  /**
   * Signs an arbitrary string with Xeon's key (Đ9 Video Studio tickets). The private key never leaves
   * this class; callers get the signature and the key id to verify it with.
   */
  signDetached(textToSign: string): { keyId: string; chuKy: string } {
    return { keyId: this.signingKey.keyId, chuKy: signText(this.signingKey.khoaRiengPem, textToSign) };
  }

  publicKey(): { keyId: string; khoaCongPem: string } {
    return { keyId: this.signingKey.keyId, khoaCongPem: this.signingKey.khoaCongPem };
  }

  /** Number of merchants with an unlocked key. */
  activeShopCount(): number {
    return Object.values(this.ledger.read().cacKey).filter((record) => !record.khoaLuc).length;
  }

  // ---------------------------------------------------------------- Meta pages

  /**
   * Where a merchant's Meta events go: any active key with a registered landing. Unlike
   * `serviceEligibility` the chatbot need not be bought — the inbox keeps messages for a human too.
   */
  landingFor(shop: string): { ok: true; diaChi: string } | { ok: false; viSao: "khong_co_key" | "key_het_han" | "landing_chua_dang_ky" } {
    const record = this.activeRecordOf(shop);
    if (!record) return { ok: false, viSao: "khong_co_key" };
    if (this.status(record) === "het_han") return { ok: false, viSao: "key_het_han" };
    if (!record.landing?.diaChi) return { ok: false, viSao: "landing_chua_dang_ky" };
    return { ok: true, diaChi: record.landing.diaChi };
  }

  /** Which merchant a Fanpage belongs to; a locked key owns nothing. */
  shopForPage(pageId: unknown): string | null {
    const id = String(pageId ?? "").trim();
    if (!id) return null;
    const record = Object.values(this.ledger.read().cacKey).find((x) => !x.khoaLuc && (x.trang ?? []).some((p) => p.ma === id));
    return record ? record.shop : null;
  }

  /** The pages a merchant connected. */
  pagesOf(shop: string): NonNullable<LicenseRecord["trang"]> {
    return [...(this.activeRecordOf(shop)?.trang ?? [])];
  }

  /** Pages connected across every active merchant. */
  pageCount(): number {
    return Object.values(this.ledger.read().cacKey).filter((x) => !x.khoaLuc).reduce((sum, x) => sum + (x.trang ?? []).length, 0);
  }

  /**
   * Records pages Meta confirmed for `shop` (the caller checked the tokens). A page owned by ANOTHER
   * active merchant is refused: one page's events go to exactly one landing, and a landing must not
   * take over another shop's customers by naming its page id.
   */
  async connectPages(shop: string, pages: { ma: string; ten: string }[]): Promise<{ ma: string; ok: boolean; viSao?: "trang_thuoc_shop_khac" | "khong_co_key" }[]> {
    const record = this.activeRecordOf(shop);
    if (!record) return pages.map((p) => ({ ma: p.ma, ok: false, viSao: "khong_co_key" as const }));
    const at = this.now().toISOString();
    const results = await this.ledger.update((state) => {
      const row = state.cacKey[record.key] as LicenseRecord;
      const owned = [...(row.trang ?? [])];
      const out: { ma: string; ok: boolean; viSao?: "trang_thuoc_shop_khac" }[] = [];
      for (const page of pages) {
        const taken = Object.values(state.cacKey).some((x) => x.key !== row.key && !x.khoaLuc && (x.trang ?? []).some((p) => p.ma === page.ma));
        if (taken) { out.push({ ma: page.ma, ok: false, viSao: "trang_thuoc_shop_khac" }); continue; }
        const entry = { ma: page.ma, ten: page.ten, xacMinhLuc: at };
        const index = owned.findIndex((p) => p.ma === page.ma);
        if (index >= 0) owned[index] = entry;
        else owned.push(entry);
        out.push({ ma: page.ma, ok: true });
      }
      row.trang = owned;
      return out;
    });
    const connected = results.filter((r) => r.ok).map((r) => r.ma);
    if (connected.length > 0) this.logger.info(`[license] shop "${record.shop}": ket noi trang ${connected.join(", ")}`);
    return results;
  }

  /** Forgets pages of `shop` (Đ6 "Ngắt kết nối"): Xeon stops routing their events. Returns the ids really removed. */
  async disconnectPages(shop: string, pageIds: string[]): Promise<string[]> {
    const record = this.activeRecordOf(shop);
    if (!record) return [];
    const wanted = new Set(pageIds.map((id) => String(id ?? "").trim()).filter(Boolean));
    const removed = await this.ledger.update((state) => {
      const row = state.cacKey[record.key] as LicenseRecord;
      const before = row.trang ?? [];
      const gone = before.filter((p) => wanted.has(p.ma)).map((p) => p.ma);
      row.trang = before.filter((p) => !wanted.has(p.ma));
      return gone;
    });
    if (removed.length > 0) this.logger.info(`[license] shop "${record.shop}": ngat trang ${removed.join(", ")}`);
    return removed;
  }

  private activeRecordOf(shop: string): LicenseRecord | null {
    return Object.values(this.ledger.read().cacKey).find((x) => x.shop === shop && !x.khoaLuc) ?? null;
  }

  // ---------------------------------------------------------------- internals

  private now(): Date {
    return this.clock.now();
  }

  private find(key: unknown): LicenseRecord | null {
    const normalized = normalizeLicenseKey(key);
    if (!LICENSE_KEY_PATTERN.test(normalized)) return null;
    return this.ledger.read().cacKey[normalized] ?? null;
  }

  private enabledModules(record: LicenseRecord): string[] {
    return [...new Set([...this.coreModules, ...(record.manh ?? [])])].sort();
  }

  private status(record: LicenseRecord): KeyStatus {
    if (record.khoaLuc) return "bi_khoa";
    if (Date.parse(record.hetHan) <= this.now().getTime()) return "het_han";
    return "dang_dung";
  }

  private machineView(machine: MachineRecord, dutyMachineId: string): MachineView {
    return {
      id: machineDisplayId(machine.maMay),
      tenMay: machine.tenMay,
      ghepLuc: machine.ghepLuc,
      kiemLuc: machine.kiemLuc,
      truc: machine.maMay === dutyMachineId
    };
  }

  private keyView(record: LicenseRecord): KeyView {
    return {
      key: record.key, shop: record.shop, tenShop: record.tenShop, nganh: record.nganh,
      manh: this.enabledModules(record), hetHan: record.hetHan, capLuc: record.capLuc,
      trangThai: this.status(record), khoaLuc: record.khoaLuc || "", lyDoKhoa: record.lyDoKhoa || "",
      soMay: record.soMay, may: (record.may ?? []).map((m) => this.machineView(m, record.mayTruc)),
      landing: record.landing ? { diaChi: record.landing.diaChi, dangKyLuc: record.landing.dangKyLuc } : null
    };
  }

  private signMachineTicket(record: LicenseRecord, machine: MachineRecord): { ve: string; hetLuc: number } {
    const issuedAt = this.now().getTime();
    const expiresAt = issuedAt + MACHINE_TICKET_TTL_MS;
    return {
      ve: signTicket({
        vai: "quan-tri", shop: record.shop, tenShop: record.tenShop,
        maMay: machine.maMay, tenMay: machine.tenMay,
        manh: this.enabledModules(record), truc: record.mayTruc === machine.maMay,
        phatLuc: issuedAt, hetLuc: expiresAt
      }, this.signingKey),
      hetLuc: expiresAt
    };
  }
}
