/**
 * @file The HTTP surface of Xeon: a chain of controllers over Node's `http` server.
 *
 * Each controller decides whether it owns the request (Chain of Responsibility). The first one
 * that handles it ends the chain; when none does, the reply is 404.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { ActivityLog, ActivityKind } from "../support/activity-log";
import { clientIp, readJsonObject, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface RequestListenerOptions {
  controllers: readonly RequestController[];
  /** Trust `X-Forwarded-For` (nginx / Cloudflare in front). */
  trustProxy?: boolean | undefined;
  /** When provided, every request/response pair is recorded. */
  activityLog?: ActivityLog | undefined;
}

export type RequestListener = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Maps a request path to the broad activity kind for the ring buffer. */
function kindForPath(path: string): ActivityKind {
  if (path === "/meta/webhook") return "meta-webhook";
  if (path === "/tin-den") return "tin-den";
  if (path === "/viet-bai") return "viet-bai";
  if (path.startsWith("/license/")) return "license";
  if (path.startsWith("/quan-tri/api/")) return "admin";
  return "http";
}

/** Builds the request listener; exposed separately so tests can call it without a socket. */
export function createRequestListener(options: RequestListenerOptions): RequestListener {
  const trustProxy = options.trustProxy === true;
  const log = options.activityLog;
  return async (req, res) => {
    const start = Date.now();
    const ctx: RequestContext = {
      method: req.method || "GET",
      path: String(req.url || "").split("?")[0] ?? "",
      ip: clientIp(req, trustProxy),
      readJson: () => readJsonObject(req, res)
    };

    // Skip logging the log viewer itself and static assets to avoid noise.
    const skip = log === undefined || ctx.path.startsWith("/nhat-ky") || ctx.path === "/health"
      || ctx.path.endsWith(".js") || ctx.path.endsWith(".css");

    for (const controller of options.controllers) {
      if (await controller.handle(req, res, ctx)) {
        if (!skip) log!.add({
          huong: "in", loai: kindForPath(ctx.path),
          method: ctx.method, duong: ctx.path,
          status: res.statusCode, ms: Date.now() - start,
        });
        return;
      }
    }
    // Unknown route: usually a landing newer than this Xeon. The landing turns this mark into "Xeon bản cũ".
    sendJson(res, 404, { ok: false, error: "khong_thay", khongCoDuong: true, message: `Xeon chưa có đường ${ctx.method} ${ctx.path} — Xeon đang chạy bản cũ hơn landing.` });
    if (!skip) log!.add({
      huong: "in", loai: "http",
      method: ctx.method, duong: ctx.path,
      status: 404, ms: Date.now() - start,
      tomTat: "không tìm thấy",
    });
  };
}

/** Creates the Node HTTP server around the controller chain. */
export function createXeonServer(options: RequestListenerOptions): http.Server {
  return http.createServer(createRequestListener(options));
}
