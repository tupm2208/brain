/**
 * @file What Xeon undoes when a person tells Meta to forget the developer app (02/10/2026): the
 * "Data deletion request" callback and the "Deauthorize" callback, and the public status page Meta
 * shows the person afterwards.
 *
 * Decided 02/10/2026: ONLY the app's own delete button is automated. A shopper who wants their
 * conversation data deleted asks the shop, and the shop's staff handle it — not this file.
 *
 * What the platform holds because of a person's login is small: Xeon's routing of the pages (the
 * licence book) and the page tokens on the shop's own landing. So erasing a person is:
 *
 *   1. find them in `MetaAppUserBook` by the keyed hash of their app-scoped id;
 *   2. per shop: stop routing the recorded pages that shop still owns (`license.disconnectPages`),
 *      and ask the shop's landing to forget those pages' tokens (`POST /api/hop-thu/quen-trang`,
 *      best effort — whether it confirmed is what the status page says);
 *   3. forget the person, and keep the outcome under a confirmation code (no person in it).
 *
 * The landing is asked about EVERY page recorded for that shop, not only the ones Xeon still
 * routes: a page Xeon refused to route (another shop owns it) can still sit on the landing with a
 * token from this person's login.
 */

import { LandingGateway, type FetchLike } from "../gateway/landing-gateway";
import { ServiceTicketProvider } from "../gateway/service-ticket-provider";
import type { LicenseService } from "../license/license-service";
import type { ActivityLog } from "../support/activity-log";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import type { AppUserRequest, AppUserRequestKind, AppUserRequestStatus, MetaAppUserBook } from "./app-users";

/** Reason code the landing stores on each forgotten page (`matKetNoi.lyDo`). */
export const FORGET_PAGES_REASON = "nguoi-cap-quyen-go-app";
/** Per landing attempt. Meta waits on the callback, so this is shorter than the forwarder's. */
export const LANDING_FORGET_TIMEOUT_MS = 6_000;

/** What happened for one shop. */
export interface ShopErasure {
  shop: string;
  /** Pages Xeon stopped routing for that shop. */
  trangXeon: string[];
  /** Whether the shop's landing confirmed forgetting the tokens. */
  landing: "da-nhan" | "chua-nhan";
  viSao?: string;
}

export interface ErasureOutcome {
  code: string;
  request: AppUserRequest;
  /** The person's key — the caller drops login sessions still waiting under it. Never logged in full. */
  userKey: string;
  shops: ShopErasure[];
}

export interface MetaDataDeletionOptions {
  book: MetaAppUserBook;
  license: LicenseService;
  clock: Clock;
  logger: Logger;
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
  activityLog?: ActivityLog | undefined;
}

export class MetaDataDeletion {
  constructor(private readonly options: MetaDataDeletionOptions) {}

  /** The book of people — login records into it. */
  get book(): MetaAppUserBook {
    return this.options.book;
  }

  /** Erases what the platform keeps because of this person's login, and records the outcome. */
  async erase(appScopedUserId: string, kind: AppUserRequestKind): Promise<ErasureOutcome> {
    const { book, license, clock } = this.options;
    const userKey = book.keyOf(appScopedUserId);
    const receivedAt = clock.now().toISOString();
    const person = book.person(userKey);
    const removed = new Set<string>();
    const shops: ShopErasure[] = [];

    if (person !== null) {
      for (const [shop, { trang }] of Object.entries(person.theoShop)) {
        const owned = new Set(license.pagesOf(shop).map((p) => p.ma));
        const routed = trang.filter((id) => owned.has(id));
        const cut = routed.length > 0 ? await license.disconnectPages(shop, routed) : [];
        for (const id of cut) removed.add(id);
        const told = await this.tellLanding(shop, trang);
        if (told.ok) for (const id of told.daQuen) removed.add(id);
        shops.push(told.ok ? { shop, trangXeon: cut, landing: "da-nhan" } : { shop, trangXeon: cut, landing: "chua-nhan", viSao: told.viSao });
      }
      await book.forget(userKey);
    }

    const status: AppUserRequestStatus = person === null ? "khong-co-du-lieu" : shops.some((s) => s.landing === "chua-nhan") ? "landing-chua-nhan" : "da-xoa";
    const request: AppUserRequest = { loai: kind, nhanLuc: receivedAt, xongLuc: clock.now().toISOString(), trangThai: status, soTrang: removed.size };
    const code = await book.addRequest(request);
    // The key's first 8 hex characters at most — enough to match two log lines, useless to anyone else.
    this.options.logger.info(`[meta] ${kind} ${code}: nguoi ${userKey.slice(0, 8)} — ${shops.length} shop, ${removed.size} trang, ${status}`);
    for (const s of shops) if (s.landing === "chua-nhan") this.options.logger.warn(`[meta] ${kind} ${code}: landing shop "${s.shop}" chua xac nhan quen token (${s.viSao ?? "?"})`);
    return { code, request, userKey, shops };
  }

