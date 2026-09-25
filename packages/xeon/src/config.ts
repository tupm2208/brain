/**
 * @file Configuration read from the environment. The ONLY place environment variables are read.
 *
 * Variables come from `bo-nao/.env` (template: `.env.example`) — this repo deploys on its own, so it
 * keeps its own file. Variables already set in the environment win.
 *
 * Variable names are part of the deployment contract (scripts, hosting) and stay as they are:
 *   PORT                   listening port (default 4200)
 *   XEON_THU_MUC_DU_LIEU   data directory for the ledger and signing key (default bo-nao/du-lieu)
 *   XEON_THU_MUC_NGANH     industry folder: one sub-folder of JSON per industry (default bo-nao/nganh)
 *   XEON_DIA_CHI           public address of Xeon, handed to landings at registration
 *   XEON_ADMIN_MAT_KHAU    admin page password (12+ characters; missing = page disabled)
 *   XEON_BI_MAT_PHIEN      secret signing the admin session cookie (random per start when absent)
 *   XEON_HTTPS=1           session cookie carries the Secure flag
 *   TIN_PROXY=1            trust X-Forwarded-For (nginx / Cloudflare in front)
 *   ANTHROPIC_API_KEY      key for the post writer. Absent = the writing door answers 503 and says so.
 *   XEON_MO_HINH_VIET      model id for the writer (default claude-opus-5)
 *   XEON_AI_CHAT_URL       OpenAI-compatible base URL for the SALES AGENT (e.g. https://ai.elevenvoice.site/v1).
 *                          Absent (or XEON_AI_CHAT_KEY absent) = no agent: the rule engine answers alone.
 *   XEON_AI_CHAT_KEY       key for that gateway
 *   XEON_AI_CHAT_MODEL     agent model (default ag/gemini-3.7-flash-low — Sales Desk's level-2 model)
 *   XEON_AI_LUOT_GIO       agent turns per merchant per hour (default 120)
 *   XEON_GOM_TIN_MS        wait after a customer message to gather the burst (default 6000; 0 = off)
 *   XEON_CHO_ANH_MS        extra wait when the message has / points at a photo (default 7000)
 *   XEON_CAU_DAO_LOI       gateway breaker: transient AI failures within 5 minutes that open it (default 3)
 *   XEON_CAU_DAO_MO_MS     how long the breaker stays open, ms (default 600000 = 10 minutes)
 *   XEON_AI_PHAN_TICH_MS   LLM#1 (context analysis) ceiling, ms (default 15000)
 *   FACEBOOK_APP_SECRET    App Secret of the developer's Meta app: checks every webhook signature.
 *                          Held ONLY here, never on a merchant's hosting. Absent = /meta/webhook answers 503.
 *   FACEBOOK_VERIFY_TOKEN  the string Meta echoes when the webhook address is registered
 *   FACEBOOK_APP_ID        App ID of the same app: the Facebook Login dialog (Đ6). Absent = /meta/dang-nhap answers 503.
 *   META_GRAPH_API_VERSION Graph API version for page checks (default v23.0)
 *   SPX_APP_ID / SPX_APP_SECRET  the developer's SPX Open Platform app (25/09/2026): Xeon signs every
 *                          landing's SPX request (`POST /spx/ky`); the secret never goes to a merchant's
 *                          hosting. The merchant only types its own User ID + Secret Key. Absent = 503.
 *   XEON_VIDEO_DIA_CHI     public address of the Video Studio service (Đ9; `dist/video/main.js`). Empty = /video/ve answers 503.
 *   XEON_SHOP_SUA_BANG_GIA shops (comma list) allowed to edit the shared AI price table from their OMI (Đ7). Empty = nobody.
 *   XEON_HO_SO_THU_MUC    folder for TURN DOSSIERS (21/09/2026), e.g. bo-nao/logs/ho-so. EMPTY = OFF,
 *                         nothing is written. A dossier keeps some of the customer's own data so the
 *                         bug can be reproduced — switch it on deliberately, and see
 *                         KE-HOACH-NHAT-KY-CHAN-DOAN.md for what is kept and for how long.
 *   XEON_HO_SO_NGAY_THUONG / XEON_HO_SO_NGAY_HONG
 *                         days a dossier is kept (default 7 for an ordinary turn, 30 for one that went wrong)
 *   XEON_NHAT_KY_THU_MUC  folder for the LANDINGS' pushed log lines (POST /nhat-ky/gom). Empty = that
 *                         door answers 503. Infrastructure only: paths, statuses, timings, trace ids.
 *   XEON_NHAT_KY_NGAY     days those lines are kept (default 14)
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
  /** Where the industry folders are read from. Empty = the folder shipped next to the code. */
  industryDirectory: string;
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
  /** The sales agent's gateway, key held once on Xeon like the writer's. Empty = agent off. */
  agentChatUrl: string;
  agentChatKey: string;
  agentChatModel: string;
  agentTurnsPerHour: number;
  burstWaitMs: number;
  imageWaitMs: number;
  /** The gateway breaker (25/09/2026): transient failures within five minutes that open it, and how long it stays open. */
  breakerErrors: number;
  breakerOpenMs: number;
  /** LLM#1's own ceiling in ms (`XEON_AI_PHAN_TICH_MS`, default 15000). */
  analysisTimeoutMs: number;
  /**
   * The developer's Meta app (decided 15/09/2026): one app for every merchant, so its secret and
   * webhook live on Xeon. A merchant connects pages to it and never creates an app of its own.
   */
  metaAppSecret: string;
  metaVerifyToken: string;
  /** App ID of the same app — the Facebook Login dialog (Đ6). */
  metaAppId: string;
  metaGraphVersion: string;
  /** Public address of the separate Video Studio service (Đ9). Empty = not running. */
  videoStudioAddress: string;
  /** The developer's SPX app (25/09/2026): Xeon signs SPX requests for every landing. */
  spxAppId: string;
  spxAppSecret: string;
  /** Shops that may change the one AI price table every shop reads (Đ7). */
  priceEditors: string[];
  imageWorkerKey: string;
  /**
   * The image tool behind its Cloudflare tunnel (21/09/2026). Xeon knocks here when a code needs
   * scraping. Both empty = the tool is expected to ask for work the old way instead.
   */
  imageToolUrl: string;
  imageToolKey: string;
  /**
   * Where turn dossiers are kept (21/09/2026). Empty = OFF and nothing is written: a dossier holds
   * some of the customer's own data, so it is switched on deliberately, never by accident.
   */
  dossierDirectory: string;
  /** Days a dossier is kept, by class; 0 keeps the defaults (7 ordinary / 30 gone wrong). */
  dossierDaysOrdinary: number;
  dossierDaysBroken: number;
  /**
   * Where the LANDINGS' pushed log lines are kept (21/09/2026). Empty = the push door answers 503
   * and says so. Infrastructure lines only — the customer's words never travel this way.
   */
  landingLogDirectory: string;
  /** Days those lines are kept (default 14). */
  landingLogDays: number;
  /** Legacy shared token; empty in licensed mode. */
  sharedInboxToken: string;
  /** Legacy hand-declared merchants; empty in licensed mode. */
  legacyShops: Record<string, LegacyShop>;
}

