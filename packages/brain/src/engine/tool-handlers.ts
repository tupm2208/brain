/**
 * @file Tool handlers: one Strategy per tool the engine knows how to run.
 *
 * Adding a tool = adding ONE handler class and ONE registry line. `PackValidator` cross-checks
 * the registry, so a pack cannot declare a tool the engine cannot run; before that check existed,
 * such a pack made the bot silently ask back forever.
 */

import { formatCustomerMoney, type ItemId, type ConversationId, type TenantId, type ToolInput, type ToolName } from "@sp/contract";
import type { IndustryPack } from "../pack/types";
import type { ConversationState, Ports, ToolResult } from "../ports/index";
import { labelMatches, labelValue } from "./axis";
import type { Fact } from "./gates";
import { numbersIn } from "./number-scan";
import { TemplateRenderer, packTemplate } from "./template";
import type { VariantNumberHints, VariantNumberScanner } from "./variant-numbers";

/** Everything a handler may read about the current turn. */
export interface ToolContext {
  pack: IndustryPack;
  ports: Ports;
  tenant: TenantId;
  conversationId: ConversationId;
  /** Timestamp of this turn; second half of the idempotency key. */
  turnAt: string;
  /** Customer sentence after alias expansion and normalisation. */
  text: string;
  /** Axes whose value was read from THIS sentence (not carried over from a previous turn). */
  slotsThisTurn: ReadonlySet<string>;
  /** Hints for the bare-number scanner in this turn. */
  numberHints: VariantNumberHints;
  scanner: VariantNumberScanner;
  itemCode: string | null;
  itemId: ItemId | null;
  slots: Record<string, string>;
  state: ConversationState;
  vars: Record<string, string>;
  /** Renderer configured with this pack's data placeholders, so tools guard holes like the outer loop. */
  renderer: TemplateRenderer;
}

export interface ToolOutcome {
  facts: Fact[];
  /** Slot values the tool INFERRED from the sentence (see `VariantNumberScanner.guessAxisValue`). */
  slotsFound?: Record<string, string>;
  /**
   * Axes whose PINNED value the tool removed (the customer named a new number for that axis and it
   * could not be resolved). The outer `slots` must be cleared too, otherwise the old value returns
   * next turn and a question about 43 is answered with 42 one turn later. Both un-pins must share
   * the same lifetime.
   */
  slotsCleared?: string[];
  vars: Record<string, string>;
  answered: boolean;
  hasPolicySource?: boolean;
  /** The call FAILED, as opposed to "succeeded with no data". */
  failed?: boolean;
  /** An axis value is still needed before answering. */
  needAxis?: string;
  /** The result was truncated; nothing may be asserted on it. */
  partial?: boolean;
  /** Data placeholders left empty in a sentence the tool rendered. */
  missing?: string[];
}

/** Strategy interface implemented once per tool. */
export interface ToolHandler {
  readonly tool: ToolName;
  run(ctx: ToolContext): Promise<ToolOutcome>;
}

const EMPTY: ToolOutcome = { facts: [], vars: {}, answered: false };
const FAILED: ToolOutcome = { facts: [], vars: {}, answered: false, failed: true };

/**
 * Calls a tool WITH the call context. Every tool call must go through here.
 *
 * The conversation id is a GATE on the merchant side, not decoration: a call without it cannot
 * open any order. The idempotency key is derived from the TURN (conversation + turn timestamp) so
 * that a network retry of the same turn yields the same result instead of a second draft order.
 * The key also includes the TOOL NAME: two different tools in one turn need two keys, while
 * calling the SAME tool again in the same turn must produce the same key.
 */
function callTool<K extends ToolName>(ctx: ToolContext, tool: K, input: ToolInput<K>): Promise<ToolResult<K>> {
  return ctx.ports.tools.call(tool, input, {
    conversationId: ctx.conversationId,
    idempotencyKey: `${ctx.conversationId}:${ctx.turnAt}:${tool}`
  });
}

class StockLookupHandler implements ToolHandler {
  readonly tool = "stock.lookup" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    if (ctx.itemCode === null) return EMPTY;
    const r = await callTool(ctx, "stock.lookup", { code: ctx.itemCode });
    if (!r.ok) return FAILED;
    // A truncated result makes every number suspect: 20 pairs of size 42 may sit past the first
    // page and the bot would say "out of size". Silence beats a wrong answer.
    if (r.data.truncated) return { ...EMPTY, partial: true };

