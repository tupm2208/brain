"use strict";
// BO NAO — chay tren Xeon, phuc vu moi nha ban hang.
//
// Bo may o `engine/` KHONG biet gi ve giay, thuoc hay spa. Kien thuc nganh nam o
// `packs/`. Ban cho nganh moi = viet mot bo ho so moi, khong dung vao bo may.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_PACKS = exports.nhaThuocPack = exports.giayChayPack = exports.redactPII = exports.findPIIInText = exports.assertNoStoredPII = void 0;
exports.loadPack = loadPack;
exports.selfCheckPacks = selfCheckPacks;
// Xuat lai cong du lieu ca nhan cua ban giao keo — Bo nao la noi goi no.
var contract_1 = require("@sp/contract");
Object.defineProperty(exports, "assertNoStoredPII", { enumerable: true, get: function () { return contract_1.assertNoStoredPII; } });
Object.defineProperty(exports, "findPIIInText", { enumerable: true, get: function () { return contract_1.findPIIInText; } });
Object.defineProperty(exports, "redactPII", { enumerable: true, get: function () { return contract_1.redactPII; } });
__exportStar(require("./pack/types"), exports);
__exportStar(require("./pack/validate"), exports);
__exportStar(require("./ports/index"), exports);
__exportStar(require("./engine/text"), exports);
__exportStar(require("./engine/memory"), exports);
__exportStar(require("./engine/muc-luc"), exports);
__exportStar(require("./engine/gates"), exports);
__exportStar(require("./engine/turn"), exports);
__exportStar(require("./link/goi-qua-day"), exports);
__exportStar(require("./link/may-chu"), exports);
__exportStar(require("./link/kho-khoa"), exports);
__exportStar(require("./link/kho-kich-hoat"), exports);
__exportStar(require("./link/chung-chi-xeon"), exports);
var index_1 = require("./packs/giay-chay/index");
Object.defineProperty(exports, "giayChayPack", { enumerable: true, get: function () { return index_1.giayChayPack; } });
var index_2 = require("./packs/nha-thuoc/index");
Object.defineProperty(exports, "nhaThuocPack", { enumerable: true, get: function () { return index_2.nhaThuocPack; } });
const validate_1 = require("./pack/validate");
const index_3 = require("./packs/giay-chay/index");
const index_4 = require("./packs/nha-thuoc/index");
/** Cac bo luat nganh co san. Them nganh moi = them mot dong o day. */
exports.BUILTIN_PACKS = {
    [index_3.giayChayPack.id]: index_3.giayChayPack,
    [index_4.nhaThuocPack.id]: index_4.nhaThuocPack
};
function loadPack(id) {
    const pack = exports.BUILTIN_PACKS[id];
    if (pack === undefined)
        throw new Error(`Khong co bo luat nganh "${id}".`);
    (0, validate_1.assertPackValid)(pack);
    return pack;
}
/** Soi het cac bo luat co san. Goi luc khoi dong va trong bai kiem tra. */
function selfCheckPacks() {
    for (const id of Object.keys(exports.BUILTIN_PACKS))
        loadPack(id);
}
//# sourceMappingURL=index.js.map