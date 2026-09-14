/**
 * @file Configuration read from the environment. The ONLY place environment variables are read.
 *
 * Variable names are part of the deployment contract (scripts, hosting) and stay as they are:
 *   PORT                   listening port (default 4200)
 *   XEON_THU_MUC_DU_LIEU   data directory for the ledger and signing key (default bo-nao/du-lieu)
 *   XEON_DIA_CHI           public address of Xeon, handed to landings at registration
 *   XEON_ADMIN_MAT_KHAU    admin page password (12+ characters; missing = page disabled)
 *   XEON_BI_MAT_PHIEN      secret signing the admin session cookie (random per start when absent)
 *   XEON_HTTPS=1           session cookie carries the Secure flag
 *   TIN_PROXY=1            trust X-Forwarded-For (nginx / Cloudflare in front)
 *   MA_NHAN_TIN            LEGACY, trials only: one shared inbox token; with SHOP_JSON
 *   SHOP_JSON              LEGACY, trials only: {"toprun":{"diaChi":"http://...","ma":"...","nganh":"giay-chay"}}
 */

import path from "node:path";
import type { LegacyShop } from "./brain/brain-service";

export interface XeonConfig {
  port: number;
  dataDirectory: string;
  xeonAddress: string;
  adminPassword: string;
  sessionSecret: string;
  https: boolean;
  trustProxy: boolean;
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
    sharedInboxToken: Object.keys(legacyShops).length > 0 ? String(env["MA_NHAN_TIN"] || "").trim() : "",
    legacyShops
  };
}
