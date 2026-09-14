/**
 * @file Xeon's signing key: the single root of trust of the whole system (decided 14/09/2026).
 *
 * Xeon signs machine tickets for the console and service tickets for the brain itself. Landings
 * only hold the PUBLIC key to verify signatures; nobody but Xeon holds the private key.
 *
 * The private key lives in a 0600 file in Xeon's data directory. Losing it while the ledger
 * survives means every live ticket stays valid until it expires (7 hours), after which tickets
 * must be signed with a new key and landings receive the new public key by re-registering.
 * Rotating the key is a human decision, never automatic.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateSigningKey, keyIdOfPublicKey, type SigningKeyPair } from "../support/ticket-kit";

/** File names are part of the on-disk layout of existing installations; do not rename. */
export const PRIVATE_KEY_FILE = "xeon.ky.key.pem";
export const PUBLIC_KEY_FILE = "xeon.ky.pub.pem";

export interface LoadedSigningKey extends SigningKeyPair {
  /** True when the key was generated on this call (first start). */
  created: boolean;
}

/** Loads the signing key from a directory, generating and persisting one on first use. */
export class SigningKeyStore {
  constructor(private readonly directory: string) {}

  loadOrCreate(): LoadedSigningKey {
    fs.mkdirSync(this.directory, { recursive: true });
    const privatePath = path.join(this.directory, PRIVATE_KEY_FILE);
    const publicPath = path.join(this.directory, PUBLIC_KEY_FILE);
    if (fs.existsSync(privatePath)) {
      const khoaRiengPem = fs.readFileSync(privatePath, "utf8");
      // The public key is derived from the private one; the .pub file only exists for convenience.
      const khoaCongPem = crypto.createPublicKey(crypto.createPrivateKey(khoaRiengPem))
        .export({ type: "spki", format: "pem" }) as string;
      if (!fs.existsSync(publicPath)) fs.writeFileSync(publicPath, khoaCongPem, "utf8");
      return { khoaRiengPem, khoaCongPem, keyId: keyIdOfPublicKey(khoaCongPem), created: false };
    }
    const pair = generateSigningKey();
    fs.writeFileSync(privatePath, pair.khoaRiengPem, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(publicPath, pair.khoaCongPem, "utf8");
    return { ...pair, created: true };
  }
}
