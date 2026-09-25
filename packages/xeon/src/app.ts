/**
 * @file Composition root: builds the whole Xeon application from its parts.
 *
 * `main.ts` reads the environment and calls `buildXeonApp`; tests call it with fakes.
 */

import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { CORE_MODULE_IDS, MODULES, MODULE_IDS } from "@sp/contract";
import { packIds, selfCheckPacks } from "@sp/brain";
import { BrainService } from "./brain/brain-service";
import { DiskDossierStore } from "./chan-doan/disk-dossier-store";
import { RETENTION_DAYS, nullDossierStore } from "./chan-doan/turn-dossier";
import type { XeonConfig } from "./config";
import { AdminController, type ModuleChoice } from "./http/admin-controller";
import { HealthController } from "./http/health-controller";
import { AnthropicTextModel } from "./content/anthropic-text-model";
import { OpenAiCompatChatModel } from "./agent/chat-model";
import { SalesAgent } from "./agent/sales-agent";
import { ContextAnalyzer } from "./brain/context-analyzer";
import { DraftWriter } from "./brain/draft-writer";
import { CatalogVerifier } from "./brain/catalog-verifier";
import { GatewayBreaker } from "./agent/gateway-breaker";
import type { ImageFetch } from "./brain/image-intake";
import { noTextModel } from "./content/text-model";
import { InboundController } from "./http/inbound-controller";
import { LogController } from "./http/log-controller";
import { LandingLogController } from "./http/landing-log-controller";
import { VideoScriptController } from "./http/video-script-controller";
import { VideoScriptDesk } from "./video/script-desk";
import { LandingLogStore } from "./chan-doan/landing-log-store";
import { MetaController } from "./http/meta-controller";
import { WriteController } from "./http/write-controller";
import { ContentController } from "./http/content-controller";
import { ContentDeskService } from "./content/content-desk";
import { ProfileTranslator } from "./content/profile-translator";
import { AiController } from "./http/ai-controller";
import { AiDeskService } from "./ai/ai-desk";
import { MeteredChatModel, MeteredTextModel } from "./ai/metered-models";
import { PriceTable } from "./ai/price-table";
import { UsageLedger } from "./ai/usage-ledger";
import { DEFAULT_CHAT_MODEL } from "./agent/chat-model";
import { DEFAULT_WRITER_MODEL } from "./content/anthropic-text-model";
import { LicenseController } from "./http/license-controller";
import { KnowledgeController } from "./http/knowledge-controller";
import { SpxController } from "./http/spx-controller";
import { VideoController } from "./http/video-controller";
import { ProductLibraryController } from "./http/product-library-controller";
import { ProductLibrary } from "./product-library/product-library";
import { ImageJobQueue } from "./product-library/image-job-queue";
import { ImageToolDispatcher } from "./product-library/image-tool-dispatcher";
import { ImageWorkerController } from "./http/image-worker-controller";
import { KnowledgeDesk } from "./knowledge/knowledge-desk";
import { installIndustryPacks } from "./knowledge/industry-files";
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