/** A non-negative number from the environment; `fallback` when absent or not a number. */
function numberOr(raw: string | undefined, fallback: number): number {
  const value = Number(String(raw ?? "").trim());
  return raw === undefined || String(raw).trim() === "" || !Number.isFinite(value) || value < 0 ? fallback : value;
}

/** Reads the configuration from `env`. `defaultDataDirectory` is used when the variable is absent. */
export function configFromEnv(env: NodeJS.ProcessEnv, defaultDataDirectory: string): XeonConfig {
  const legacyShops = JSON.parse(env["SHOP_JSON"] || "{}") as Record<string, LegacyShop>;
  return {
    port: Number(env["PORT"] || 4200),
    dataDirectory: String(env["XEON_THU_MUC_DU_LIEU"] || "").trim() || path.resolve(defaultDataDirectory),
    industryDirectory: String(env["XEON_THU_MUC_NGANH"] || "").trim(),
    xeonAddress: String(env["XEON_DIA_CHI"] || "").trim(),
    adminPassword: String(env["XEON_ADMIN_MAT_KHAU"] || ""),
    sessionSecret: String(env["XEON_BI_MAT_PHIEN"] || ""),
    https: String(env["XEON_HTTPS"] || "").trim() === "1",
    trustProxy: String(env["TIN_PROXY"] || "").trim() === "1",
    writerApiKey: String(env["ANTHROPIC_API_KEY"] || "").trim(),
    writerModel: String(env["XEON_MO_HINH_VIET"] || "").trim(),
    agentChatUrl: String(env["XEON_AI_CHAT_URL"] || "").trim(),
    agentChatKey: String(env["XEON_AI_CHAT_KEY"] || "").trim(),
    agentChatModel: String(env["XEON_AI_CHAT_MODEL"] || "").trim(),
    agentTurnsPerHour: Number(env["XEON_AI_LUOT_GIO"] || 120) || 120,
    burstWaitMs: numberOr(env["XEON_GOM_TIN_MS"], 6000),
    imageWaitMs: numberOr(env["XEON_CHO_ANH_MS"], 7000),
    breakerErrors: numberOr(env["XEON_CAU_DAO_LOI"], 3),
    breakerOpenMs: numberOr(env["XEON_CAU_DAO_MO_MS"], 10 * 60_000),
    analysisTimeoutMs: numberOr(env["XEON_AI_PHAN_TICH_MS"], 15_000),
    metaAppSecret: String(env["FACEBOOK_APP_SECRET"] || "").trim(),
    metaVerifyToken: String(env["FACEBOOK_VERIFY_TOKEN"] || "").trim(),
    metaAppId: String(env["FACEBOOK_APP_ID"] || "").trim(),
    metaGraphVersion: String(env["META_GRAPH_API_VERSION"] || "").trim(),
    videoStudioAddress: String(env["XEON_VIDEO_DIA_CHI"] || "").trim(),
    spxAppId: String(env["SPX_APP_ID"] || "").trim(),
    spxAppSecret: String(env["SPX_APP_SECRET"] || "").trim(),
    priceEditors: String(env["XEON_SHOP_SUA_BANG_GIA"] || "").split(",").map((s) => s.trim()).filter(Boolean),
    imageWorkerKey: String(env["XEON_IMAGE_WORKER_KEY"] || "").trim(),
    imageToolUrl: String(env["XEON_IMAGE_TOOL_DIA_CHI"] || "").trim(),
    imageToolKey: String(env["XEON_IMAGE_TOOL_MA"] || "").trim(),
    dossierDirectory: String(env["XEON_HO_SO_THU_MUC"] || "").trim(),
    dossierDaysOrdinary: numberOr(env["XEON_HO_SO_NGAY_THUONG"], 0),
    dossierDaysBroken: numberOr(env["XEON_HO_SO_NGAY_HONG"], 0),
    landingLogDirectory: String(env["XEON_NHAT_KY_THU_MUC"] || "").trim(),
    landingLogDays: numberOr(env["XEON_NHAT_KY_NGAY"], 0),
    sharedInboxToken: Object.keys(legacyShops).length > 0 ? String(env["MA_NHAN_TIN"] || "").trim() : "",
    legacyShops
  };
}