  private async tellLanding(shop: string, pageIds: string[]): Promise<{ ok: true; daQuen: string[] } | { ok: false; viSao: string }> {
    if (pageIds.length === 0) return { ok: true, daQuen: [] };
    const { license, clock, logger } = this.options;
    const landing = license.landingFor(shop);
    if (!landing.ok) return { ok: false, viSao: landing.viSao };
    const tickets = new ServiceTicketProvider(license, shop, clock);
    // A one-off gateway: deletions are rare, and this one may retry only once — Meta is waiting.
    const gateway = new LandingGateway({
      origin: landing.diaChi, ticket: () => tickets.ticket(), fetch: this.options.fetch, shop,
      timeoutMs: this.options.timeoutMs ?? LANDING_FORGET_TIMEOUT_MS, retries: 1, logger, clock, activityLog: this.options.activityLog
    });
    return gateway.forgetPages({ trang: pageIds, lyDo: FORGET_PAGES_REASON });
  }
}

// ------------------------------------------------------------------------------ status page

const KIND_TEXT: Record<AppUserRequestKind, { vi: string; en: string }> = {
  "xoa-du-lieu": { vi: "Yêu cầu xoá dữ liệu", en: "Data deletion request" },
  "go-app": { vi: "Gỡ app khỏi tài khoản Facebook", en: "App removed from a Facebook account" }
};

const STATUS_TEXT: Record<AppUserRequestStatus, { vi: string; en: string }> = {
  "da-xoa": { vi: "Đã xoá xong.", en: "completed" },
  "khong-co-du-lieu": {
    vi: "Không có dữ liệu nào cần xoá: tài khoản này không (hoặc không còn) gắn với trang nào trên nền tảng.",
    en: "nothing to delete — this account is not (or no longer) linked to any Page"
  },
  "landing-chua-nhan": {
    vi: "Nền tảng đã gỡ kết nối trang; máy chủ riêng của shop chưa xác nhận đã xoá mã truy cập trang.",
    en: "the platform removed the Page connections; the shop's own server has not yet confirmed deleting the Page access tokens"
  }
};

const WHAT_WE_KEEP_VI = "Nền tảng không bao giờ lưu tên, email hay mật khẩu Facebook của bạn. Nền tảng chỉ giữ: shop nào đã kết nối những trang nào, và mã truy cập của các trang đó trên máy chủ riêng của chính shop đó — các thứ này được xoá khi có yêu cầu.";
const WHAT_WE_KEEP_EN = "We never store your Facebook name, email or password. We keep only which Pages a shop connected, and those Pages' access tokens on that shop's own server; both are deleted on request.";

/** Confirmation codes as they appear in a link — anything else is not looked up. */
export const CONFIRMATION_CODE_PATTERN = /^[A-Z0-9]{10,32}$/;

/** The public status page for one request (`request === null` = unknown code, 404). Escaped, no person in it. */
export function renderAppUserRequestPage(code: string, request: AppUserRequest | null): { status: number; html: string } {
  if (request === null) {
    return {
      status: 404,
      html: pageShell("Không tìm thấy yêu cầu", `<h1>Không tìm thấy yêu cầu</h1>
<p>Mã yêu cầu không đúng, hoặc yêu cầu đã quá thời hạn lưu.</p>
<p class="en" lang="en">Request not found: the code is wrong or no longer kept.</p>`)
    };
  }
  const kind = KIND_TEXT[request.loai] ?? KIND_TEXT["xoa-du-lieu"];
  const status = STATUS_TEXT[request.trangThai] ?? STATUS_TEXT["da-xoa"];
  const rows: [string, string][] = [
    ["Mã yêu cầu", code],
    ["Loại", kind.vi],
    ["Nhận lúc", vietnamTime(request.nhanLuc)],
    ["Xong lúc", vietnamTime(request.xongLuc)],
    ["Trạng thái", status.vi],
    ["Số kết nối trang đã gỡ", String(Math.max(0, Math.trunc(Number(request.soTrang) || 0)))]
  ];
  return {
    status: 200,
    html: pageShell(kind.vi, `<h1>${escapeHtml(kind.vi)}</h1>
<table>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>
<p>${escapeHtml(WHAT_WE_KEEP_VI)}</p>
<p class="en" lang="en">${escapeHtml(`${kind.en} ${code}: ${status.en}. ${WHAT_WE_KEEP_EN}`)}</p>`)
  };
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:640px;margin:0 auto;padding:32px 16px;line-height:1.55;color:#1f2328;background:#fff}
h1{font-size:1.35rem;margin:0 0 16px}
table{border-collapse:collapse;width:100%;margin:0 0 20px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #d0d7de;vertical-align:top}
th{width:42%;font-weight:600}
.en{color:#57606a;font-size:.92rem}
@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}th,td{border-color:#30363d}.en{color:#9198a1}}
</style></head><body>
${body}
</body></html>`;
}

/** `02/10/2026 14:05 (giờ Việt Nam)` — the page is read by people in Vietnam; UTC+7 has no daylight saving. */
function vietnamTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const t = new Date(ms + 7 * 60 * 60 * 1000).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)} (giờ Việt Nam)`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, (c) => map[c] ?? c);
}
