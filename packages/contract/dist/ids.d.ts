declare const brand: unique symbol;
type Brand<T, B extends string> = T & {
    readonly [brand]: B;
};
/** Mot nha ban hang (mot khach mua nen tang). */
export type TenantId = Brand<string, "TenantId">;
/** Mot may cu the cua nha ban hang do — ma kich hoat gan voi may nay. */
export type MachineId = Brand<string, "MachineId">;
/** Mot hoi thoai tren kenh (Messenger, Zalo...). */
export type ConversationId = Brand<string, "ConversationId">;
/** Mot mon hang trong muc luc. */
export type ItemId = Brand<string, "ItemId">;
/** Mot bien the cua mon hang: size giay, ham luong thuoc, khung gio spa... */
export type VariantId = Brand<string, "VariantId">;
/** Mot kho hang. */
export type WarehouseId = Brand<string, "WarehouseId">;
/** Mot don hang. */
export type OrderId = Brand<string, "OrderId">;
/** Mot tai khoan nguoi dung trong OMI (nhan vien, chu shop, hoac chinh con bot). */
export type ActorId = Brand<string, "ActorId">;
export declare const asTenantId: (v: string) => TenantId;
export declare const asMachineId: (v: string) => MachineId;
export declare const asConversationId: (v: string) => ConversationId;
export declare const asItemId: (v: string) => ItemId;
export declare const asVariantId: (v: string) => VariantId;
export declare const asWarehouseId: (v: string) => WarehouseId;
export declare const asOrderId: (v: string) => OrderId;
export declare const asActorId: (v: string) => ActorId;
/**
 * Danh tinh cua chinh con bot khi no goi cong cu sang OMI.
 * Bot la MOT TAI KHOAN nhu nhan vien, quyen han che: doc ton, tra don, tao don nhap;
 * khong chi tien, khong sua gia, khong xoa. Nhat ky phan biet duoc bot voi nguoi.
 */
export declare const BOT_ACTOR: ActorId;
export {};
//# sourceMappingURL=ids.d.ts.map