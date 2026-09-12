"use strict";
// BANG TIN SU KIEN.
//
// Luat kien truc (Phan 9 ban dac ta): cac manh KHONG goi thang nhau. Manh nao co viec
// thi thong bao len bang tin; ai quan tam thi tu nghe. Manh chua bat thi loi thong bao
// roi vao im lang — khong loi, khong sap. Nho vay khach goi Khoi dong va khach goi
// Van hanh day du chay chung mot bo ma.
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTERNALLY_CONSUMED_EVENTS = exports.EVENT_NAMES = void 0;
exports.isEventName = isEventName;
/**
 * Bang khai kieu anh xa: them mot su kien vao EventMap ma quen o day la GAY LUC BIEN DICH.
 * (Ban cu dung `readonly EventName[]` nen quen thi im lang — agent phan bien bat duoc.)
 */
const EVENT_NAME_SET = {
    "order.created": true,
    "order.paid": true,
    "order.status_changed": true,
    "order.cancelled": true,
    "stock.changed": true,
    "shipment.created": true,
    "partner.out_of_stock": true,
    "link.session_expired": true,
    "bot.handoff": true
};
exports.EVENT_NAMES = Object.keys(EVENT_NAME_SET);
function isEventName(v) {
    return typeof v === "string" && Object.prototype.hasOwnProperty.call(EVENT_NAME_SET, v);
}
/**
 * Su kien duoc tieu thu BEN NGOAI tien trinh OMI — Bo nao nghe qua duong noi,
 * hoac giao dien nghe de bao do. Khai o day de `assertModuleGraph` khong bao nham
 * la "su kien mo coi", nhung van bat duoc su kien that su khong ai dung.
 */
exports.EXTERNALLY_CONSUMED_EVENTS = {
    "stock.changed": "Bo nao cap nhat muc luc hang hoa",
    "order.paid": "Bo nao nhan khach xac nhan da nhan tien",
    "order.created": "Bo nao va bao cao",
    "shipment.created": "Bo nao tra loi 'don em toi dau roi'",
    "link.session_expired": "Man Lien ket tai khoan bao do, va bao Telegram",
    "bot.handoff": "Thong bao cho nguoi truc"
};
//# sourceMappingURL=events.js.map