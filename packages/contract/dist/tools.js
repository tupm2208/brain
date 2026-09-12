"use strict";
// CONG CU BO NAO DUOC GOI SANG OMI.
//
// Ba luat khac vao day tu ban dac ta:
//  1. Bot chi goi duoc cong cu cua manh DANG BAT. Manh tat thi cong cu khong ton tai
//     voi bot, va bot phai noi "de em chuyen nhan vien" chu khong duoc doan.
//  2. Bot KHONG BAO GIO duoc chi tien.
//  3. Viec tieu tien van phai co cho khai — cho NGUOI dung, khong cho bot.
//     (Ban dau khong co `audience` nen khong khai duoc cong cu chi tien cho nguoi;
//     agent phan bien chi ra rang buoc 3 se ket o day.)
//
// Cong `assertToolsSafeForBot` khong chi tin loi tu khai `effect`: no con doi chieu
// DONG TU trong ten cong cu, de bat ca nguoi khai sai — vi du them `payment.refund`
// ma ghi `effect: "read"`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOT_TOOL_NAMES = exports.TOOL_NAMES = exports.TOOLS = exports.MAX_STOCK_ROWS = exports.MAX_SEARCH_LIMIT = void 0;
exports.isToolName = isToolName;
exports.assertToolsSafeForBot = assertToolsSafeForBot;
exports.kiemInput = kiemInput;
exports.kiemOutput = kiemOutput;
/** Tran cung cho ket qua tim kiem — chan viec model bat khong tham so roi keo ca kho ve. */
exports.MAX_SEARCH_LIMIT = 20;
exports.MAX_STOCK_ROWS = 60;
exports.TOOLS = {
    "catalog.search": {
        name: "catalog.search", module: "hang-kho", effect: "read", audience: "bot",
        describe: "Tim mon hang theo ten, ma hoac tu khoa khach go."
    },
    "stock.lookup": {
        name: "stock.lookup", module: "hang-kho", effect: "read", audience: "bot",
        describe: "Tra so luong con that theo ma + bien the + kho."
    },
    "variant.chart": {
        name: "variant.chart", module: "hang-kho", effect: "read", audience: "bot",
        describe: "Bang bien the cua mon hang (vi du bang size) de tu van chon dung."
    },
    "order.lookup": {
        // `effect: "draft"` chu khong phai `"read"`: cong cu nay GHI — no ghi nhan khach da
        // tu chung minh la chu nhung don nao, va ghi mot dong nhat ky. Khai la "read" thi
        // ban giao keo dang noi sai ve chinh no.
        name: "order.lookup", module: "don-khach", effect: "draft", audience: "bot",
        describe: "Tra don theo so dien thoai khach da cung cap trong chinh hoi thoai nay."
    },
    "order.draft": {
        name: "order.draft", module: "don-khach", effect: "draft", audience: "bot",
        describe: "Tao don NHAP tu hoi thoai; nguoi that duyet moi thanh don that."
    },
    "policy.get": {
        name: "policy.get", module: "don-khach", effect: "read", audience: "bot",
        describe: "Lay chinh sach shop (doi tra, ship, bao hanh). Nguon hop le duy nhat de khang dinh."
    },
    "shipment.track": {
        name: "shipment.track", module: "van-chuyen", effect: "read", audience: "bot",
        describe: "Tra hanh trinh van don cua mot don."
    },
    "payment.status": {
        name: "payment.status", module: "tien", effect: "read", audience: "bot",
        describe: "Da tra bao nhieu, con phai tra bao nhieu, kem anh QR dung so tien."
    },
    "purchase.eta": {
        name: "purchase.eta", module: "mua-ho", effect: "read", audience: "bot",
        describe: "Hang phai order thi bao lau ve."
    },
    "storefront.link": {
        name: "storefront.link", module: "gian-hang", effect: "read", audience: "bot",
        describe: "Sinh link dung mon hang hoac dung bo loc tren gian hang."
    },
    "customer.recognize": {
        name: "customer.recognize", module: "don-khach", effect: "read", audience: "bot",
        describe: "Khach nay tung mua chua, bao nhieu don, lan gan nhat khi nao."
    },
    "order.approve": {
        name: "order.approve", module: "tien", effect: "money", audience: "human",
        describe: "NGUOI duyet don nhap thanh don that va ghi nhan tien. Bot khong duoc goi."
    }
};
exports.TOOL_NAMES = Object.keys(exports.TOOLS);
function isToolName(v) {
    return typeof v === "string" && Object.prototype.hasOwnProperty.call(exports.TOOLS, v);
}
/** Cong cu bot duoc phep nhin thay, truoc khi loc tiep theo giay phep. */
exports.BOT_TOOL_NAMES = exports.TOOL_NAMES.filter((n) => exports.TOOLS[n].audience === "bot");
/**
 * Dong tu tieu tien trong ten cong cu. Dung de bat NGUOI KHAI SAI, khong chi
 * nguoi khai dung — vi `effect` la mot chu do chinh nguoi them cong cu tu go.
 */
