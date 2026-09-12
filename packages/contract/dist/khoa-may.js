"use strict";
// KHOA MAY — thu chung minh "toi la OMI cua shop X, tren may Y".
//
// Xeon cap khoa luc kich hoat; OMI ky khung `hello` bang no. Ai bat duoc mot khung hello
// (nhat ky, may trung gian, mot ban OMI bi lay trom) cung khong phat lai duoc, vi chuoi
// ky co `nonce` cua khung `challenge` ma Xeon vua phat — moi lan noi mot nonce khac.
//
// Ed25519, co san trong `node:crypto`: khong them thu vien nao, chu ky ngan (64 byte),
// khong co tham so de cau hinh sai. Khoa rieng KHONG BAO GIO roi khoi may shop; Xeon chi
// giu khoa cong khai theo `keyId`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sinhKhoaMay = sinhKhoaMay;
exports.chuoiDeKy = chuoiDeKy;
exports.kyChuoi = kyChuoi;
exports.kiemChuKy = kiemChuKy;
exports.sinhNonce = sinhNonce;
const node_crypto_1 = require("node:crypto");
/** Sinh mot cap khoa may moi. Goi luc kich hoat, MOT lan cho moi may. */
function sinhKhoaMay() {
    const { publicKey, privateKey } = (0, node_crypto_1.generateKeyPairSync)("ed25519");
    return {
        keyId: `k-${(0, node_crypto_1.randomBytes)(8).toString("hex")}`,
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" })
    };
}
/**
 * Chuoi duoc ky trong khung `hello`. Ghi o MOT cho de hai dau day khong troi khoi nhau:
 * `${nonce}.${tenant}.${machine}.${contract}` — dung nhu chu thich trong `link.ts`.
 */
function chuoiDeKy(args) {
    return `${args.nonce}.${args.tenant}.${args.machine}.${args.contract}`;
}
/** Ky bang khoa rieng, tra ve base64. */
function kyChuoi(privateKeyPem, chuoi) {
    return (0, node_crypto_1.sign)(null, Buffer.from(chuoi, "utf8"), (0, node_crypto_1.createPrivateKey)(privateKeyPem)).toString("base64");
}
/** Kiem chu ky bang khoa cong khai. Khoa hong hay chu ky hong deu la SAI, khong nem. */
function kiemChuKy(publicKeyPem, chuoi, chuKyB64) {
    try {
        return (0, node_crypto_1.verify)(null, Buffer.from(chuoi, "utf8"), (0, node_crypto_1.createPublicKey)(publicKeyPem), Buffer.from(chuKyB64, "base64"));
    }
    catch {
        return false;
    }
}
/** Nonce cho khung `challenge`: 32 byte ngau nhien, hex. */
function sinhNonce() {
    return (0, node_crypto_1.randomBytes)(32).toString("hex");
}
//# sourceMappingURL=khoa-may.js.map