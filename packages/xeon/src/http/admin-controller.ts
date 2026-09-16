/**
 * @file The two web pages on Xeon (decided 14/09/2026).
 *
 *   /quan-tri   licence ADMINISTRATION: the owner only, one admin account (password from the
 *               environment). Issue keys, lock/unlock, extend, change modules, view machines,
 *               remove machines, choose the machine on duty.
 *   /may        MACHINE management for the KEY OWNER: authenticated by the key itself. View the
 *               machines, remove one, choose the one on duty. It must live OUTSIDE the console
 *               because a fourth machine that is refused cannot open the console to free a seat.
 *
 * Protection:
 *   - admin password compared in constant time; shorter than 12 characters DISABLES the page (fail closed);
 *   - admin session: HttpOnly + SameSite=Strict cookie, HMAC signed, 12 hours;
 *   - every state change is a POST with the `X-Yeu-Cau: xeon` header; a browser cannot send that
 *     header from another site, so there is no CSRF even where SameSite is ignored;
 *   - failed logins are counted per address: 10 per 15 minutes;
 *   - the machine page treats the key as the credential; 30 calls per 15 minutes per address;
 *   - strict CSP: no inline script, no inline style, no external calls.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import { CSRF_HEADER, CSRF_HEADER_VALUE, PATHS } from "../protocol";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { AdminSessionManager } from "./admin-session";
import { sendJson, type RequestContext, type RequestController } from "./http-utils";
import { SlidingWindowRateLimiter } from "./rate-limiter";
import type { StaticPageStore } from "./static-pages";

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** A module as rendered in the checkbox list. */
export interface ModuleChoice {
  id: string;
  ten: string;
  loi: boolean;
}

export interface AdminControllerOptions {
  license: LicenseService;
  pages: StaticPageStore;
  adminPassword?: string | undefined;
  sessionSecret?: string | undefined;
  https?: boolean | undefined;
  moduleChoices: ModuleChoice[];
  clock: Clock;
  logger: Logger;
}

/** Handles `/quan-tri/*` (administrator) and `/may/*` (key owner). */
export class AdminController implements RequestController {
  private readonly license: LicenseService;
  private readonly pages: StaticPageStore;
  private readonly adminPassword: string;
  private readonly adminEnabled: boolean;
  private readonly moduleChoices: ModuleChoice[];
  private readonly logger: Logger;
  private readonly sessions: AdminSessionManager;
  private readonly loginLimiter: SlidingWindowRateLimiter;
  private readonly machinePageLimiter: SlidingWindowRateLimiter;