const MONEY_VERB_RE = /(^|[._-])(pay|payment|refund|transfer|payout|withdraw|charge|capture|settle|chi|hoan|thanhtoan)([._-]|$)/i;
/** Cong cu chi DOC tinh trang tien thi khong phai viec tieu tien. */
const READ_ONLY_MONEY_TOOLS = new Set(["payment.status"]);
/**
 * Chan ngay luc dung ban va luc khoi dong:
 *  - khong cong cu nao cua BOT duoc mang `effect: "money"`;
 *  - khong cong cu nao co ten mang dong tu tieu tien ma lai mo cho bot.
 */
function assertToolsSafeForBot() {
    const problems = [];
    // Doc SO DANG KY tai thoi diem goi, khong doc `TOOL_NAMES` — do la ban chup luc nap
    // mo-dun, nen cong cu them sau se khong bi soi. Bai kiem tra bat duoc dung cho nay.
    for (const name of Object.keys(exports.TOOLS)) {
        const t = exports.TOOLS[name];
        if (t === undefined)
            continue;
        if (t.audience !== "bot")
            continue;
        if (t.effect === "money") {
            problems.push(`"${name}" khai effect "money" ma van mo cho bot.`);
        }
        if (MONEY_VERB_RE.test(name) && !READ_ONLY_MONEY_TOOLS.has(name)) {
            problems.push(`"${name}" co ten mang dong tu tieu tien nhung dang mo cho bot voi effect "${t.effect}". ` +
                `Neu that su chi doc thi them vao READ_ONLY_MONEY_TOOLS kem ly do.`);
        }
    }
    if (problems.length > 0) {
        throw new Error("Bot khong duoc chi tien (Phan 14 ban dac ta):\n- " + problems.join("\n- "));
    }
}
const la = (v, k) => k === "array" ? Array.isArray(v)
    : k === "object" ? v !== null && typeof v === "object" && !Array.isArray(v)
        : typeof v === k;
