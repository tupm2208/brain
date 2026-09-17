/**
 * @file Composition root: builds the whole Xeon application from its parts.
 *
 * `main.ts` reads the environment and calls `buildXeonApp`; tests call it with fakes.
 */

import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { CORE_MODULE_IDS, MODULES, MODULE_IDS } from "@sp/contract";
import { BrainService } from "./brain/brain-service";
import type { XeonConfig } from "./config";
import { AdminController, type ModuleChoice } from "./http/admin-controller";
import { HealthController } from "./http/health-controller";
import { AnthropicTextModel } from "./content/anthropic-text-model";
import { OpenAiCompatChatModel } from "./agent/chat-model";
import { SalesAgent } from "./agent/sales-agent";
import { noTextModel } from "./content/text-model";
import { InboundController } from "./http/inbound-controller";
import { LogController } from "./http/log-controller";
import { MetaController } from "./http/meta-controller";
import { WriteController } from "./http/write-controller";
import { ContentController } from "./http/content-controller";
import { ContentDeskService } from "./content/content-desk";
import { AiController } from "./http/ai-controller";
import { AiDeskService } from "./ai/ai-desk";
import { MeteredChatModel, MeteredTextModel } from "./ai/metered-models";
import { PriceTable } from "./ai/price-table";
import { UsageLedger } from "./ai/usage-ledger";
import { DEFAULT_CHAT_MODEL } from "./agent/chat-model";
import { DEFAULT_WRITER_MODEL } from "./content/anthropic-text-model";
import { LicenseController } from "./http/license-controller";
import { KnowledgeController } from "./http/knowledge-controller";
import { VideoController } from "./http/video-controller";
import { KnowledgeDesk } from "./knowledge/knowledge-desk";
import { KnowledgePackRegistry } from "./knowledge/industry-packs";
import { createXeonServer } from "./http/server";
import { StaticPageStore } from "./http/static-pages";
import { LicenseLedger } from "./license/ledger";
import { LicenseService } from "./license/license-service";
import { SigningKeyStore } from "./license/signing-key";
import { MetaGraphClient } from "./meta/graph-client";
import { MetaForwarder } from "./meta/meta-forwarder";
import { systemClock, type Clock } from "./support/clock";
import { ActivityLog } from "./support/activity-log";
import { consoleLogger, type Logger } from "./support/logger";

/** Directory holding the admin and machine pages. */
export const PAGES_DIRECTORY = path.join(__dirname, "..", "pages");

/** Module choices rendered as checkboxes on the admin page. */
export function moduleChoices(): ModuleChoice[] {
  return MODULE_IDS.map((id) => ({ id, ten: MODULES[id].name, loi: !!MODULES[id].core }));
}

export interface BuildLicenseOptions {
  dataDirectory: string;
  xeonAddress: string;
  logger: Logger;
  clock: Clock;
}

/** Opens the signing key and the ledger in the data directory and wires the licence service. */
export async function buildLicenseService(options: BuildLicenseOptions): Promise<LicenseService> {
  const signingKey = new SigningKeyStore(options.dataDirectory).loadOrCreate();
  if (signingKey.created) options.logger.info(`[license] sinh khoa ky moi ${signingKey.keyId} o ${options.dataDirectory}`);
  const ledger = await LicenseLedger.open({ directory: options.dataDirectory, logger: options.logger });
  return new LicenseService({
    ledger, signingKey, clock: options.clock, logger: options.logger,
    xeonAddress: options.xeonAddress, sellableModules: MODULE_IDS, coreModules: CORE_MODULE_IDS
  });
}

export interface XeonApp {
  server: http.Server;
  license: LicenseService;
  brain: BrainService;
  meta: MetaForwarder;
  activityLog: ActivityLog;
  /** Đ7 token ledger. */
  ledger: UsageLedger;
}

export interface BuildAppOptions {
  config: XeonConfig;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
}

