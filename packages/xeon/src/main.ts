/**
 * @file Process entry point: `node packages/xeon/dist/main.js`.
 */

import path from "node:path";
import { buildXeonApp } from "./app";
import { configFromEnv } from "./config";
import { consoleLogger } from "./support/logger";

async function main(): Promise<void> {
  // Default data directory: `bo-nao/du-lieu`, three levels up from `packages/xeon/dist`.
  const config = configFromEnv(process.env, path.join(__dirname, "..", "..", "..", "du-lieu"));
  const app = await buildXeonApp({ config, logger: consoleLogger });
  app.server.listen(config.port, () => {
    console.log(`[bo-nao] nghe o cong ${config.port}, ${app.license.activeShopCount()} shop co key, khoa ky ${app.license.publicKey().keyId}`);
  });
}

main().catch((error: unknown) => {
  console.error("[bo-nao] khong khoi dong duoc:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
