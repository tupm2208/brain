/**
 * @file `GET /nhat-ky`: public activity log viewer.
 *
 *   GET /nhat-ky       JSON array of recent entries (query: ?n=100&loai=meta-webhook,tin-den&since=42)
 *   GET /nhat-ky/      HTML page with auto-refresh, filters, search
 *
 * No authentication — this is a debug surface meant to be reachable from a phone browser while
 * tailing a live deploy on cPanel. The ring buffer holds at most 500 entries in memory and
 * contains no secrets (bodies are truncated, tokens are never logged).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { PATHS } from "../protocol";
import type { ActivityLog } from "../support/activity-log";
import { sendJson, type RequestContext, type RequestController } from "./http-utils";
import type { StaticPageStore } from "./static-pages";

export interface LogControllerOptions {
  log: ActivityLog;
  pages: StaticPageStore;
}

export class LogController implements RequestController {
  private readonly log: ActivityLog;
  private readonly pages: StaticPageStore;

  constructor(options: LogControllerOptions) {
    this.log = options.log;
    this.pages = options.pages;
  }

  async handle(_req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "GET") return false;

    // HTML page
    if (ctx.path === `${PATHS.activityLog}/`) {
      this.pages.serve(res, "log.html");
      return true;
    }

    // JavaScript (loaded by log.html as <script src="app.js">)
    if (ctx.path === `${PATHS.activityLog}/app.js`) {
      this.pages.serve(res, "log.js");
      return true;
    }

    // JSON API
    if (ctx.path === PATHS.activityLog) {
      const url = new URL(String(_req.url || "/"), "http://localhost");
      const n = Math.min(Math.max(Number(url.searchParams.get("n")) || 200, 1), 500);
      const loai = url.searchParams.get("loai") ?? "";
      const since = Number(url.searchParams.get("since")) || 0;
      const entries = this.log.recent({ n, ...(loai ? { loai } : {}), ...(since ? { since } : {}) });
      sendJson(res, 200, {
        ok: true,
        tong: this.log.totalCount(),
        trongBo: this.log.size(),
        muc: entries,
      });
      return true;
    }

    return false;
  }
}
