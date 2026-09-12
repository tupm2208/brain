"use strict";
// Chuan hoa chu tieng Viet.
//
// Cac ham goc da chuyen sang BAN GIAO KEO (`@sp/contract`), vi ca ba khoi phai
// chuan hoa GIONG HET nhau: OMI ghi cot chu da chuan hoa de tim, Bo nao chuan hoa
// cau khach go de so khop. Lech mot ly la nhan kho khong bao gio gap duoc cau khach.
//
// Rieng phan duoi day o lai Bo nao vi no la KIEN THUC ve cach nguoi Viet nhan tin,
// khong phai phep chuan hoa thuan tuy.
Object.defineProperty(exports, "__esModule", { value: true });
exports.mentionsBrand = exports.coverage = exports.overlap = exports.hasWord = exports.escapeRe = exports.tight = exports.tokens = exports.squash = exports.stripDiacritics = exports.soft = exports.normalize = void 0;
exports.specificTokens = specificTokens;
var contract_1 = require("@sp/contract");
Object.defineProperty(exports, "normalize", { enumerable: true, get: function () { return contract_1.normalize; } });
Object.defineProperty(exports, "soft", { enumerable: true, get: function () { return contract_1.soft; } });
Object.defineProperty(exports, "stripDiacritics", { enumerable: true, get: function () { return contract_1.stripDiacritics; } });
Object.defineProperty(exports, "squash", { enumerable: true, get: function () { return contract_1.squash; } });
Object.defineProperty(exports, "tokens", { enumerable: true, get: function () { return contract_1.tokens; } });
Object.defineProperty(exports, "tight", { enumerable: true, get: function () { return contract_1.tight; } });
Object.defineProperty(exports, "escapeRe", { enumerable: true, get: function () { return contract_1.escapeRe; } });
Object.defineProperty(exports, "hasWord", { enumerable: true, get: function () { return contract_1.hasWord; } });
Object.defineProperty(exports, "overlap", { enumerable: true, get: function () { return contract_1.overlap; } });
Object.defineProperty(exports, "coverage", { enumerable: true, get: function () { return contract_1.coverage; } });
Object.defineProperty(exports, "mentionsBrand", { enumerable: true, get: function () { return contract_1.mentionsBrand; } });
const contract_2 = require("@sp/contract");
/**
 * Tu qua pho bien, mot minh no khong noi len mon hang nao.
 *
 * LUU Y: day la kien thuc ban le tieng Viet dang nam trong bo may. Dung nguyen tac
 * "moi khac biet phai nam o ho so", cho nay ly ra phai do ho so nganh khai.
 * Chua chuyen vi hai bo luat hien co dung chung y het danh sach nay; khi mo nganh
 * thu ba ma danh sach lech di thi phai chuyen xuong ho so.
 */
const STOPWORDS = new Set([
    "shop", "em", "minh", "ban", "co", "khong", "ko", "cho", "cua", "nay", "do", "oi",
    "con", "gia", "bao", "nhieu", "size", "loai", "mau", "the", "nao", "voi", "duoc",
    "hoi", "xin", "vay", "nhe", "nha", "hom", "toi", "anh", "chi", "bac"
]);
/**
 * Cac tu co the la ten mon hang: du dai, khong phai tu chung chung, khong phai tu pho bien.
 *
 * `filler` la TU DEM do HO SO NGANH khai ("thi", "sao", "roi"...): "size 43 thi sao" ma
 * "thi"/"sao" bi coi la tu rieng thi tam diem bi xoa. Nhung day la thu ho so phai khai
 * chu bo may khong duoc tu quyet: "cam", "vang", "day", "moi" la tu dem o nganh nay va la
 * MOT PHAN TEN MON o nganh khac (nuoc cam, ruou vang, day chuyen, son moi) — ma
 * `specificTokens` la cua DUY NHAT dan toi muc luc, nen mot tu bi nuot o day la mon do
 * khong bao gio ban duoc.
 */
function specificTokens(text, generic, filler = []) {
    // Tu chung nhieu chu ("san pham", "do the thao") phai duoc TACH: bo loc so tung token,
    // nen "san pham nay con khong" voi "san pham" nguyen cum trong danh sach van de lot
    // "san" va "pham" nhu hai tu rieng — va tam diem bi xoa.
    const g = new Set([...generic, ...filler].flatMap((x) => [(0, contract_2.normalize)(x), ...(0, contract_2.tokens)((0, contract_2.normalize)(x))]));
    return (0, contract_2.tokens)(text).filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !g.has(t));
}
//# sourceMappingURL=text.js.map