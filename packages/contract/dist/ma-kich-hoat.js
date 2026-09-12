"use strict";
// MA KICH HOAT — giay phep KY SO, dong goi thanh mot chuoi khach dan vao OMI.
//
// Anh chot 09/09: MOT ban cai chua tat ca manh; ma kich hoat quyet dinh manh nao bat. Ma phai
// ky so de khong sua tay duoc — nhung noi KIEM la Xeon (Phan 17: kiem giay phep o may chu).
// OMI chi mang ma di; ma dung hay sai la do Xeon noi luc kich hoat, va sau do la do `welcome`
// mang cong cu nao. Mot doan ma "tu kiem giay phep" trong OMI la vo nghia va khong co o day.
//
// Ba quyet dinh:
//  1. Ma = `SPK1.` + base64url(JSON cua SignedLicense). Base64url (khong `+ / =`) de dan qua
//     email, Zalo, Messenger khong bi vo; khoang trang / xuong dong hai dau duoc bo.
//  2. Ma cap TRUOC khi khach cai, nen `payload.machine` la `MAY_CHUA_GAN` ("*"): may cu the
//     gan vao luc kich hoat, khi OMI dua khoa cong khai len.
//  3. Khung `activate` KY bang khoa may vua sinh tren may shop (`chuoiDeKyKichHoat`, co nonce
//     cua challenge): chung minh OMI giu khoa rieng cua khoa cong khai no khai bao, va chan phat
//     lai. Chuoi ky co nhan "kich-hoat" de khong bao gio trung voi chuoi ky cua `hello`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIEN_TO_MA_KICH_HOAT = exports.MAY_CHUA_GAN = void 0;
exports.kyGiayPhep = kyGiayPhep;
exports.kiemChuKyGiayPhep = kiemChuKyGiayPhep;
exports.maHoaMaKichHoat = maHoaMaKichHoat;
exports.giaiMaMaKichHoat = giaiMaMaKichHoat;
exports.chuoiDeKyKichHoat = chuoiDeKyKichHoat;
exports.chuoiDeKyGhim = chuoiDeKyGhim;
exports.keyIdCuaKhoaCong = keyIdCuaKhoaCong;
const node_crypto_1 = require("node:crypto");
const license_1 = require("./license");
const khoa_may_1 = require("./khoa-may");
/** `payload.machine` cua giay phep cap truoc khi cai: gan may luc kich hoat. */
exports.MAY_CHUA_GAN = "*";
exports.TIEN_TO_MA_KICH_HOAT = "SPK1.";
/** Ky giay phep bang khoa ky cua Xeon (Ed25519, PEM PKCS#8). */
function kyGiayPhep(payload, khoaKyRiengPem, keyId, licenseId) {
    return { payload, signature: (0, khoa_may_1.kyChuoi)(khoaKyRiengPem, (0, license_1.canonicalLicenseJSON)(payload)), keyId, licenseId };
}
/** Kiem chu ky giay phep bang khoa CONG KHAI cua Xeon. Khoa hong hay chu ky hong deu la SAI. */
function kiemChuKyGiayPhep(sl, khoaKyCongPem) {
    return (0, khoa_may_1.kiemChuKy)(khoaKyCongPem, (0, license_1.canonicalLicenseJSON)(sl.payload), sl.signature);
}
function maHoaMaKichHoat(sl) {
    return `${exports.TIEN_TO_MA_KICH_HOAT}${Buffer.from(JSON.stringify(sl), "utf8").toString("base64url")}`;
}
const laChuoi = (v) => typeof v === "string" && v !== "";
/**
 * Giai ma + kiem HINH DANG (khong kiem chu ky — viec do can khoa cong khai cua Xeon, xem
 * `kiemChuKyGiayPhep`). Du lieu tu tay khach dan vao luon la du lieu la.
 */
