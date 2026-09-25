/**
 * Shared fixtures for the brain tests: fake ports (no network, no merchant machine, no model)
 * and a few catalog items. The engine is deterministic, so it can be tested completely.
 */

import fs from "node:fs";
import path from "node:path";
import * as B from "@sp/brain";
import type { CatalogItemLite, ConversationId, ItemId, StockRow, TenantId, ToolName, VariantId, WarehouseId } from "@sp/contract";

/**
 * The packs are JSON on disk since 21/09/2026 and the core may not read files, so the tests
 * install their own source. It reads the SHIPPED folder, not a fixture: a test passing against an
 * invented pack while the real one is broken is worse than no test. `@sp/xeon` owns the real
 * reader, but the brain's tests must not depend on it, so this is a deliberate 15-line twin.
 */
const INDUSTRY_DIRECTORY = ((): string => {
  // Walks up from wherever the runner was started (repo root or a package folder). `import.meta`
  // would be shorter but the test type-check compiles these files as CommonJS.
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    const candidate = path.join(dir, "nganh");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("Khong tim thay thu muc `nganh/` tu " + process.cwd());
})();

const readIndustryFile = (id: string, file: string): unknown => {
  const full = path.join(INDUSTRY_DIRECTORY, id, file);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
};

const readCommonFile = (file: string): unknown => {
  const full = path.join(INDUSTRY_DIRECTORY, "..", "loi-chung", file);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
};

B.usePackSource({
  ids: () => fs.readdirSync(INDUSTRY_DIRECTORY, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
  read: (id) => {
    const rules = readIndustryFile(id, "bo-luat.json");
    if (rules === null) return null;
    const agent = readIndustryFile(id, "agent.json");
    const dialogue = readIndustryFile(id, "khung-hoi-thoai.json");
    const systemNote = readIndustryFile(id, "ghi-chu-he-thong.json");
    const intentRules = readIndustryFile(id, "y-dinh.json");
    const entities = readIndustryFile(id, "thuc-the.json");
    const sizeChart = readIndustryFile(id, "bang-size.json");
    const scripts = readIndustryFile(id, "kich-ban.json");
    const matching = readIndustryFile(id, "cham-diem.json");
    const replyGate = readIndustryFile(id, "cong-soat.json");
    return {
      rules,
      ...(agent === null ? {} : { agent }),
      ...(dialogue === null ? {} : { dialogue }),
      ...(systemNote === null ? {} : { systemNote }),
      ...(intentRules === null ? {} : { intentRules }),
      ...(entities === null ? {} : { entities }),
      ...(sizeChart === null ? {} : { sizeChart }),
      ...(scripts === null ? {} : { scripts }),
      ...(matching === null ? {} : { matching }),
      ...(replyGate === null ? {} : { replyGate })
    };
  },
  common: () => readCommonFile("agent-chung.json"),
  commonFile: (name) => readCommonFile(`${name}.json`)
});

/** The two industries that ship, loaded from the folder above. */
export const runningShoesPack = B.loadPack("giay-chay");
export const pharmacyPack = B.loadPack("nha-thuoc");

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
  pack: runningShoesPack,
  state: { tenant: TENANT, conversationId: CONV, turns: [] },
  now: T0, draft: "", facts: [], intent: null,
  itemIdentified: true, wouldAskBack: false, online: true, catalogSize: 1200,
  claimsBrandNotCarried: false, hasPolicySource: false, echoedValues: [],
  ...over
});
