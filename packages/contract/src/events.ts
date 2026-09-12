// BANG TIN SU KIEN.
//
// Luat kien truc (Phan 9 ban dac ta): cac manh KHONG goi thang nhau. Manh nao co viec
// thi thong bao len bang tin; ai quan tam thi tu nghe. Manh chua bat thi loi thong bao
// roi vao im lang — khong loi, khong sap. Nho vay khach goi Khoi dong va khach goi
// Van hanh day du chay chung mot bo ma.

import type { OrderId, ItemId, VariantId, WarehouseId, TenantId, ActorId, ConversationId } from "./ids";
import type { Money } from "./money";

export interface EventMap {
  /** Don vua duoc tao (tu chat, tu gian hang, hoac nhap tay). */
  "order.created": { orderId: OrderId; source: "chat" | "storefront" | "manual" };
  /** Khach da tra tien — su kien dat nhat trong he, nhieu manh cung nghe. */
  "order.paid": { orderId: OrderId; amount: Money; method: "bank" | "cod" | "other" };
  /** Trang thai don doi. */
  "order.status_changed": { orderId: OrderId; from: string; to: string };
  /** Don bi huy. */
  "order.cancelled": { orderId: OrderId; reason: string };
  /** Ton kho doi — bo nap du lieu cua Bo nao nghe de cap nhat muc luc. */
  "stock.changed": { itemId: ItemId; variantId: VariantId; warehouseId: WarehouseId; qty: number };
  /** Da tao van don. */
  "shipment.created": { orderId: OrderId; carrier: string; tracking: string };
  /** Doi tac bao het hang — chuoi xu ly hoan tien bat dau tu day, manh `tien` nghe. */
  "partner.out_of_stock": { orderId: OrderId; lineIndex: number; warehouseId: WarehouseId };
  /** Mot phien dang nhap nen tang bi dut — man Lien ket tai khoan bao do. */
  "link.session_expired": { platform: string; since: string };
  /** Bot da chuyen cho nguoi that. */
  "bot.handoff": { conversationId: ConversationId; reason: string };
}

export type EventName = keyof EventMap;
export type EventPayload<K extends EventName> = EventMap[K];

export interface EventEnvelope<K extends EventName = EventName> {
  name: K;
  payload: EventMap[K];
  /** Ai gay ra viec nay: mot nhan vien, hoac chinh con bot. Bat buoc — nhat ky vo dung neu thieu. */
  actor: ActorId;
  tenant: TenantId;
  /** Thoi diem, dang ISO. */
  at: string;
}

/**
 * Bang khai kieu anh xa: them mot su kien vao EventMap ma quen o day la GAY LUC BIEN DICH.
 * (Ban cu dung `readonly EventName[]` nen quen thi im lang — agent phan bien bat duoc.)
 */
const EVENT_NAME_SET: { readonly [K in EventName]: true } = {
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

export const EVENT_NAMES = Object.keys(EVENT_NAME_SET) as EventName[];

export function isEventName(v: unknown): v is EventName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(EVENT_NAME_SET, v);
}

/**
 * Su kien duoc tieu thu BEN NGOAI tien trinh OMI — Bo nao nghe qua duong noi,
 * hoac giao dien nghe de bao do. Khai o day de `assertModuleGraph` khong bao nham
 * la "su kien mo coi", nhung van bat duoc su kien that su khong ai dung.
 */
export const EXTERNALLY_CONSUMED_EVENTS: { readonly [K in EventName]?: string } = {
  "stock.changed": "Bo nao cap nhat muc luc hang hoa",
  "order.paid": "Bo nao nhan khach xac nhan da nhan tien",
  "order.created": "Bo nao va bao cao",
  "shipment.created": "Bo nao tra loi 'don em toi dau roi'",
  "link.session_expired": "Man Lien ket tai khoan bao do, va bao Telegram",
  "bot.handoff": "Thong bao cho nguoi truc"
};
