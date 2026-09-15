/**
 * @file Configuration read from the environment. The ONLY place environment variables are read.
 *
 * Variables come from `bo-nao/.env` (template: `.env.example`) — this repo deploys on its own, so it
 * keeps its own file. Variables already set in the environment win.
 *
 * Variable names are part of the deployment contract (scripts, hosting) and stay as they are:
 *   PORT                   listening port (default 4200)
 *   XEON_THU_MUC_DU_LIEU   data directory for the ledger and signing key (default bo-nao/du-lieu)
 *   XEON_DIA_CHI           public address of Xeon, handed to landings at registration
 *   XEON_ADMIN_MAT_KHAU    admin page password (12+ characters; missing = page disabled)
 *   XEON_BI_MAT_PHIEN      secret signing the admin session cookie (random per start when absent)
 *   XEON_HTTPS=1           session cookie carries the Secure flag
 *   TIN_PROXY=1            trust X-Forwarded-For (nginx / Cloudflare in front)
 *   ANTHROPIC_API_KEY      key for the post writer. Absent = the writing door answers 503 and says so.
 *   XEON_MO_HINH_VIET      model id for the writer (default claude-opus-5)
 *   FACEBOOK_APP_SECRET    App Secret of the developer's Meta app: checks every webhook signature.
 *                          Held ONLY here, never on a merchant's hosting. Absent = /meta/webhook answers 503.
 *   FACEBOOK_VERIFY_TOKEN  the string Meta echoes when the webhook address is registered
 *   META_GRAPH_API_VERSION Graph API version for page checks (default v23.0)
 *   MA_NHAN_TIN            LEGACY, trials only: one shared inbox token; with SHOP_JSON
 *   SHOP_JSON              LEGACY, trials only: {"toprun":{"diaChi":"http://...","ma":"...","nganh":"giay-chay"}}
 */

import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { LegacyShop } from "./brain/brain-service";

/** Loads `file` (dotenv syntax) into `env`. Variables already set win; a missing file adds nothing. Returns how many were added. */
export function loadEnvFile(file: string, env: NodeJS.ProcessEnv): number {
  if (!fs.existsSync(file)) return 0;
  let added = 0;
  for (const [name, value] of Object.entries(parseEnv(fs.readFileSync(file, "utf8")) as Record<string, string>)) {
    if (env[name] === undefined) { env[name] = value; added += 1; }
  }
  return added;
}

export interface XeonConfig {
  port: number;
  dataDirectory: string;
  xeonAddress: string;
  adminPassword: string;
  sessionSecret: string;
  https: boolean;
  trustProxy: boolean;
  /**
   * The AI key, held ONCE on Xeon for every merchant. A shop never buys or types one
   * (decided 14/09/2026), which is why this is not shop configuration on a landing.
   */
  writerApiKey: string;
  writerModel: string;
  /**
   * The developer's Meta app (decided 15/09/2026): one app for every merchant, so its secret and
   * webhook live on Xeon. A merchant connects pages to it and never creates an app of its own.
   */
  metaAppSecret: string;
  metaVerifyToken: string;
  metaGraphVersion: string;
  /** Legacy shared token; empty in licensed mode. */
  sharedInboxToken: string;
  /** Legacy hand-declared merchants; empty in licensed mode. */
  legacyShops: Record<string, LegacyShop>;
}

/** Reads the configuration from `env`. `defaultDataDirectory` is used when the variable is absent. */
export function configFromEnv(env: NodeJS.ProcessEnv, defaultDataDirectory: string): XeonConfig {
  const legacyShops = JSON.parse(env["SHOP_JSON"] || "{}") as Record<string, LegacyShop>;
  return {
    port: Number(env["PORT"] || 4200),
    dataDirectory: String(env["XEON_THU_MUC_DU_LIEU"] || "").trim() || path.resolve(defaultDataDirectory),
    xeonAddress: String(env["XEON_DIA_CHI"] || "").trim(),
    adminPassword: String(env["XEON_ADMIN_MAT_KHAU"] || ""),
    sessionSecret: String(env["XEON_BI_MAT_PHIEN"] || ""),
    https: String(env["XEON_HTTPS"] || "").trim() === "1",
    trustProxy: String(env["TIN_PROXY"] || "").trim() === "1",
    writerApiKey: String(env["ANTHROPIC_API_KEY"] || "").trim(),
    writerModel: String(env["XEON_MO_HINH_VIET"] || "").trim(),
    metaAppSecret: String(env["FACEBOOK_APP_SECRET"] || "").trim(),
    metaVerifyToken: String(env["FACEBOOK_VERIFY_TOKEN"] || "").trim(),
    metaGraphVersion: String(env["META_GRAPH_API_VERSION"] || "").trim(),
    sharedInboxToken: Object.keys(legacyShops).length > 0 ? String(env["MA_NHAN_TIN"] || "").trim() : "",
    legacyShops
  };
}