/** How often to knock again while codes are waiting. A minute is far below the cost of a scrape. */
const IMAGE_TOOL_SWEEP_MS = 60_000;

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
  /** Knocks on the image tool behind its tunnel (21/09/2026). Off unless both env vars are set. */
  imageTool: ImageToolDispatcher;
  /** Stops the re-knock timer; tests and a clean shutdown call it. */
  stopImageToolSweep: () => void;
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

  // The industries come from `nganh/<id>/`, read before anything can ask for a pack. `selfCheckPacks`
  // parses and validates every one of them NOW: a folder edited by hand must fail at start-up with
  // the field named, not at eleven at night on a customer's message.
  const industryDirectory = installIndustryPacks(config.industryDirectory);
  selfCheckPacks();
  const knowledgePacks = new KnowledgePackRegistry(industryDirectory);
  logger.info(`[nganh] doc tu ${industryDirectory}: ${packIds().join(", ") || "(khong co nganh nao)"}`);

  const license = await buildLicenseService({ dataDirectory: config.dataDirectory, xeonAddress: config.xeonAddress, logger, clock });
  const legacyMode = Object.keys(config.legacyShops).length > 0;
  if (legacyMode) logger.warn("[bo-nao] SHOP_JSON dang bat — che do CU, chi de chay thu. Ban that: cap key tren trang quan tri.");

  // The sales agent (Sales Desk level 2, moved 16/09/2026). No gateway configured = rule engine only, and it says so.
  // Đ7: every model call is metered — one ledger row per call, priced from the ONE table on Xeon.
  const prices = new PriceTable(config.dataDirectory);
  const productLibrary = new ProductLibrary(config.dataDirectory, () => clock.now());
  const imageJobs = new ImageJobQueue(config.dataDirectory, () => clock.now());
  // 21/09/2026: Xeon knocks on the image tool instead of the tool asking for work. A knock can be
  // lost (tunnel restart, tool down), so a timer knocks again while anything is waiting — otherwise
  // one dropped call strands a code until somebody happens to enqueue another one.
  const imageTool = new ImageToolDispatcher({ url: config.imageToolUrl, key: config.imageToolKey, queue: imageJobs, logger });
  if (!imageTool.ready() && config.imageToolUrl !== "") logger.warn("[image-tool] co XEON_IMAGE_TOOL_DIA_CHI nhung thieu XEON_IMAGE_TOOL_MA — cua mo ra Internet, khong day viec khi chua co ma.");
  const ledger = new UsageLedger(config.dataDirectory, prices);
  // The gateway breaker (25/09/2026) sits between every model seat and the gateway: three transient
  // failures in five minutes open it for ten, and the turns go scripts / rule engine meanwhile.
  const breaker = new GatewayBreaker({ clock, logger, threshold: config.breakerErrors, openMs: config.breakerOpenMs });
  const chatModel = breaker.wrap(new MeteredChatModel(
    new OpenAiCompatChatModel({ baseUrl: config.agentChatUrl, apiKey: config.agentChatKey, model: config.agentChatModel, logger }),
    ledger, clock, config.agentChatModel || DEFAULT_CHAT_MODEL));
  const agent = new SalesAgent({ model: chatModel, logger, clock });
  if (!agent.ready()) logger.warn("[agent] CHUA co XEON_AI_CHAT_URL + XEON_AI_CHAT_KEY — bot chi tra loi bang kich ban va may luat.");
  // `vision`: the same metered model reads a photo the customer sent (Đ7, 21/09/2026).
  // `analyzer` / `writer` (25/09/2026): Desk's LLM#1 and LLM#3 on the same metered model — the
  // ledger tells them apart by agent (`context_analysis`, `draft_l3`).
  const imageFetch: ImageFetch = (url, init) => fetch(url, { signal: init.signal, redirect: "follow" });
  const agentOptions = {
    agent, vision: chatModel, imageFetch, breaker,
    analyzer: new ContextAnalyzer({ model: chatModel, logger, timeoutMs: config.analysisTimeoutMs }),
    writer: new DraftWriter({ model: chatModel, logger }),
    verifier: new CatalogVerifier({ model: chatModel, logger }),
    agentTurnsPerHour: config.agentTurnsPerHour, burstWaitMs: config.burstWaitMs, imageWaitMs: config.imageWaitMs
  };

  // TURN DOSSIERS (21/09/2026): off unless a folder is named. See `KE-HOACH-NHAT-KY-CHAN-DOAN.md`.
  // They hold some of the customer's own data, and they must NEVER be served over HTTP — `/nhat-ky`
  // is public and unauthenticated. They are files, read with the `chan-doan` tool.
  const retentionDays = {
    ...(config.dossierDaysOrdinary > 0 ? { thuong: config.dossierDaysOrdinary } : {}),
    ...(config.dossierDaysBroken > 0 ? { hong: config.dossierDaysBroken } : {})
  };
  const dossier = config.dossierDirectory === ""
    ? nullDossierStore
    : new DiskDossierStore({ root: path.resolve(config.dossierDirectory), clock, logger, retentionDays });
  if (config.dossierDirectory !== "") logger.info(`[ho-so] ho so luot BAT — ghi vao ${path.resolve(config.dossierDirectory)} (giu ${retentionDays.thuong ?? RETENTION_DAYS.thuong}/${retentionDays.hong ?? RETENTION_DAYS.hong} ngay)`);

  // Where the landings' pushed log lines land. Off unless configured: a shop's landing then keeps
  // its lines to its own disk and the push door says 503 rather than swallowing them.
  const landingLogs = config.landingLogDirectory === "" ? null : new LandingLogStore({
    root: path.resolve(config.landingLogDirectory), clock, logger,
    ...(config.landingLogDays > 0 ? { keepDays: config.landingLogDays } : {})
  });
  if (landingLogs !== null) logger.info(`[nhat-ky] nhan nhat ky landing vao ${path.resolve(config.landingLogDirectory)}`);

  const brain = new BrainService(legacyMode
    ? { legacyShops: config.legacyShops, logger, clock, dossier, ...agentOptions }
    : { license, logger, clock, dossier, ...agentOptions });

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
      // The landings push their own logs here. Off unless a folder is named.
      new LandingLogController({ store: landingLogs, license, logger }),
      // Đ9 (21/09/2026): the landing asks for the video script here; the shop's own machine renders.
      new VideoScriptController({ desk: new VideoScriptDesk({ model: chatModel, logger, clock }), license, logger, packs: knowledgePacks }),
      new LicenseController(license, logger, clock),
      new AdminController({
        license, pages,
        adminPassword: config.adminPassword, sessionSecret: config.sessionSecret, https: config.https,
        moduleChoices: moduleChoices(),
        industryChoices: packIds().map((id) => ({ id, ten: knowledgePacks.get(id).name })),
        clock, logger, productLibrary, imageJobs
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
      new ContentController({ desk: new ContentDeskService({ model: writerModel }), translator: new ProfileTranslator({ model: writerModel }), license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger }),
      // Đ9: industry knowledge per shop (the pack follows the licence's industry) and the Video Studio ticket.
      new KnowledgeController({
        desk: new KnowledgeDesk({ dataDirectory: config.dataDirectory, packs: knowledgePacks, model: writerModel, clock }),
        license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger
      }),
      new ProductLibraryController({ library: productLibrary, queue: imageJobs, dispatcher: imageTool, license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger }),
      new ImageWorkerController({ queue: imageJobs, library: productLibrary, key: config.imageWorkerKey }),
      new VideoController({ license, studioAddress: config.videoStudioAddress, clock, logger }),
      // 25/09/2026: the developer's SPX app signs every landing's SPX request; the secret stays here.
      new SpxController({ license, appId: config.spxAppId, appSecret: config.spxAppSecret, clock, logger })
    ]
  });
  const imageToolSweep = imageTool.ready() ? setInterval(() => void imageTool.sweep(), IMAGE_TOOL_SWEEP_MS) : null;
  imageToolSweep?.unref();
  return { server, license, brain, meta, activityLog, ledger, imageTool, stopImageToolSweep: () => { if (imageToolSweep) clearInterval(imageToolSweep); } };
}