function giaiMaMaKichHoat(ma) {
    if (typeof ma !== "string")
        return { ok: false, reason: "Mã kích hoạt phải là một chuỗi." };
    const chuoi = ma.trim();
    if (!chuoi.startsWith(exports.TIEN_TO_MA_KICH_HOAT))
        return { ok: false, reason: `Mã kích hoạt phải bắt đầu bằng "${exports.TIEN_TO_MA_KICH_HOAT}".` };
    const than = chuoi.slice(exports.TIEN_TO_MA_KICH_HOAT.length);
    if (than === "" || !/^[A-Za-z0-9_-]+$/.test(than))
        return { ok: false, reason: "Thân mã kích hoạt không đúng dạng (base64url)." };
    let van;
    try {
        van = Buffer.from(than, "base64url").toString("utf8");
    }
    catch {
        return { ok: false, reason: "Thân mã kích hoạt không giải được." };
    }
    // Khoa rieng khong bao gio nam trong ma kich hoat: ai do da dan nham thu quy.
    if (/PRIVATE KEY/.test(van))
        return { ok: false, reason: "Mã kích hoạt mang KHÓA RIÊNG — đây không phải mã kích hoạt." };
    let o;
    try {
        o = JSON.parse(van);
    }
    catch {
        return { ok: false, reason: "Mã kích hoạt không phải JSON." };
    }
    if (o === null || typeof o !== "object" || Array.isArray(o))
        return { ok: false, reason: "Mã kích hoạt phải là một đối tượng." };
    const r = o;
    for (const f of ["signature", "keyId", "licenseId"]) {
        if (!laChuoi(r[f]))
            return { ok: false, reason: `Mã kích hoạt thiếu "${f}".` };
    }
    const p = r["payload"];
    if (p === null || typeof p !== "object" || Array.isArray(p))
        return { ok: false, reason: "Mã kích hoạt thiếu payload." };
    const pl = p;
    for (const f of ["tenant", "tenantName", "machine", "packId", "expiresAt", "minContract", "issuedAt"]) {
        if (!laChuoi(pl[f]))
            return { ok: false, reason: `Giấy phép thiếu "${f}".` };
    }
    if (typeof pl["seats"] !== "number" || !Number.isInteger(pl["seats"]) || pl["seats"] < 0)
        return { ok: false, reason: "Giấy phép: seats phải là số nguyên không âm." };
    const m = pl["modules"];
    if (!Array.isArray(m) || !m.every((x) => typeof x === "string"))
        return { ok: false, reason: "Giấy phép: modules phải là mảng chuỗi." };
    const payload = {
        tenant: pl["tenant"], tenantName: pl["tenantName"],
        machine: pl["machine"], packId: pl["packId"],
        modules: [...m], seats: pl["seats"], expiresAt: pl["expiresAt"],
        minContract: pl["minContract"], issuedAt: pl["issuedAt"]
    };
    return { ok: true, license: { payload, signature: r["signature"], keyId: r["keyId"], licenseId: r["licenseId"] } };
}
/**
 * Chuoi OMI ky trong khung `activate` bang khoa may VUA SINH: co nonce (chong phat lai), ma giay
 * phep, may, ban giao keo. Nhan "kich-hoat" de khong trung `chuoiDeKy` cua `hello`.
 */
function chuoiDeKyKichHoat(args) {
    return `${args.nonce}.kich-hoat.${args.licenseId}.${args.machine}.${args.contract}`;
}
/**
 * Chuoi Xeon KY trong khung `pins` bang khoa ky giay phep (khong phai khoa TLS): ke co khoa TLS cu
 * bi lo van khong day duoc danh sach ghim moi xuong OMI. JSON de `reason` mang ky tu gi cung duoc.
 */
function chuoiDeKyGhim(args) {
    return `pins.${JSON.stringify([args.seq, args.reason, [...args.ghim]])}`;
}
/** Ma nhan dien khoa ky cua Xeon: `ky-` + 16 ky tu base64url cua SHA-256(SPKI). Bam KHOA nen on dinh. */
function keyIdCuaKhoaCong(khoaCongPem) {
    const spki = (0, node_crypto_1.createPublicKey)(khoaCongPem).export({ type: "spki", format: "der" });
    return `ky-${(0, node_crypto_1.createHash)("sha256").update(spki).digest("base64url").slice(0, 16)}`;
}
//# sourceMappingURL=ma-kich-hoat.js.map