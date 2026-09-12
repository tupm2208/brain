"use strict";
// MA KICH HOAT.
//
// Anh chot 09/09: MOT ban cai duy nhat chua tat ca manh; ma kich hoat quyet dinh manh nao bat.
// Cai "dong goi rieng" ma khach cam nhan nam o ma, khong nam o tep cai.
//
// Luat quan trong (Phan 17): kiem giay phep o MAY CHU, khong o may khach. Moi doan ma
// kiem ban quyen nam trong app deu bi vo hieu trong mot gio. File nay mo ta hinh dang
// giay phep VA cung cap cac ham ma Bo nao dung de quyet dinh — noi quyet dinh that su
// la Bo nao, khong phai OMI.
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalLicenseJSON = canonicalLicenseJSON;
exports.licenseIssues = licenseIssues;
exports.isExpired = isExpired;
exports.enabledModules = enabledModules;
exports.isModuleEnabled = isModuleEnabled;
exports.enabledTools = enabledTools;
const modules_1 = require("./modules");
const tools_1 = require("./tools");
/** Tuan tu hoa chuan de ky va de xac minh. Dung DUNG ham nay o ca hai phia. */
function canonicalLicenseJSON(p) {
    const ordered = {};
    for (const key of Object.keys(p).sort()) {
        ordered[key] = p[key];
    }
    // `modules` la mang: sap xep de thu tu khai khong lam doi chu ky.
    if (Array.isArray(ordered["modules"])) {
        ordered["modules"] = [...ordered["modules"]].sort();
    }
    return JSON.stringify(ordered);
}
/**
 * Soi giay phep truoc khi dung. Truoc day cac id manh la bi NUOT im lang:
 * khach tra tien manh Van chuyen, go sai mot chu trong giay phep, bot lang le
 * khong co cong cu tra van don va khong ai biet vi sao.
 */
function licenseIssues(license, now = new Date()) {
    const out = [];
    for (const id of license.modules) {
        if (!(0, modules_1.isModuleId)(id))
            out.push({ kind: "unknown_module", detail: String(id) });
    }
    const exp = Date.parse(license.expiresAt);
    const iss = Date.parse(license.issuedAt);
    if (!Number.isFinite(exp))
        out.push({ kind: "bad_date", detail: `expiresAt="${license.expiresAt}"` });
    else if (exp <= now.getTime())
        out.push({ kind: "expired", detail: license.expiresAt });
    if (!Number.isFinite(iss))
        out.push({ kind: "bad_date", detail: `issuedAt="${license.issuedAt}"` });
    else if (iss > now.getTime())
        out.push({ kind: "not_yet_valid", detail: license.issuedAt });
    return out;
}
function isExpired(license, now = new Date()) {
    const t = Date.parse(license.expiresAt);
    return !Number.isFinite(t) || t <= now.getTime();
}
/** Danh sach manh thuc su bat: nhung gi khai trong giay phep, cong ba manh loi. */
function enabledModules(license) {
    const set = new Set(modules_1.CORE_MODULE_IDS);
    for (const id of license.modules) {
        if ((0, modules_1.isModuleId)(id))
            set.add(id);
    }
    return [...set];
}
function isModuleEnabled(license, id) {
    return modules_1.MODULES[id].core || license.modules.includes(id);
}
/**
 * Cong cu BOT duoc phep goi voi giay phep nay. Bo nao dung ham nay de dung
 * danh sach cong cu gui trong khung `welcome`.
 *
 * Hai luat cung nam o day:
 *  - Manh tat thi cong cu KHONG TON TAI voi bot (cai bay so 3 trong ban dac ta).
 *  - Giay phep het han thi tra ve RONG — "Bo nao tu choi phuc vu neu het han thue".
 *    Truoc day ham nay khong xem han dung, giay phep het tu 2020 van duoc du cong cu.
 */
function enabledTools(license, now = new Date()) {
    if (isExpired(license, now))
        return [];
    const on = new Set(enabledModules(license));
    return tools_1.TOOL_NAMES.filter((name) => tools_1.TOOLS[name].audience === "bot" && on.has(tools_1.TOOLS[name].module));
}
//# sourceMappingURL=license.js.map