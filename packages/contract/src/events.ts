/**
 * @file The event board.
 *
 * Architectural rule (specification, part 9): modules do not call each other directly. A module
 * that has something to say publishes an event; whoever cares subscribes. If the interested
 * module is switched off the event simply lands in silence: no error, no crash. That is what
 * lets a "starter" customer and a "full operations" customer run the same code base.
 */

import type { OrderId, ItemId, VariantId, WarehouseId, TenantId, ActorId, ConversationId } from "./ids";
import type { Money } from "./money";

export interface EventMap {
  /** An order was created (from chat, from the storefront, or by hand). */
  "order.created": { orderId: OrderId; source: "chat" | "storefront" | "manual" };
  /** The customer paid. The most valuable event in the system; several modules listen. */
  "order.paid": { orderId: OrderId; amount: Money; method: "bank" | "cod" | "other" };
  /** Order status changed. */
  "order.status_changed": { orderId: OrderId; from: string; to: string };
  /** Order cancelled. */
  "order.cancelled": { orderId: OrderId; reason: string };
  /** Stock changed. The brain's catalog loader listens to refresh its index. */
  "stock.changed": { itemId: ItemId; variantId: VariantId; warehouseId: WarehouseId; qty: number };
  /** A shipment was created. */
  "shipment.created": { orderId: OrderId; carrier: string; tracking: string };
  /** A partner reported out of stock; the refund chain starts here and the `tien` module listens. */
  "partner.out_of_stock": { orderId: OrderId; lineIndex: number; warehouseId: WarehouseId };
  /** A platform login session expired; the account-link screen turns red. */
  "link.session_expired": { platform: string; since: string };
  /** The bot handed the conversation to a human. */
  "bot.handoff": { conversationId: ConversationId; reason: string };
}

export type EventName = keyof EventMap;
export type EventPayload<K extends EventName> = EventMap[K];

export interface EventEnvelope<K extends EventName = EventName> {
  name: K;
  payload: EventMap[K];
  /** Who caused it: a staff member or the bot. Mandatory; an audit log without it is useless. */
  actor: ActorId;
  tenant: TenantId;
  /** ISO timestamp. */
  at: string;
}

/**
 * Mapped-type registry: adding an event to `EventMap` and forgetting it here is a COMPILE error.
 * (An earlier `readonly EventName[]` version failed silently; review caught it.)
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

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EVENT_NAME_SET, value);
}

/**
 * Events consumed OUTSIDE the merchant server process: the brain listens over the link, or
 * the UI listens to show a warning. Declared here so that `assertModuleGraph` does not flag
 * them as orphans while still catching events that truly nobody uses.
 */
export const EXTERNALLY_CONSUMED_EVENTS: { readonly [K in EventName]?: string } = {
  "stock.changed": "The brain refreshes its catalog index",
  "order.paid": "The brain acknowledges payment to the customer",
  "order.created": "The brain and reporting",
  "shipment.created": "The brain answers 'where is my order'",
  "link.session_expired": "The account-link screen turns red and Telegram is notified",
  "bot.handoff": "The person on duty is notified"
};
