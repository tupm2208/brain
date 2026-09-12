"use strict";
// Cac ma dinh danh dung chung ba khoi.
// Dung kieu "gan nhan" (branded) de khong lo truyen nham ma nay sang cho ma kia —
// day chinh la thu ma JavaScript tran khong bat duoc, va la mot ly do chon TypeScript.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOT_ACTOR = exports.asActorId = exports.asOrderId = exports.asWarehouseId = exports.asVariantId = exports.asItemId = exports.asConversationId = exports.asMachineId = exports.asTenantId = void 0;
const asTenantId = (v) => v;
exports.asTenantId = asTenantId;
const asMachineId = (v) => v;
exports.asMachineId = asMachineId;
const asConversationId = (v) => v;
exports.asConversationId = asConversationId;
const asItemId = (v) => v;
exports.asItemId = asItemId;
const asVariantId = (v) => v;
exports.asVariantId = asVariantId;
const asWarehouseId = (v) => v;
exports.asWarehouseId = asWarehouseId;
const asOrderId = (v) => v;
exports.asOrderId = asOrderId;
const asActorId = (v) => v;
exports.asActorId = asActorId;
/**
 * Danh tinh cua chinh con bot khi no goi cong cu sang OMI.
 * Bot la MOT TAI KHOAN nhu nhan vien, quyen han che: doc ton, tra don, tao don nhap;
 * khong chi tien, khong sua gia, khong xoa. Nhat ky phan biet duoc bot voi nguoi.
 */
exports.BOT_ACTOR = "bot";
//# sourceMappingURL=ids.js.map