    const axes = ctx.pack.itemShape.axes;
    let rows = r.data.rows;
    // Only filtering by a REQUIRED axis counts as "filtered". Earlier, a packaging value (optional
    // axis) also set the flag, disabling the strength question, and the bot summed two different
    // strengths together.
    // A required axis NOT read from this sentence: try to infer it from a bare number against the
    // REAL labels (before filtering, to see every variant).
    //
    // An inferred value MAY replace the value pinned from a previous turn. "co paracetamol 500mg
    // khong" then "loai 650 con khong": strength is still pinned to 500mg; without replacing it the
    // bot answers stock of 500mg to a question about 650, a CORRECT number for a DIFFERENT
    // question, exactly the kind of error no gate can catch because every number has a source.
    const slots: Record<string, string> = { ...ctx.slots };
    let slotsFound: Record<string, string> | undefined;
    const slotsCleared: string[] = [];
    for (const axis of axes) {
      if (!axis.requiredForStock || ctx.slotsThisTurn.has(axis.id)) continue;
      const guess = ctx.scanner.guessAxisValue(axis, rows, ctx.text, ctx.numberHints);
      if (guess !== null) {
        slots[axis.id] = guess;
        slotsFound = { ...(slotsFound ?? {}), [axis.id]: guess };
        continue;
      }
      // The sentence HAS a bare number that could not be resolved (two numbers, or two labels):
      // the value pinned earlier must be REMOVED too. Refusing a new number while still answering
      // with the old one is not silence; it is a correct number for a different question.
      if (ctx.scanner.bareNumbers(ctx.text, ctx.numberHints).length > 0 && slots[axis.id] !== undefined) {
        delete slots[axis.id];
        slotsCleared.push(axis.id);
      }
    }
    let filteredRequired = false;
    for (const axis of axes) {
      const want = slots[axis.id];
      if (want === undefined) continue;
      const filtered = rows.filter((x) => labelMatches(axis, want, x.variantLabel));
      if (axis.requiredForStock) {
        rows = filtered;
        filteredRequired = true;
      } else if (filtered.length > 0) {
        rows = filtered;
      }
      // An OPTIONAL axis filtering down to nothing ("cho em 2 vien" when labels carry no packaging):
      // DROP that filter. Keeping it yields `total = 0` and "out of stock" while 12 boxes are on
      // the shelf, the worst error in the specification, on the most ordinary counter sentence.
    }

    const facts: Fact[] = rows.map((x) => ({
      source: "stock.lookup",
      text: `${x.variantLabel}: con ${x.qty} tai ${x.warehouseName}, gia ${x.price}`,
      numbers: [x.qty, x.price, ...numbersIn(x.variantLabel)]
    }));

    // NOT filtered by the required axis while the shelf has several variants: NEVER sum them and
    // label the sum with the first row. That is how the bot says "con 5 doi size 42" while size 42
    // has 0; every number has a source so no gate can catch it.
    const mainAxis = axes[0];
    const labels = new Set(rows.map((x) => (mainAxis === undefined ? x.variantLabel : labelValue(mainAxis, x.variantLabel))));
    const needAxis = axes.find((a) => a.requiredForStock && slots[a.id] === undefined);
    if (!filteredRequired && needAxis !== undefined && labels.size > 1) {
      return {
        facts, answered: false, needAxis: needAxis.id,
        vars: { dsbienthe: [...labels].join(", ") },
        ...(slotsCleared.length === 0 ? {} : { slotsCleared })
      };
    }

    const total = rows.reduce((s, x) => s + x.qty, 0);
    const prices = [...new Set(rows.map((x) => x.price))].sort((a, b) => a - b);
    const warehouses = new Set(rows.map((x) => x.warehouseId));
    const first = rows[0];

    if (rows.length > 0) {
      facts.push({
        source: "stock.lookup",
        text: `tong ton ${total} tai ${warehouses.size} kho`,
        numbers: [total, warehouses.size, ...prices]
      });
    }

    const vars: Record<string, string> = {
      // Non-finite (a row without `qty`) stays EMPTY so the "empty placeholder" guard fires; "Con
      // NaN doi" would be a sentence without digits, invisible to the number gate.
      ton: Number.isFinite(total) ? String(total) : "",
      // Money for customers goes through ONE origin (`formatCustomerMoney`). The number gate reads
      // that form back (currency signs are removed before diacritics are stripped), so changing the
      // format here does not make the bot block itself.
      gia: prices[0] === undefined ? "" : formatCustomerMoney(prices[0]),
      giacao: prices[prices.length - 1] === undefined
        ? "" : formatCustomerMoney(prices[prices.length - 1] as number),
      kho: first?.warehouseName ?? "",
      sokho: String(warehouses.size),
      dsbienthe: [...labels].join(", ")
    };
    if (mainAxis !== undefined && slots[mainAxis.id] === undefined && labels.size === 1) {
      const only = [...labels][0] ?? "";
      vars[mainAxis.id] = only;
      vars["bienthe"] = only;
    }

    // Several prices in one answer: use the pack's range template when it has one, otherwise the
    // lowest price, leaving `giacao` available for the pack to use.
    const key = total <= 0
      ? "out_of_stock"
      : (prices.length > 1 && packTemplate(ctx.pack, "in_stock_range") !== "" ? "in_stock_range" : "in_stock");
    // The real sales sentence is rendered HERE, so empty placeholders must be guarded HERE. Before,
    // the outer loop only saw a filled `{tinhtrang}` and a broken "Con 5 hop , gia 25000 a" went
    // straight to the customer.
    const sentence = ctx.renderer.render(packTemplate(ctx.pack, key), { ...ctx.vars, ...vars, ...(slotsFound ?? {}) });
    vars["tinhtrang"] = sentence.text;
    return {
      facts, vars, answered: true, missing: sentence.missing,
      ...(slotsFound === undefined ? {} : { slotsFound }),
      ...(slotsCleared.length === 0 ? {} : { slotsCleared })
    };
  }
}