  constructor(options: AdminControllerOptions) {
    this.license = options.license;
    this.pages = options.pages;
    this.adminPassword = String(options.adminPassword ?? "");
    this.adminEnabled = this.adminPassword.length >= MIN_ADMIN_PASSWORD_LENGTH;
    this.moduleChoices = options.moduleChoices;
    this.logger = options.logger;
    if (!this.adminEnabled) this.logger.warn("[quan-tri] XEON_ADMIN_MAT_KHAU thieu hoac ngan hon 12 ky tu — trang quan tri DANG TAT.");
    this.sessions = new AdminSessionManager({ secret: options.sessionSecret, clock: options.clock, secure: options.https, cookiePath: PATHS.admin });
    this.loginLimiter = new SlidingWindowRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, clock: options.clock });
    this.machinePageLimiter = new SlidingWindowRateLimiter({ limit: 30, windowMs: 15 * 60 * 1000, clock: options.clock });
  }

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.path.startsWith(PATHS.admin)) return this.handleAdmin(req, res, ctx);
    if (ctx.path.startsWith(PATHS.machines)) return this.handleMachinePage(req, res, ctx);
    return false;
  }

  // ---------------------------------------------------------------- /quan-tri

  private async handleAdmin(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    const base = PATHS.admin;
    if (ctx.method === "GET") {
      if (ctx.path === base || ctx.path === `${base}/`) { this.pages.serve(res, "admin.html"); return true; }
      if (ctx.path === `${base}/app.js`) { this.pages.serve(res, "admin.js"); return true; }
      if (ctx.path === `${base}/chung.css`) { this.pages.serve(res, "shared.css"); return true; }
      if (ctx.path === `${base}/api/toi`) {
        sendJson(res, 200, { ok: true, bat: this.adminEnabled, dangNhap: this.adminEnabled && this.sessions.isValid(req) });
        return true;
      }
      if (ctx.path === `${base}/api/manh`) { sendJson(res, 200, { ok: true, manh: this.moduleChoices }); return true; }
      if (ctx.path === PATHS.adminLog) return this.handleLog(res, req);
    }
    if (!ctx.path.startsWith(`${base}/api/`)) return false;
    if (!this.adminEnabled) { sendJson(res, 503, { ok: false, error: "quan_tri_dang_tat" }); return true; }
    if (ctx.method !== "POST") { sendJson(res, 404, { ok: false, error: "khong_thay" }); return true; }
    if (!hasCsrfHeader(req)) { sendJson(res, 403, { ok: false, error: "thieu_tieu_de_xeon" }); return true; }

    if (ctx.path === `${base}/api/dang-nhap`) {
      if (!this.loginLimiter.allow(ctx.ip)) { sendJson(res, 429, { ok: false, error: "qua_nhieu" }); return true; }
      const body = await ctx.readJson();
      if (body === null) return true;
      if (!constantTimeEqual(body["matKhau"], this.adminPassword)) {
        this.logger.warn(`[quan-tri] dang nhap sai tu ${ctx.ip}`);
        sendJson(res, 401, { ok: false, error: "sai_mat_khau" });
        return true;
      }
      this.logger.info(`[quan-tri] admin dang nhap tu ${ctx.ip}`);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": this.sessions.cookieFor(this.sessions.issue()) });
      return true;
    }
    if (ctx.path === `${base}/api/dang-xuat`) {
      sendJson(res, 200, { ok: true }, { "Set-Cookie": this.sessions.clearingCookie() });
      return true;
    }
    if (!this.sessions.isValid(req)) { sendJson(res, 401, { ok: false, error: "chua_dang_nhap" }); return true; }

    const body = await ctx.readJson();
    if (body === null) return true;
    try {
      switch (ctx.path) {
        case `${base}/api/key/danh-sach`:
          sendJson(res, 200, { ok: true, key: this.license.listKeys() }); return true;
        case `${base}/api/key/cap`: {
          const issued = await this.license.issueKey({
            shop: String(body["shop"] ?? ""), tenShop: String(body["tenShop"] ?? ""),
            nganh: body["nganh"] === undefined ? undefined : String(body["nganh"]),
            manh: body["manh"] as string[] | undefined,
            hetHan: String(body["hetHan"] ?? ""),
            soMay: body["soMay"] === undefined ? undefined : Number(body["soMay"])
          });
          sendJson(res, 200, { ok: true, ...issued, chiTiet: this.license.viewKey(issued.key) });
          return true;
        }
        case `${base}/api/key/khoa`:
          sendJson(res, 200, { ok: await this.license.lockKey(body["key"], String(body["lyDo"] ?? "")) }); return true;
        case `${base}/api/key/mo`:
          sendJson(res, 200, { ok: await this.license.unlockKey(body["key"]) }); return true;
        case `${base}/api/key/gia-han`:
          sendJson(res, 200, { ok: await this.license.extendKey(body["key"], body["hetHan"]) }); return true;
        case `${base}/api/key/manh`:
          sendJson(res, 200, { ok: await this.license.setModules(body["key"], body["manh"]) }); return true;
        case `${base}/api/key/da-may`:
          sendJson(res, 200, await this.license.removeMachine({ key: body["key"], mayId: body["mayId"] })); return true;
        case `${base}/api/key/may-truc`:
          sendJson(res, 200, await this.license.setDutyMachine({ key: body["key"], mayId: body["mayId"] })); return true;
        default:
          sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
      }
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "sai_yeu_cau", message: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  // ---------------------------------------------------------------- nhật ký deploy + stderr

  /**
   * `GET /quan-tri/api/nhat-ky` — admin-only, returns deploy id, tail of stderr.log,
   * latest build log, and auto-deploy log. Reuses the same `/proc`-free file-reading
   * approach as `tien-trinh.mjs`.
   */
  private handleLog(res: ServerResponse, req: IncomingMessage): boolean {
    if (!this.adminEnabled || !this.sessions.isValid(req)) {
      sendJson(res, 401, { ok: false, error: "chua_dang_nhap" });
      return true;
    }
    const root = path.join(__dirname, "..", "..", "..", "..");  // dist/http → dist → xeon → packages → repo root
    const brainLogs = path.join(os.homedir(), "brain-logs");

    // deploy-id.txt (written by build.sh)
    let deployId = "";
    let buildLuc = "";
    try {
      const lines = fs.readFileSync(path.join(root, "tmp", "deploy-id.txt"), "utf8").trim().split("\n");
      deployId = lines[0] || "";
      buildLuc = lines[1] || "";
    } catch { /* chưa build lần nào */ }

    // stderr.log — tail 20 dòng (cùng cách tien-trinh.mjs đọc)
    let duoiStderr: string[] = [];
    try {
      const all = fs.readFileSync(path.join(root, "stderr.log"), "utf8").split(/\r?\n/).filter((l) => l.trim());
      duoiStderr = all.slice(-20);
    } catch { /* không có stderr.log */ }

    // build-*.log mới nhất trong ~/brain-logs/
    let duoiBuildLog: string[] = [];
    let buildLogTen = "";
    try {
      const files = fs.readdirSync(brainLogs).filter((f) => f.startsWith("build-") && f.endsWith(".log")).sort();
      if (files.length > 0) {
        buildLogTen = files[files.length - 1]!;
        const all = fs.readFileSync(path.join(brainLogs, buildLogTen), "utf8").split(/\r?\n/).filter((l) => l.trim());
        duoiBuildLog = all.slice(-30);
      }
    } catch { /* không đọc được */ }

    // auto-deploy.log
    let duoiAutoDeployLog: string[] = [];
    try {
      const all = fs.readFileSync(path.join(brainLogs, "auto-deploy.log"), "utf8").split(/\r?\n/).filter((l) => l.trim());
      duoiAutoDeployLog = all.slice(-20);
    } catch { /* chưa có */ }

    sendJson(res, 200, {
      ok: true,
      deployId,
      buildLuc,
      duoiStderr,
      buildLogTen,
      duoiBuildLog,
      duoiAutoDeployLog
    });
    return true;
  }

  // ---------------------------------------------------------------- /may

  private async handleMachinePage(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    const base = PATHS.machines;
    if (ctx.method === "GET") {
      if (ctx.path === base || ctx.path === `${base}/`) { this.pages.serve(res, "machines.html"); return true; }
      if (ctx.path === `${base}/app.js`) { this.pages.serve(res, "machines.js"); return true; }
      if (ctx.path === `${base}/chung.css`) { this.pages.serve(res, "shared.css"); return true; }
    }
    if (!ctx.path.startsWith(`${base}/api/`)) return false;
    if (ctx.method !== "POST") { sendJson(res, 404, { ok: false, error: "khong_thay" }); return true; }
    if (!hasCsrfHeader(req)) { sendJson(res, 403, { ok: false, error: "thieu_tieu_de_xeon" }); return true; }
    if (!this.machinePageLimiter.allow(ctx.ip)) { sendJson(res, 429, { ok: false, error: "qua_nhieu" }); return true; }
    const body = await ctx.readJson();
    if (body === null) return true;

    const view = this.license.viewMachines(body["key"]);
    if (view === null) { sendJson(res, 403, { ok: false, viSao: "key_khong_co" }); return true; }
    switch (ctx.path) {
      case `${base}/api/xem`:
        sendJson(res, 200, { ok: true, ...view }); return true;
      case `${base}/api/da`:
        sendJson(res, 200, await this.license.removeMachine({ key: body["key"], mayId: body["mayId"] })); return true;
      case `${base}/api/truc`:
        sendJson(res, 200, await this.license.setDutyMachine({ key: body["key"], mayId: body["mayId"] })); return true;
      default:
        sendJson(res, 404, { ok: false, error: "khong_thay" }); return true;
    }
  }
}

/** State-changing requests must carry the custom header; browsers cannot forge it cross-site. */
function hasCsrfHeader(req: IncomingMessage): boolean {
  return String(req.headers[CSRF_HEADER] || "") === CSRF_HEADER_VALUE;
}