function doi(o, ten, k, batBuoc = true) {
    const v = o[ten];
    if (v === undefined)
        return batBuoc ? `thieu '${ten}'` : null;
    if (!la(v, k))
        return `'${ten}' phai la ${k}`;
    if (k === "string" && batBuoc && v.trim() === "")
        return `'${ten}' rong`;
    return null;
}
/** Tra ve cau mo ta loi, hoac `null` neu dau vao dung hinh dang cho cong cu nay. */
function kiemInput(tool, input) {
    if (!la(input, "object"))
        return "input phai la mot doi tuong";
    const o = input;
    switch (tool) {
        case "catalog.search": return doi(o, "q", "string") ?? doi(o, "limit", "number", false);
        case "stock.lookup": {
            const coCode = typeof o["code"] === "string" && o["code"].trim() !== "";
            const coId = typeof o["itemId"] === "string" && o["itemId"].trim() !== "";
            if (!coCode && !coId)
                return "stock.lookup can 'code' hoac 'itemId'";
            return doi(o, "variantLabel", "string", false);
        }
        case "variant.chart": return doi(o, "itemId", "string");
        case "order.lookup":
            return doi(o, "conversationId", "string") ?? doi(o, "phoneGivenInConversation", "string");
        case "order.draft": {
            const l = doi(o, "conversationId", "string", false) ?? doi(o, "lines", "array");
            if (l !== null)
                return l;
            for (const [i, d] of o["lines"].entries()) {
                if (!la(d, "object"))
                    return `lines[${i}] phai la doi tuong`;
                const r = d;
                const e = doi(r, "itemId", "string") ?? doi(r, "variantId", "string") ?? doi(r, "qty", "number");
                if (e !== null)
                    return `lines[${i}]: ${e}`;
            }
            return null;
        }
        case "policy.get": return doi(o, "topic", "string");
        case "shipment.track":
        case "payment.status": return doi(o, "orderId", "string");
        case "purchase.eta": return doi(o, "itemId", "string") ?? doi(o, "variantId", "string", false);
        case "storefront.link": return doi(o, "q", "string", false) ?? doi(o, "filters", "object", false);
        case "customer.recognize": return doi(o, "conversationId", "string");
        case "order.approve":
            return doi(o, "orderId", "string") ?? doi(o, "approvedBy", "string") ?? doi(o, "amount", "number");
        default: return null;
    }
}
/** So phai co that va huu han — `qty` thieu la bot noi "Con NaN doi". */
function soHuuHan(o, ten, batBuoc = true) {
    const e = doi(o, ten, "number", batBuoc);
    if (e !== null)
        return e;
    if (o[ten] === undefined)
        return null;
    return Number.isFinite(o[ten]) ? null : `'${ten}' khong huu han`;
}
/** Tung phan tu cua mang phai la doi tuong va qua duoc `kiem`. */
function moiPhanTu(o, ten, kiem) {
    const arr = o[ten];
    if (!Array.isArray(arr))
        return `'${ten}' phai la array`;
    for (const [i, x] of arr.entries()) {
        if (!la(x, "object"))
            return `${ten}[${i}] phai la doi tuong`;
        const e = kiem(x);
        if (e !== null)
            return `${ten}[${i}]: ${e}`;
    }
    return null;
}
/** Tien tren don: ba con so, ca ba huu han. Bo may doc `money.remaining` truc tiep. */
function tienTrenDon(o) {
    const e = doi(o, "money", "object");
    if (e !== null)
        return e;
    const m = o["money"];
    return soHuuHan(m, "total") ?? soHuuHan(m, "paid") ?? soHuuHan(m, "remaining");
}
/**
 * Tra ve cau mo ta loi, hoac `null` neu ket qua dung hinh dang Bo nao se doc.
 *
 * Kiem ca RUOT, khong chi VO: `rows` la mang chua du — tung dong phai co `qty` la so
 * huu han, `variantLabel` la chuoi. Chi kiem vo thi `rows` thieu `qty` cho ra "Con NaN
 * doi size 42" (gui di that), `rows: ["rac"]` cho ra "het hang" (khang dinh tren rac), va
 * `orders` thieu `money` lam `o.money.remaining` nem chet ca luot tin.
 */
function kiemOutput(tool, data) {
    if (!la(data, "object"))
        return "data phai la mot doi tuong";
    const o = data;
    switch (tool) {
        case "catalog.search":
            return doi(o, "truncated", "boolean") ?? moiPhanTu(o, "items", (x) => doi(x, "id", "string") ?? doi(x, "code", "string") ?? doi(x, "name", "string"));
        case "stock.lookup":
            return doi(o, "asOf", "string") ?? doi(o, "truncated", "boolean") ?? moiPhanTu(o, "rows", (x) => doi(x, "variantLabel", "string", false) ?? soHuuHan(x, "qty") ?? soHuuHan(x, "price")
                ?? doi(x, "warehouseId", "string") ?? doi(x, "warehouseName", "string", false));
        case "variant.chart":
            return doi(o, "axis", "string", false) ?? moiPhanTu(o, "rows", (x) => doi(x, "label", "string", false));
        case "order.lookup":
            return moiPhanTu(o, "orders", (x) => doi(x, "orderId", "string") ?? doi(x, "status", "string", false) ?? tienTrenDon(x)
                ?? doi(x, "lines", "array"));
        case "order.draft":
        case "order.approve": return doi(o, "orderId", "string") ?? tienTrenDon(o);
        case "policy.get": return doi(o, "found", "boolean") ?? doi(o, "text", "string", false);
        case "shipment.track":
            return doi(o, "status", "string", false) ?? moiPhanTu(o, "history", (x) => doi(x, "text", "string", false));
        case "payment.status": return tienTrenDon(o);
        case "purchase.eta": return doi(o, "available", "boolean") ?? soHuuHan(o, "days", false);
        case "storefront.link": return doi(o, "url", "string", false);
        case "customer.recognize": return doi(o, "isReturning", "boolean") ?? soHuuHan(o, "orderCount");
        default: return null;
    }
}
//# sourceMappingURL=tools.js.map