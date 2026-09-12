// KHOA MAY — thu chung minh "toi la OMI cua shop X, tren may Y".
//
// Xeon cap khoa luc kich hoat; OMI ky khung `hello` bang no. Ai bat duoc mot khung hello
// (nhat ky, may trung gian, mot ban OMI bi lay trom) cung khong phat lai duoc, vi chuoi
// ky co `nonce` cua khung `challenge` ma Xeon vua phat — moi lan noi mot nonce khac.
//
// Ed25519, co san trong `node:crypto`: khong them thu vien nao, chu ky ngan (64 byte),
// khong co tham so de cau hinh sai. Khoa rieng KHONG BAO GIO roi khoi may shop; Xeon chi
// giu khoa cong khai theo `keyId`.

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import type { MachineId, TenantId } from "./ids";

export interface CapKhoaMay {
  keyId: string;
  /** PEM PKCS#8 — chi luu tren may shop. */
  privateKeyPem: string;
  /** PEM SPKI — Xeon luu theo keyId. */
  publicKeyPem: string;
}

/** Sinh mot cap khoa may moi. Goi luc kich hoat, MOT lan cho moi may. */
export function sinhKhoaMay(): CapKhoaMay {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    keyId: `k-${randomBytes(8).toString("hex")}`,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string
  };
}

/**
 * Chuoi duoc ky trong khung `hello`. Ghi o MOT cho de hai dau day khong troi khoi nhau:
 * `${nonce}.${tenant}.${machine}.${contract}` — dung nhu chu thich trong `link.ts`.
 */
export function chuoiDeKy(args: {
  nonce: string; tenant: TenantId; machine: MachineId; contract: string;
}): string {
  return `${args.nonce}.${args.tenant}.${args.machine}.${args.contract}`;
}

/** Ky bang khoa rieng, tra ve base64. */
export function kyChuoi(privateKeyPem: string, chuoi: string): string {
  return sign(null, Buffer.from(chuoi, "utf8"), createPrivateKey(privateKeyPem)).toString("base64");
}

/** Kiem chu ky bang khoa cong khai. Khoa hong hay chu ky hong deu la SAI, khong nem. */
export function kiemChuKy(publicKeyPem: string, chuoi: string, chuKyB64: string): boolean {
  try {
    return verify(
      null, Buffer.from(chuoi, "utf8"), createPublicKey(publicKeyPem), Buffer.from(chuKyB64, "base64")
    );
  } catch {
    return false;
  }
}

/** Nonce cho khung `challenge`: 32 byte ngau nhien, hex. */
export function sinhNonce(): string {
  return randomBytes(32).toString("hex");
}
