/**
 * @file Branded identifier types shared by every part of the platform.
 *
 * Plain strings are easy to mix up: an `ItemId` passed where a `VariantId` is expected is a
 * bug plain JavaScript cannot catch. Branding the types makes such a mix-up a compile error,
 * which is one of the main reasons the contract is written in TypeScript.
 */

declare const brand: unique symbol;

/** Attaches a compile-time tag `B` to a base type `T` without changing its runtime shape. */
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** One merchant (one customer of the platform). Also called "shop" on the wire. */
export type TenantId = Brand<string, "TenantId">;
/** One specific machine of that merchant; licences are bound to machines. */
export type MachineId = Brand<string, "MachineId">;
/** One conversation on a channel (Messenger, Zalo, ...). */
export type ConversationId = Brand<string, "ConversationId">;
/** One item in the catalog. */
export type ItemId = Brand<string, "ItemId">;
/** One variant of an item: shoe size, drug strength, spa time slot, ... */
export type VariantId = Brand<string, "VariantId">;
/** One warehouse. */
export type WarehouseId = Brand<string, "WarehouseId">;
/** One order. */
export type OrderId = Brand<string, "OrderId">;
/** One user account in the operating console (staff, owner, or the bot itself). */
export type ActorId = Brand<string, "ActorId">;

export const asTenantId = (value: string): TenantId => value as TenantId;
export const asMachineId = (value: string): MachineId => value as MachineId;
export const asConversationId = (value: string): ConversationId => value as ConversationId;
export const asItemId = (value: string): ItemId => value as ItemId;
export const asVariantId = (value: string): VariantId => value as VariantId;
export const asWarehouseId = (value: string): WarehouseId => value as WarehouseId;
export const asOrderId = (value: string): OrderId => value as OrderId;
export const asActorId = (value: string): ActorId => value as ActorId;

/**
 * Identity of the bot itself when it calls tools on the merchant's server.
 *
 * The bot is an ordinary account with limited rights: it can read stock, look up orders and
 * draft orders; it can never move money, change prices or delete anything. Audit logs must be
 * able to tell the bot apart from humans, hence a dedicated actor id.
 */
export const BOT_ACTOR: ActorId = "bot" as ActorId;
