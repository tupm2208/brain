/**
 * @file Entry point of the Video Studio service: `node packages/xeon/dist/video/main.js` (Đ9).
 *
 * A separate process from Xeon: it holds only Xeon's PUBLIC key (read from the data directory Xeon
 * writes it to), so a bug in the video tool cannot reach licences or the signing key.
 *
 *   XEON_VIDEO_CONG        listening port (default 4190)
 *   XEON_VIDEO_CONG_CU     address of the video tool (e.g. http://127.0.0.1:4180). Empty = skeleton page.
 *   XEON_THU_MUC_DU_LIEU   Xeon's data directory (holds xeon.ky.pub.pem)
 *   XEON_HTTPS=1           session cookie carries Secure
 * Xeon itself needs XEON_VIDEO_DIA_CHI = the public address of THIS service, to hand it out in tickets.
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../config";
import { PUBLIC_KEY_FILE } from "../license/signing-key";
import { systemClock } from "../support/clock";
import { consoleLogger } from "../support/logger";
import { keyIdOfPublicKey } from "../support/ticket-kit";
import { VideoStudioService } from "./studio-service";

function main(): void {
  const root = path.join(__dirname, "..", "..", "..", "..");
  loadEnvFile(path.join(root, ".env"), process.env);
  const dataDirectory = String(process.env["XEON_THU_MUC_DU_LIEU"] || "").trim() || path.join(root, "du-lieu");
  const pem = fs.readFileSync(path.join(dataDirectory, PUBLIC_KEY_FILE), "utf8");
  const keyId = keyIdOfPublicKey(pem);
  const service = new VideoStudioService({
    publicKeyForKeyId: (id) => (id === keyId ? pem : null),
    clock: systemClock, logger: consoleLogger,
    upstream: String(process.env["XEON_VIDEO_CONG_CU"] || "").trim(),
    https: String(process.env["XEON_HTTPS"] || "").trim() === "1"
  });
  const port = Number(process.env["XEON_VIDEO_CONG"] || 4190);
  service.server().listen(port, () => console.log(`[video-studio] nghe o cong ${port}, khoa ${keyId}`));
}

main();
