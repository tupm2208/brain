"use strict";
// CHUNG CHI TU KY VA GHIM — thu chung minh "day dung la Xeon cua chu nen tang".
//
// Khoa may (`khoa-may.ts`) chung minh OMI la ai. Chieu nguoc lai — OMI dang noi voi DUNG
// Xeon chu khong phai mot may dung giua — la viec cua TLS, va TLS can mot chung chi.
//
// Ba quyet dinh:
//  1. TU KY, KHONG MUA. Khong co CA nao trong chuoi tin: OMI tin Xeon vi no GHIM bam SHA-256
//     cua khoa cong khai trong chung chi (RFC 7469, dang `sha256/<base64>`), giong cach SSH
//     nho may chu. Chung chi mua ve cung phai ghim moi chan duoc CA bi lua; da ghim thi CA
//     khong con viec gi. Ghim theo KHOA chu khong theo chung chi: gia han cung khoa la ghim
//     khong doi, khong phai di cap nhat tung OMI.
//  2. Ed25519, DER VIET TAY. Node co san moi thu de ky va doc chung chi nhung khong co cach
//     nao SINH — sinh la viec cua `openssl`, thu khong chac co tren may chu va chac chan
//     khong co tren may khach. Mot chung chi X.509 toi thieu la vai chuc byte DER; viet tay
//     duoc, va bai kiem tra bat Node doc lai va tu xac minh chu ky.
//  3. OMI KHONG KIEM HAN cua chung chi (`rejectUnauthorized: false` roi tu kiem ghim). Kiem
//     han la mot cai bay: Xeon quen gia han thi MOI OMI ngoai kia bi khoa ngoai cung luc, va
//     khong co duong nao day chung chi moi xuong (kich hoat lai la viec cua nguoi). Han tren
//     chung chi chi la ve sinh; thu giu an toan la ghim + khoa rieng nam yen tren Xeon.
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIEU_LUC_NGAY_MAC_DINH = exports.TIEN_TO_GHIM = void 0;
exports.sinhChungChiTuKy = sinhChungChiTuKy;
exports.ghimCuaChungChi = ghimCuaChungChi;
exports.laGhimHopLe = laGhimHopLe;
const node_crypto_1 = require("node:crypto");
exports.TIEN_TO_GHIM = "sha256/";
/** Chung chi tu ky song bao nhieu ngay neu khong noi khac. Han chi la ve sinh (xem dau tep). */
exports.HIEU_LUC_NGAY_MAC_DINH = 3650;
// ---- DER toi thieu -----------------------------------------------------------------------
function doDai(n) {
    if (n < 0x80)
        return Buffer.from([n]);
    const b = [];
    let x = n;
    while (x > 0) {
        b.unshift(x & 0xff);
        x = Math.floor(x / 256);
    }
    return Buffer.from([0x80 | b.length, ...b]);
}
function tlv(tag, than) { return Buffer.concat([Buffer.from([tag]), doDai(than.length), than]); }
const SEQ = (...phan) => tlv(0x30, Buffer.concat(phan));
const SET = (...phan) => tlv(0x31, Buffer.concat(phan));
const INT = (b) => tlv(0x02, b);
const OID = (...byte) => tlv(0x06, Buffer.from(byte));
const UTF8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const OCTET = (b) => tlv(0x04, b);
const BOOL_TRUE = tlv(0x01, Buffer.from([0xff]));
const BIT = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const RO = (n, than) => tlv(0xa0 | n, than);
const OID_ED25519 = OID(0x2b, 0x65, 0x70); // 1.3.101.112
const OID_CN = OID(0x55, 0x04, 0x03); // 2.5.4.3
const OID_BASIC_CONSTRAINTS = OID(0x55, 0x1d, 0x13); // 2.5.29.19
const OID_SUBJECT_ALT_NAME = OID(0x55, 0x1d, 0x11); // 2.5.29.17
const OID_EXT_KEY_USAGE = OID(0x55, 0x1d, 0x25); // 2.5.29.37
const OID_SERVER_AUTH = OID(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x01); // 1.3.6.1.5.5.7.3.1
/** RFC 5280 4.1.2.5: truoc 2050 dung UTCTime (YYMMDDHHMMSSZ), tu 2050 dung GeneralizedTime. */
function thoiGian(d) {
    const iso = d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return d.getUTCFullYear() < 2050
        ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`, "ascii"))
        : tlv(0x18, Buffer.from(`${iso}Z`, "ascii"));
}
const laIPv4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((p) => Number(p) <= 255);
function tenChuThe(ten) { return SEQ(SET(SEQ(OID_CN, UTF8(ten)))); }
function tenThayThe(ten) {
    // dNSName [2] IA5String, hoac iPAddress [7] OCTET STRING 4 byte.
    const gia = laIPv4(ten)
        ? tlv(0x87, Buffer.from(ten.split(".").map((p) => Number(p))))
        : tlv(0x82, Buffer.from(ten, "ascii"));
    return SEQ(OID_SUBJECT_ALT_NAME, OCTET(SEQ(gia)));
}
/** So se-ri: 16 byte ngau nhien, duong, byte dau khac 0 (DER doi INTEGER ngan nhat). */
function soSeRi() {
    const b = (0, node_crypto_1.randomBytes)(16);
    b[0] = (b[0] & 0x7f) || 1;
    return b;
}
function docKhoaRieng(pem) {
    if (pem === undefined)
        return (0, node_crypto_1.generateKeyPairSync)("ed25519").privateKey;
    let k;
    try {
        k = (0, node_crypto_1.createPrivateKey)(pem);
    }
    catch (e) {
        throw new Error(`Khoa rieng khong doc duoc: ${String(e?.message ?? e)}`);
    }
    if (k.asymmetricKeyType !== "ed25519")
        throw new Error(`Khoa rieng phai la Ed25519, day la ${String(k.asymmetricKeyType)}.`);
    return k;
}
/**
 * Sinh chung chi X.509 v3 tu ky bang Ed25519. Khong can openssl.
 * Gia han = goi lai voi `privateKeyPem` cu: ghim giu nguyen, chi so se-ri va han doi.
 */
function sinhChungChiTuKy(opts) {
    if (typeof opts.ten !== "string" || !/^[A-Za-z0-9.-]{1,64}$/.test(opts.ten)) {
        throw new Error("Ten may chu cua chung chi phai la 1-64 ky tu A-Z a-z 0-9 . - (hostname hoac IPv4).");
    }
    const hieuLuc = opts.hieuLucNgay ?? exports.HIEU_LUC_NGAY_MAC_DINH;
    if (!Number.isInteger(hieuLuc) || hieuLuc <= 0)
        throw new Error("Han chung chi (hieuLucNgay) phai la so ngay nguyen duong.");
    const khoa = docKhoaRieng(opts.privateKeyPem);
    const khoaCong = (0, node_crypto_1.createPublicKey)(khoa);
    const tuLuc = opts.tuLuc ?? new Date();
    const denLuc = new Date(tuLuc.getTime() + hieuLuc * 86_400_000);
    const spki = khoaCong.export({ type: "spki", format: "der" });
    const thuatToan = SEQ(OID_ED25519);
    const moRong = RO(3, SEQ(SEQ(OID_BASIC_CONSTRAINTS, BOOL_TRUE, OCTET(SEQ())), // CA:FALSE, critical
    SEQ(OID_EXT_KEY_USAGE, OCTET(SEQ(OID_SERVER_AUTH))), tenThayThe(opts.ten)));
    const tbs = SEQ(RO(0, INT(Buffer.from([2]))), // v3
    INT(soSeRi()), thuatToan, tenChuThe(opts.ten), SEQ(thoiGian(tuLuc), thoiGian(denLuc)), tenChuThe(opts.ten), spki, moRong);
    const chuKy = (0, node_crypto_1.sign)(null, tbs, khoa);
    const der = SEQ(tbs, thuatToan, BIT(chuKy));
    const certPem = `-----BEGIN CERTIFICATE-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----\n`;
    return {
        certPem,
        privateKeyPem: khoa.export({ type: "pkcs8", format: "pem" }),
        ghim: ghimCuaSpki(spki),
        hetHan: denLuc.toISOString()
    };
}
function ghimCuaSpki(spkiDer) {
    return `${exports.TIEN_TO_GHIM}${(0, node_crypto_1.createHash)("sha256").update(spkiDer).digest("base64")}`;
}
/**
 * Ghim cua mot chung chi (PEM hoac DER): SHA-256 cua SubjectPublicKeyInfo, base64.
 * Cung so voi `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`.
 */
function ghimCuaChungChi(chungChi) {
    let x;
    try {
        x = new node_crypto_1.X509Certificate(chungChi);
    }
    catch (e) {
        throw new Error(`Chung chi hong: ${String(e?.message ?? e)}`);
    }
    return ghimCuaSpki(x.publicKey.export({ type: "spki", format: "der" }));
}
/** Dung dang `sha256/<base64 32 byte>`. Moi thu khac — ke ca chuoi rong — la sai. */
function laGhimHopLe(ghim) {
    if (typeof ghim !== "string" || !ghim.startsWith(exports.TIEN_TO_GHIM))
        return false;
    const b64 = ghim.slice(exports.TIEN_TO_GHIM.length);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(b64))
        return false;
    // Base64 phai CHUAN TAC (bit thua o ky tu cuoi = 0): ghim so bang chuoi, mot ghim "gan dung"
    // qua duoc kiem nhung khong bao gio khop — nguoi quan tri ngoi tim loi o mang.
    const b = Buffer.from(b64, "base64");
    return b.length === 32 && b.toString("base64") === b64;
}
//# sourceMappingURL=chung-chi.js.map