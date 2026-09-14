/**
 * @file Ports: the engine's only doors to the outside world.
 *
 * The engine never opens a connection, never reads the system clock, never calls an AI model.
 * Everything goes through these interfaces, which is what makes the engine fully testable with
 * fakes: no network, no merchant machine, no model costs.
 */

import type {
  CatalogItemLite, ConversationId, LinkError, TenantId, ToolInput, ToolName, ToolOutput
} from "@sp/contract";

export type ToolResult<K extends ToolName> =
  | { ok: true; tool: K; data: ToolOutput<K> }
  | { ok: false; tool: K; error: LinkError };

/**
 * Context of ONE tool call. Neither field is optional in meaning:
 *
 * - `conversationId`: the merchant server uses it as a GATE. A call that does not carry the
 *   conversation cannot open any order; this is where "every call belongs to a real
 *   conversation" is enforced, rather than promised in documentation.
 * - `idempotencyKey`: the link retries after a network drop. Without the key the customer
 *   receives TWO draft orders for one purchase.
 */
export interface CallCtx {
  conversationId: ConversationId;
  idempotencyKey?: string | undefined;
}

/** Calls tools on the merchant server. */
export interface ToolPort {
  /** Tools that can really be called right now (licence intersected with the pack). */
  available(): ToolName[];
  call<K extends ToolName>(
    tool: K, input: ToolInput<K>, ctx?: CallCtx | undefined
  ): Promise<ToolResult<K>>;
  /** Whether the merchant server is reachable. Offline puts the bot in restricted mode. */
  online(): boolean;
}

/** The catalog the brain may consult: names, codes, attributes. No customer data. */
export interface CatalogPort {
  search(tenant: TenantId, query: string, limit: number): Promise<CatalogItemLite[]>;
  /** Total number of items. The "we do not carry brand X" gate needs this number. */
  size(tenant: TenantId): Promise<number>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** One line of a conversation. */
export interface Turn {
  role: "customer" | "shop";
  text: string;
  at: string;
  /** Number of images the customer sent in that turn; the "already sent a photo" check reads it. */
  imageCount?: number | undefined;
}

/** Conversation state persisted between turns. */
export interface ConversationState {
  conversationId: ConversationId;
  tenant: TenantId;
  turns: Turn[];
  /** Item in focus for the current shopping episode. */
  focusItemCode?: string | undefined;
  /** Internal id of that item; tools that take an `ItemId` must use this, never the merchant code. */
  focusItemId?: string | undefined;
  /** Known values per variant axis: { size: "42" }, { thoiluong: "60 phut" }. */
  focusSlots?: Record<string, string> | undefined;
  /** Intent of the previous turn, so that a terse reply ("42", "ok") reads as a continuation. */
  lastIntentId?: string | undefined;
  /** Slot the bot just asked for. A terse next message is understood as answering it. */
  lastAskedSlot?: string | undefined;
  /** Start of the current shopping episode (ISO). */
  episodeStartedAt?: string | undefined;
  /** Last time the bot asked the customer back (ISO); the `ask_back_once` gate reads it. */
  lastAskBackAt?: string | undefined;
  /**
   * How many times the bot asked back in this episode.
   * A timestamp alone is not enough: customers on Fanpage often answer after the 30-minute
   * window, and the bot would keep asking forever without ever calling a human.
   */
  askBackCount?: number | undefined;
  /**
   * Consecutive turns in which the bot could only greet because no intent was found.
   * Without the counter, "alo", "ok", "co ai khong" makes the bot loop greetings forever.
   */
  idleCount?: number | undefined;
  /** Phone number the customer TYPED in this conversation. Never taken from any other source. */
  phoneGivenInConversation?: string | undefined;
  handedOff?: boolean | undefined;
}

export interface MemoryPort {
  load(tenant: TenantId, conversationId: ConversationId): Promise<ConversationState | null>;
  save(state: ConversationState): Promise<void>;
}

/**
 * Door to an AI model. INTENTIONALLY optional: the engine runs completely without it.
 * Rules run first, the model second, and the model may only rephrase within what the engine allows.
 */
export interface AdvisorPort {
  /** Rewrites a sentence more naturally WITHOUT adding numbers or new commitments. */
  rephrase(input: { draft: string; tone: string[]; facts: string[] }): Promise<string>;
}

export interface Ports {
  tools: ToolPort;
  catalog: CatalogPort;
  memory: MemoryPort;
  clock: Clock;
  advisor?: AdvisorPort | undefined;
}
