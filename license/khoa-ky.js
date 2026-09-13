// KHOA KY CUA XEON — goc tin cay duy nhat cua ca he (anh Dung chot 14/09/2026).
//
// Xeon ky "ve may" cho OMI va ve dich vu cho chinh bo nao. Landing chi giu KHOA CONG de soi
// chu ky; khong ai ngoai Xeon cam khoa rieng. Ed25519 co san trong node:crypto: khong them
// thu vien, chu ky 64 byte, khong co tham so de cau hinh sai.
//
// Khoa rieng nam trong tep 0600 o thu muc du lieu cua Xeon. Mat khoa rieng ma van con so
// license thi moi ve dang song van hop le toi khi het han (7 gio), sau do phai ky lai bang khoa
// moi — landing nhan khoa cong moi qua duong dang ky lai. Doi khoa la viec cua nguoi, khong
// tu dong.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TEP_KHOA_RIENG = "xeon.ky.key.pem";
const TEP_KHOA_CONG = "xeon.ky.pub.pem";

/** Ma nhan dien khoa: `ky-` + 16 ky tu base64url cua SHA-256(SPKI). Bam KHOA nen on dinh. */
function keyIdCuaKhoaCong(khoaCongPem) {
  const spki = crypto.createPublicKey(khoaCongPem).export({ type: "spki", format: "der" });
  return `ky-${crypto.createHash("sha256").update(spki).digest("base64url").slice(0, 16)}`;
}

function sinhKhoaKy() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const khoaRiengPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const khoaCongPem = publicKey.export({ type: "spki", format: "pem" });
  return { khoaRiengPem, khoaCongPem, keyId: keyIdCuaKhoaCong(khoaCongPem) };
}

/**
 * Nap khoa tu thu muc; chua co thi sinh moi va ghi xuong. Tra { khoaRiengPem, khoaCongPem, keyId }.
 * Co khoa rieng ma khong co khoa cong thi suy ra tu khoa rieng (khoa cong chi de tien in ra).
 */
function napHoacSinhKhoaKy(thuMuc) {
  fs.mkdirSync(thuMuc, { recursive: true });
  const duongRieng = path.join(thuMuc, TEP_KHOA_RIENG);
  const duongCong = path.join(thuMuc, TEP_KHOA_CONG);
  if (fs.existsSync(duongRieng)) {
    const khoaRiengPem = fs.readFileSync(duongRieng, "utf8");
    const khoaCongPem = crypto.createPublicKey(crypto.createPrivateKey(khoaRiengPem))
      .export({ type: "spki", format: "pem" });
    if (!fs.existsSync(duongCong)) fs.writeFileSync(duongCong, khoaCongPem, "utf8");
    return { khoaRiengPem, khoaCongPem, keyId: keyIdCuaKhoaCong(khoaCongPem), moiSinh: false };
  }
  const k = sinhKhoaKy();
  fs.writeFileSync(duongRieng, k.khoaRiengPem, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(duongCong, k.khoaCongPem, "utf8");
  return { ...k, moiSinh: true };
}

/** Ky mot chuoi UTF-8, tra base64url. */
function kyChuoi(khoaRiengPem, chuoi) {
  return crypto.sign(null, Buffer.from(chuoi, "utf8"), crypto.createPrivateKey(khoaRiengPem)).toString("base64url");
}

/** Kiem chu ky. Khoa hong hay chu ky hong deu la SAI, khong nem. */
function kiemChuKy(khoaCongPem, chuoi, chuKyB64url) {
  try {
    return crypto.verify(
      null, Buffer.from(chuoi, "utf8"), crypto.createPublicKey(khoaCongPem), Buffer.from(String(chuKyB64url), "base64url")
    );
  } catch {
    return false;
  }
}

module.exports = { napHoacSinhKhoaKy, sinhKhoaKy, keyIdCuaKhoaCong, kyChuoi, kiemChuKy, TEP_KHOA_RIENG, TEP_KHOA_CONG };