/** Builds the server and its services. Does not start listening. */
export async function buildXeonApp(options: BuildAppOptions): Promise<XeonApp> {
  const { config } = options;
  const logger = options.logger ?? consoleLogger;
  const clock = options.clock ?? systemClock;
  if (!config.xeonAddress) logger.warn("[bo-nao] CHUA co XEON_DIA_CHI — landing dang ky se khong biet goi ve dau.");

  const activityLog = new ActivityLog({ clock });

  const license = await buildLicenseService({ dataDirectory: config.dataDirectory, xeonAddress: config.xeonAddress, logger, clock });
  const legacyMode = Object.keys(config.legacyShops).length > 0;
  if (legacyMode) logger.warn("[bo-nao] SHOP_JSON dang bat — che do CU, chi de chay thu. Ban that: cap key tren trang quan tri.");

  // The sales agent (Sales Desk level 2, moved 16/09/2026). No gateway configured = rule engine only, and it says so.
  // Đ7: every model call is metered — one ledger row per call, priced from the ONE table on Xeon.
  const prices = new PriceTable(config.dataDirectory);
  const ledger = new UsageLedger(config.dataDirectory, prices);
  const chatModel = new MeteredChatModel(
    new OpenAiCompatChatModel({ baseUrl: config.agentChatUrl, apiKey: config.agentChatKey, model: config.agentChatModel, logger }),
    ledger, clock, config.agentChatModel || DEFAULT_CHAT_MODEL);
  const agent = new SalesAgent({ model: chatModel, logger, clock });
  if (!agent.ready()) logger.warn("[agent] CHUA co XEON_AI_CHAT_URL + XEON_AI_CHAT_KEY — bot chi tra loi bang may luat.");
  const agentOptions = { agent, agentTurnsPerHour: config.agentTurnsPerHour, burstWaitMs: config.burstWaitMs, imageWaitMs: config.imageWaitMs };

  const brain = new BrainService(legacyMode
    ? { legacyShops: config.legacyShops, logger, clock, ...agentOptions }
    : { license, logger, clock, ...agentOptions });

  // The developer's Meta app: one webhook for every merchant's pages (decided 15/09/2026).
  const metaReady = config.metaAppSecret !== "" && config.metaVerifyToken !== "";
  if (!metaReady) logger.warn("[meta] CHUA du FACEBOOK_APP_SECRET + FACEBOOK_VERIFY_TOKEN — /meta/webhook se tu choi cho toi khi dien.");
  const meta = new MetaForwarder({ license, clock, logger, dataDirectory: config.dataDirectory, activityLog });

  const pages = new StaticPageStore(PAGES_DIRECTORY);
  const writerModel = config.writerApiKey === "" ? noTextModel : new MeteredTextModel(new AnthropicTextModel({ apiKey: config.writerApiKey, model: config.writerModel, logger }), ledger, clock, config.writerModel || DEFAULT_WRITER_MODEL);

  const server = createXeonServer({
    trustProxy: config.trustProxy,
    activityLog,
    controllers: [
      new HealthController(license, clock, () => {
        let deployId: string | undefined;
        let buildLuc: string | undefined;
        try {
          const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "tmp", "deploy-id.txt"), "utf8").trim().split("\n");
          deployId = raw[0] || undefined;
          buildLuc = raw[1] || undefined;
        } catch { /* chưa build lần nào — bỏ qua */ }
        return {
          meta: { daCauHinh: metaReady, soTrang: license.pageCount(), goiDangCho: meta.pendingCount() },
          ...(deployId ? { deployId, buildLuc } : {})
        };
      }),
      new LogController({ log: activityLog, pages }),
      new LicenseController(license, logger, clock),
      new AdminController({
        license, pages,
        adminPassword: config.adminPassword, sessionSecret: config.sessionSecret, https: config.https,
        moduleChoices: moduleChoices(), clock, logger
      }),
      new InboundController({ brain, license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger, activityLog }),
      new MetaController({
        license, forwarder: meta, graph: new MetaGraphClient({ version: config.metaGraphVersion }),
        appSecret: config.metaAppSecret, verifyToken: config.metaVerifyToken, appId: config.metaAppId, xeonAddress: config.xeonAddress, logger, activityLog
      }),
      // The post writer. Without a key the door still exists and refuses with a sentence the shop
      // can act on — better than a screen where the button silently does nothing.
      new AiController({
        desk: new AiDeskService({ brain, model: chatModel, clock, logger }),
        ledger, prices, license, sharedToken: legacyMode ? config.sharedInboxToken : "", priceEditors: config.priceEditors, clock, logger
      }),
      new WriteController({ model: writerModel, license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger }),
      // Đ8: critique, optimise, trend research — the same writer model, the same inbox-token door.
      new ContentController({ desk: new ContentDeskService({ model: writerModel }), license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger }),
      // Đ9: industry knowledge per shop (the pack follows the licence's industry) and the Video Studio ticket.
      new KnowledgeController({
        desk: new KnowledgeDesk({ dataDirectory: config.dataDirectory, packs: new KnowledgePackRegistry(), model: writerModel, clock }),
        license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger
      }),
      new VideoController({ license, studioAddress: config.videoStudioAddress, clock, logger })
    ]
  });
  return { server, license, brain, meta, activityLog, ledger };
}
