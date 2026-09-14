/**
 * Shared fixtures for the brain tests: fake ports (no network, no merchant machine, no model)
 * and a few catalog items. The engine is deterministic, so it can be tested completely.
 */

import * as B from "@sp/brain";
import type { CatalogItemLite, ConversationId, ItemId, StockRow, TenantId, ToolName, VariantId, WarehouseId } from "@sp/contract";

export const TENANT = "t1" as TenantId;
export const CONV = "c1" as ConversationId;
export const T0 = new Date("2026-09-09T09:00:00.000Z");

export const BOSTON: CatalogItemLite = { id: "i1" as ItemId, code: "IE0000", name: "Adizero Boston 13", brand: "adidas", priceFrom: 3190000, variantCount: 8 };
export const PARA: CatalogItemLite = { id: "i9" as ItemId, code: "PARA500", name: "Paracetamol", brand: "traphaco", priceFrom: 25000, variantCount: 2 };

/** A stock row of the Boston shoe. */
export const row = (label: string, qty: number, wh = "w1", whName = "Kho nha", price = 3190000): StockRow => ({
  itemId: "i1" as ItemId, variantId: `v-${label}-${wh}` as VariantId, variantLabel: label,
  warehouseId: wh as WarehouseId, warehouseName: whName, qty, price
});

/** A stock row of paracetamol. */
export const pharmacyRow = (label: string, qty: number, price: number): StockRow => ({
  itemId: "i9" as ItemId, variantId: `h-${label}` as VariantId, variantLabel: label,
  warehouseId: "q1" as WarehouseId, warehouseName: "Quay 1", qty, price
});

export interface FakeOptions {
  rows?: StockRow[] | undefined;
  now?: Date | undefined;
  online?: boolean | undefined;
  available?: ToolName[] | undefined;
  stockFails?: boolean | undefined;
  truncated?: boolean | undefined;
  policy?: string | undefined;
  orders?: unknown[] | undefined;
  etaDays?: number | undefined;
  items?: CatalogItemLite[] | undefined;
  /** Keep warehouse order instead of sorting by coverage, like the real merchant server. */
  keepWarehouseOrder?: boolean | undefined;
  catalogSize?: number | undefined;
}

export interface FakePorts {
  calls: { tool: ToolName; input: unknown }[];
  setNow(d: Date): void;
  ports: B.Ports;
}

export function fakePorts(over: FakeOptions = {}): FakePorts {
  const calls: { tool: ToolName; input: unknown }[] = [];
  const store = new Map<string, B.ConversationState>();
  const rows = over.rows ?? [row("42", 3)];
  let now = over.now ?? T0;

  return {
    calls,
    setNow(d) { now = d; },
    ports: {
      clock: { now: () => now },
      tools: {
        online: () => over.online !== false,
        available: () => over.available ?? ["stock.lookup", "policy.get", "order.lookup", "catalog.search", "purchase.eta", "storefront.link"],
        async call(tool, input) {
          calls.push({ tool, input });
          if (tool === "stock.lookup") {
            return (over.stockFails === true
              ? { ok: false, tool, error: { code: "internal", message: "fake" } }
              : { ok: true, tool, data: { rows, asOf: T0.toISOString(), truncated: over.truncated === true } }) as B.ToolResult<typeof tool>;
          }
          if (tool === "policy.get") {
            return (over.policy === undefined
              ? { ok: true, tool, data: { found: false, text: "", updatedAt: "" } }
              : { ok: true, tool, data: { found: true, text: over.policy, updatedAt: T0.toISOString() } }) as B.ToolResult<typeof tool>;
          }
          if (tool === "order.lookup") {
            return (over.orders === undefined
              ? { ok: true, tool, data: { orders: [] } }
              : { ok: true, tool, data: { orders: over.orders } }) as B.ToolResult<typeof tool>;
          }
          if (tool === "purchase.eta") {
            return { ok: true, tool, data: { available: true, days: over.etaDays ?? 5 } } as B.ToolResult<typeof tool>;
          }
          return { ok: false, tool, error: { code: "not_found", message: "fake" } } as B.ToolResult<typeof tool>;
        }
      },
      catalog: {
        async search(_tenant, query) {
          const items = over.items ?? [BOSTON];
          const q = B.normalize(query);
          // Rank like a real search engine so the recognition threshold is exercised.
          const hits = items.filter((it) => B.tokens(`${it.code} ${it.name}`).some((t) => q.includes(t)));
          // The real merchant server returns in WAREHOUSE ORDER (`ORDER BY id`), not by coverage;
          // the engine must cope. `keepWarehouseOrder` keeps the test as hard as reality.
          return over.keepWarehouseOrder === true
            ? hits
            : hits.sort((a, b) => B.coverage(q, `${b.code} ${b.name}`) - B.coverage(q, `${a.code} ${a.name}`));
        },
        async size() { return over.catalogSize ?? 1200; }
      },
      memory: {
        async load(_t, id) { return store.get(id) ?? null; },
        async save(s) { store.set(s.conversationId, s); }
      }
    }
  };
}

/** One turn against a fake, with the running-shoes pack by default. */
export const ask = (ports: B.Ports, text: string, extra: Partial<B.HandleInput> = {}, packId = "giay-chay"): Promise<B.HandleResult> =>
  B.handleTurn(B.loadPack(packId), ports, { tenant: TENANT, conversationId: CONV, text, ...extra });

/** Deep copy of a pack so a test can break it without touching the shared object. */
export const clonePack = (pack: B.IndustryPack): B.IndustryPack => JSON.parse(JSON.stringify(pack)) as B.IndustryPack;

/** Baseline gate input a test can override. */
export const gateInput = (over: Partial<B.GateInput> = {}): B.GateInput => ({
  pack: B.runningShoesPack,
  state: { tenant: TENANT, conversationId: CONV, turns: [] },
  now: T0, draft: "", facts: [], intent: null,
  itemIdentified: true, wouldAskBack: false, online: true, catalogSize: 1200,
  claimsBrandNotCarried: false, hasPolicySource: false, echoedValues: [],
  ...over
});
