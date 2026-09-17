/**
 * @file The two Graph API calls Xeon makes itself: prove a landing holds a page's token, and
 * subscribe the page to the developer app.
 *
 * Xeon never keeps a page token and never sends a customer message — replies still leave through
 * the merchant's landing. A token only passes through here long enough for Meta to say whose it is.
 * Tokens travel in the query string (Graph's convention), so no URL of this file is ever logged.
 */

import type { FetchLike } from "../gateway/landing-gateway";

export const DEFAULT_GRAPH_VERSION = "v23.0";

/** Fields a page must subscribe for the inbox: messages, echoes, buttons, handovers and comments (`feed`). */
export const PAGE_SUBSCRIBED_FIELDS: readonly string[] = ["messages", "message_echoes", "messaging_postbacks", "messaging_handovers", "feed"];

export type GraphResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface MetaGraphClientOptions {
  fetch?: FetchLike | undefined;
  /** `v23.0`; empty = the default. */
  version?: string | undefined;
  timeoutMs?: number | undefined;
}

export class MetaGraphClient {
  private readonly fetchImpl: FetchLike;
  private readonly version: string;
  private readonly timeoutMs: number;

  constructor(options: MetaGraphClientOptions = {}) {
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.version = options.version || DEFAULT_GRAPH_VERSION;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Which page a page token belongs to (`GET /me`). */
  async pageOfToken(token: string): Promise<GraphResult<{ id: string; name: string }>> {
    const r = await this.call("GET", "me?fields=id,name", token);
    if (!r.ok) return r;
    const id = String(r.value["id"] ?? "");
    return id ? { ok: true, value: { id, name: String(r.value["name"] ?? "") } } : { ok: false, message: "Meta khong tra id trang." };
  }

  /** Subscribes the page to the developer app, so Meta delivers its events to the app's webhook. */
  async subscribePage(pageId: string, token: string): Promise<GraphResult<true>> {
    const r = await this.call("POST", `${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${PAGE_SUBSCRIBED_FIELDS.join(",")}`, token);
    if (!r.ok) return r;
    return r.value["success"] === true ? { ok: true, value: true } : { ok: false, message: "Meta khong xac nhan dang ky nhan tin." };
  }

  /** Stops Meta delivering the page's events to the developer app (Đ6 "Ngắt kết nối"). */
  async unsubscribePage(pageId: string, token: string): Promise<GraphResult<true>> {
    const r = await this.call("DELETE", `${encodeURIComponent(pageId)}/subscribed_apps`, token);
    if (!r.ok) return r;
    return r.value["success"] === true ? { ok: true, value: true } : { ok: false, message: "Meta khong xac nhan huy dang ky." };
  }

  /**
   * Facebook Login (Đ6): the one-time `code` the dialog handed back, exchanged with the app secret for
   * a user token. The token lives only for the next call — Xeon keeps neither.
   */
  async exchangeCode(input: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<GraphResult<string>> {
    const query = `oauth/access_token?client_id=${encodeURIComponent(input.appId)}&client_secret=${encodeURIComponent(input.appSecret)}&redirect_uri=${encodeURIComponent(input.redirectUri)}&code=${encodeURIComponent(input.code)}`;
    const r = await this.call("GET", query, "");
    if (!r.ok) return r;
    const token = String(r.value["access_token"] ?? "");
    return token ? { ok: true, value: token } : { ok: false, message: "Meta khong tra token nguoi dung." };
  }

  /** The pages a user manages, each with ITS page token (`/me/accounts`). */
  async pagesOfUser(userToken: string): Promise<GraphResult<{ id: string; name: string; token: string }[]>> {
    const r = await this.call("GET", "me/accounts?fields=id,name,access_token&limit=100", userToken);
    if (!r.ok) return r;
    const data = Array.isArray(r.value["data"]) ? (r.value["data"] as Record<string, unknown>[]) : [];
    return {
      ok: true,
      value: data.map((p) => ({ id: String(p["id"] ?? ""), name: String(p["name"] ?? ""), token: String(p["access_token"] ?? "") })).filter((p) => p.id && p.token)
    };
  }

  private async call(method: string, pathAndQuery: string, token: string): Promise<GraphResult<Record<string, unknown>>> {
    const separator = pathAndQuery.includes("?") ? "&" : "?";
    const url = token === ""
      ? `https://graph.facebook.com/${this.version}/${pathAndQuery}`
      : `https://graph.facebook.com/${this.version}/${pathAndQuery}${separator}access_token=${encodeURIComponent(token)}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { method, signal: abort.signal, headers: {}, body: undefined });
      const parsed = await response.json().catch(() => ({}));
      const body = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
      if (!response.ok) {
        const error = (body["error"] ?? {}) as { message?: unknown };
        return { ok: false, message: String(error.message ?? `HTTP ${response.status}`) };
      }
      return { ok: true, value: body };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}