class PolicyGetHandler implements ToolHandler {
  readonly tool = "policy.get" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    const topic = ctx.slots["topic"] ?? "";
    const r = await callTool(ctx, "policy.get", { topic });
    if (!r.ok) return FAILED;
    if (!r.data.found) return EMPTY;
    return {
      facts: [{ source: "policy.get", text: r.data.text, numbers: numbersIn(r.data.text) }],
      vars: { chinhsach: r.data.text, tinhtrang: r.data.text },
      answered: true,
      hasPolicySource: true
    };
  }
}

class OrderLookupHandler implements ToolHandler {
  readonly tool = "order.lookup" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    const phone = ctx.slots["phone"];
    if (phone === undefined) return EMPTY;
    const r = await callTool(ctx, "order.lookup", {
      conversationId: ctx.conversationId,
      phoneGivenInConversation: phone
    });
    if (!r.ok) return FAILED;
    const order = r.data.orders[0];
    if (order === undefined) return EMPTY;
    return {
      facts: [{
        source: "order.lookup",
        text: `don ${order.orderId} trang thai ${order.status}, con phai tra ${order.money.remaining}`,
        // Numbers inside the STATUS ("con 2 ngay nua toi") are facts the merchant wrote; without
        // them as a source the correct reply gets blocked.
        numbers: [
          order.money.total, order.money.paid, order.money.remaining,
          ...numbersIn(String(order.orderId)), ...numbersIn(order.status)
        ]
      }],
      vars: {
        madon: String(order.orderId), trangthai: order.status,
        conphaitra: formatCustomerMoney(order.money.remaining)
      },
      answered: true
    };
  }
}

class PurchaseEtaHandler implements ToolHandler {
  readonly tool = "purchase.eta" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    if (ctx.itemId === null) return EMPTY;
    const r = await callTool(ctx, "purchase.eta", { itemId: ctx.itemId });
    if (!r.ok) return FAILED;
    const days = r.data.days;
    return {
      facts: days === undefined ? [] : [{ source: "purchase.eta", text: `ve trong ${days} ngay`, numbers: [days] }],
      vars: { songay: days === undefined ? "" : String(days) },
      answered: r.data.available
    };
  }
}

class StorefrontLinkHandler implements ToolHandler {
  readonly tool = "storefront.link" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    const r = await callTool(ctx, "storefront.link", { q: ctx.itemCode ?? "" });
    if (!r.ok) return FAILED;
    return { facts: [], vars: { link: r.data.url }, answered: true };
  }
}

class VariantChartHandler implements ToolHandler {
  readonly tool = "variant.chart" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    if (ctx.itemId === null) return EMPTY;
    const r = await callTool(ctx, "variant.chart", { itemId: ctx.itemId });
    if (!r.ok) return FAILED;
    const labels = r.data.rows.map((x) => x.label);
    return {
      facts: [{ source: "variant.chart", text: labels.join(", "), numbers: labels.flatMap((l) => numbersIn(l)) }],
      vars: { dsbienthe: labels.join(", ") },
      answered: labels.length > 0
    };
  }
}

class CustomerRecognizeHandler implements ToolHandler {
  readonly tool = "customer.recognize" as const;

  async run(ctx: ToolContext): Promise<ToolOutcome> {
    const r = await callTool(ctx, "customer.recognize", { conversationId: ctx.conversationId });
    if (!r.ok) return FAILED;
    return EMPTY;
  }
}

/** Registry of handlers keyed by tool name. */
export class ToolDispatcher {
  private readonly handlers = new Map<ToolName, ToolHandler>();

  constructor(handlers: readonly ToolHandler[] = DEFAULT_HANDLERS) {
    for (const h of handlers) this.handlers.set(h.tool, h);
  }

  /** Tools this dispatcher can run. */
  dispatchable(): ToolName[] {
    return [...this.handlers.keys()];
  }

  handler(tool: ToolName): ToolHandler | undefined {
    return this.handlers.get(tool);
  }
}

const DEFAULT_HANDLERS: readonly ToolHandler[] = [
  new StockLookupHandler(),
  new PolicyGetHandler(),
  new OrderLookupHandler(),
  new PurchaseEtaHandler(),
  new StorefrontLinkHandler(),
  new VariantChartHandler(),
  new CustomerRecognizeHandler()
];

export const DEFAULT_TOOL_DISPATCHER = new ToolDispatcher();

/** Tools the engine knows how to run. `PackValidator` cross-checks packs against this list. */
export const DISPATCHABLE_TOOLS: ToolName[] = DEFAULT_TOOL_DISPATCHER.dispatchable();
