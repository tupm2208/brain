// Cac ma dinh danh dung chung ba khoi.
// Dung kieu "gan nhan" (branded) de khong lo truyen nham ma nay sang cho ma kia —
// day chinh la thu ma JavaScript tran khong bat duoc, va la mot ly do chon TypeScript.

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

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

export const asTenantId = (v: string): TenantId => v as TenantId;
export const asMachineId = (v: string): MachineId => v as MachineId;
export const asConversationId = (v: string): ConversationId => v as ConversationId;
export const asItemId = (v: string): ItemId => v as ItemId;
export const asVariantId = (v: string): VariantId => v as VariantId;
export const asWarehouseId = (v: string): WarehouseId => v as WarehouseId;
export const asOrderId = (v: string): OrderId => v as OrderId;
export const asActorId = (v: string): ActorId => v as ActorId;

/**
 * Danh tinh cua chinh con bot khi no goi cong cu sang OMI.
 * Bot la MOT TAI KHOAN nhu nhan vien, quyen han che: doc ton, tra don, tao don nhap;
 * khong chi tien, khong sua gia, khong xoa. Nhat ky phan biet duoc bot voi nguoi.
 */
export const BOT_ACTOR: ActorId = "bot" as ActorId;
