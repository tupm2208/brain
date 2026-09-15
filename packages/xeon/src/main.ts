/**
 * @file Process entry point: `node packages/xeon/dist/main.js`.
 */

import path from "node:path";
import { buildXeonApp } from "./app";
import { configFromEnv, loadEnvFile } from "./config";
import { consoleLogger } from "./support/logger";

async function main(): Promise<void> {
  // The repo root `bo-nao/`, three levels up from `packages/xeon/dist`: holds `.env` and the default data directory.
  const root = path.join(__dirname, "..", "..", "..");
  const envFile = path.join(root, ".env");
  const added = loadEnvFile(envFile, process.env);
  if (added > 0) console.log(`[bo-nao] doc ${added} bien tu ${envFile}`);
  const config = configFromEnv(process.env, path.join(root, "du-lieu"));
  const app = await buildXeonApp({ config, logger: consoleLogger });
  app.server.listen(config.port, () => {
    console.log(`[bo-nao] nghe o cong ${config.port}, ${app.license.activeShopCount()} shop co key, khoa ky ${app.license.publicKey().keyId}`);
  });
}

main().catch((error: unknown) => {
  console.error("[bo-nao] khong khoi dong duoc:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
