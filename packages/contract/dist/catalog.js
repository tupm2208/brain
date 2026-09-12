"use strict";
// MUC LUC HANG HOA — ban rut gon ma Bo nao tren Xeon duoc phep giu.
//
// QUYET DINH 3 (ban dac ta): may khach giu ban goc, Xeon chi giu muc luc.
// Muc luc = thu von da cong khai tren web ban hang: ten, ma, hang, thuoc tinh, gia ban.
// TUYET DOI khong luu: so dien thoai, dia chi, lich su mua cua khach, va gia von.
//
// CONG CHAN: ban dau viet theo kieu "danh sach ten truong cam" (regex tren ten khoa).
// Agent phan bien 09/09 dap thung dung hai dau:
//   - Thung: `attributes.note = "Chi Lan 0968411655, 12 Hoai Duc"` LOT sach, vi cong
//     chi doc TEN khoa ma khong bao gio doc GIA TRI. Ma `attributes` lai la truong tu do —
//     dung cho du lieu ban hay chui vao nhat.
//   - Chan nham: `/tel\b/` chan luon `hotel`; `/ward/` chan `awards`, `rewardPoints`;
//     `province` chan ca tinh cua KHO va xuat xu san pham. Nen tang da nganh ma chan kieu do
//     thi nguoi ta se noi long cong — va cong bi noi long la cong chet.
//
// Ban nay doi sang DANH SACH TRANG THEO HINH DANG: muc luc co so truong dong, khoa la
// bi tu choi thay vi phai doan khoa nao xau. Cong them mot lan quet GIA TRI de bat
// so dien thoai va email lot vao o tu do.
Object.defineProperty(exports, "__esModule", { value: true });
exports.findCatalogIssues = findCatalogIssues;
exports.assertCatalogClean = assertCatalogClean;
// ---------------------------------------------------------------------------
// Cong chan
// ---------------------------------------------------------------------------
const ITEM_KEYS = new Set([
    "tenant", "id", "code", "name", "brand", "category",
    "variantAxis", "variants", "attributes", "images", "url", "updatedAt"
]);
const VARIANT_KEYS = new Set(["id", "label", "price", "sort"]);
/** So dien thoai Viet Nam trong mot chuoi tu do. */
const VN_PHONE_RE = /(?:\+?84|0)(?:\d[ .-]?){8,10}\d/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** Chuoi so dai lien tuc: the ngan hang, can cuoc, ma van don ca nhan... */
const LONG_DIGITS_RE = /\d{11,}/;
function scanText(text, path, out) {
    if (VN_PHONE_RE.test(text)) {
        out.push({ kind: "phone_in_value", path, hint: "Chuoi chua thu giong so dien thoai." });
    }
    else if (EMAIL_RE.test(text)) {
        out.push({ kind: "email_in_value", path, hint: "Chuoi chua thu giong dia chi email." });
    }
    else if (LONG_DIGITS_RE.test(text)) {
        out.push({ kind: "long_digits_in_value", path, hint: "Chuoi so dai bat thuong (the, can cuoc?)." });
    }
}
function checkVariant(v, path, out) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
        out.push({ kind: "not_object", path, hint: "Bien the phai la mot doi tuong." });
        return;
    }
    for (const [k, val] of Object.entries(v)) {
        if (!VARIANT_KEYS.has(k)) {
            out.push({ kind: "unknown_key", path: `${path}.${k}`, hint: "Bien the chi duoc co id, label, price, sort." });
            continue;
        }
        if (typeof val === "string")
            scanText(val, `${path}.${k}`, out);
    }
}
/** Quet mot mon hang (hoac mang mon hang). Rong = sach. */
function findCatalogIssues(value, path = "$") {
    const out = [];
    if (Array.isArray(value)) {
        value.forEach((child, i) => out.push(...findCatalogIssues(child, `${path}[${i}]`)));
        return out;
    }
    if (value === null || typeof value !== "object") {
        out.push({
            kind: "not_object",
            path,
            hint: "Muc luc phai la doi tuong hoac mang doi tuong. Chuoi JSON khong duoc coi la sach."
        });
        return out;
    }
    for (const [k, val] of Object.entries(value)) {
        const at = `${path}.${k}`;
        if (!ITEM_KEYS.has(k)) {
            out.push({
                kind: "unknown_key",
                path: at,
                hint: "Truong la khong thuoc muc luc. Muon them thi phai them vao CatalogItem truoc."
            });
            continue;
        }
        if (k === "variants") {
            if (!Array.isArray(val)) {
                out.push({ kind: "wrong_type", path: at, hint: "variants phai la mang." });
            }
            else {
                val.forEach((child, i) => checkVariant(child, `${at}[${i}]`, out));
            }
            continue;
        }
        if (k === "attributes") {
            if (val === null || typeof val !== "object" || Array.isArray(val)) {
                out.push({ kind: "wrong_type", path: at, hint: "attributes phai la doi tuong chu-sang-chu." });
                continue;
            }
            // Khoa tu do (pack nganh dat ten), nhung GIA TRI thi quet — day la cho ro that.
            for (const [ak, av] of Object.entries(val)) {
                if (typeof av === "string")
                    scanText(av, `${at}.${ak}`, out);
                else if (typeof av !== "number" && typeof av !== "boolean") {
                    out.push({ kind: "wrong_type", path: `${at}.${ak}`, hint: "Thuoc tinh chi duoc la chu, so hoac dung/sai." });
                }
            }
            continue;
        }
        if (k === "images") {
            if (!Array.isArray(val)) {
                out.push({ kind: "wrong_type", path: at, hint: "images phai la mang chuoi." });
            }
            else {
                val.forEach((child, i) => { if (typeof child === "string")
                    scanText(child, `${at}[${i}]`, out); });
            }
            continue;
        }
        if (typeof val === "string")
            scanText(val, at, out);
    }
    return out;
}
/** Nem loi neu muc luc chua sach. Bo nap PHAI goi truoc khi day len Xeon. */
function assertCatalogClean(value) {
    const issues = findCatalogIssues(value);
    if (issues.length > 0) {
        const where = issues.slice(0, 8).map((i) => `${i.path} (${i.kind})`).join(", ");
        throw new Error(`Muc luc gui len Xeon chua dat (${issues.length} cho): ${where}. ` +
            `Xem QUYET DINH 3 trong ban dac ta — Xeon khong duoc giu du lieu khach hay gia von.`);
    }
}
//# sourceMappingURL=catalog.js.map