/**
 * @file The HTTP surface of Xeon: a chain of controllers over Node's `http` server.
 *
 * Each controller decides whether it owns the request (Chain of Responsibility). The first one
 * that handles it ends the chain; when none does, the reply is 404.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { clientIp, readJsonObject, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface RequestListenerOptions {
  controllers: readonly RequestController[];
  /** Trust `X-Forwarded-For` (nginx / Cloudflare in front). */
  trustProxy?: boolean | undefined;
}

export type RequestListener = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Builds the request listener; exposed separately so tests can call it without a socket. */
export function createRequestListener(options: RequestListenerOptions): RequestListener {
  const trustProxy = options.trustProxy === true;
  return async (req, res) => {
    const ctx: RequestContext = {
      method: req.method || "GET",
      path: String(req.url || "").split("?")[0] ?? "",
      ip: clientIp(req, trustProxy),
      readJson: () => readJsonObject(req, res)
    };
    for (const controller of options.controllers) {
      if (await controller.handle(req, res, ctx)) return;
    }
    sendJson(res, 404, { ok: false, error: "khong_thay" });
  };
}

/** Creates the Node HTTP server around the controller chain. */
export function createXeonServer(options: RequestListenerOptions): http.Server {
  return http.createServer(createRequestListener(options));
}
