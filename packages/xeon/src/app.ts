/**
 * @file Composition root: builds the whole Xeon application from its parts.
 *
 * `main.ts` reads the environment and calls `buildXeonApp`; tests call it with fakes.
 */

import path from "node:path";
import type http from "node:http";
import { CORE_MODULE_IDS, MODULES, MODULE_IDS } from "@sp/contract";
import { BrainService } from "./brain/brain-service";
import type { XeonConfig } from "./config";
import { AdminController, type ModuleChoice } from "./http/admin-controller";
import { HealthController } from "./http/health-controller";
import { InboundController } from "./http/inbound-controller";
import { LicenseController } from "./http/license-controller";
import { createXeonServer } from "./http/server";
import { StaticPageStore } from "./http/static-pages";
import { LicenseLedger } from "./license/ledger";
import { LicenseService } from "./license/license-service";
import { SigningKeyStore } from "./license/signing-key";
import { systemClock, type Clock } from "./support/clock";
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

  const license = await buildLicenseService({ dataDirectory: config.dataDirectory, xeonAddress: config.xeonAddress, logger, clock });
  const legacyMode = Object.keys(config.legacyShops).length > 0;
  if (legacyMode) logger.warn("[bo-nao] SHOP_JSON dang bat — che do CU, chi de chay thu. Ban that: cap key tren trang quan tri.");

  const brain = new BrainService(legacyMode
    ? { legacyShops: config.legacyShops, logger, clock }
    : { license, logger, clock });

  const server = createXeonServer({
    trustProxy: config.trustProxy,
    controllers: [
      new HealthController(license, clock),
      new LicenseController(license, logger, clock),
      new AdminController({
        license, pages: new StaticPageStore(PAGES_DIRECTORY),
        adminPassword: config.adminPassword, sessionSecret: config.sessionSecret, https: config.https,
        moduleChoices: moduleChoices(), clock, logger
      }),
      new InboundController({ brain, license, sharedToken: legacyMode ? config.sharedInboxToken : "", logger })
    ]
  });
  return { server, license, brain };
}
