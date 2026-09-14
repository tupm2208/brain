/**
 * @file The catalog on Xeon: the reduced per-merchant index kept in the brain's memory.
 *
 * DECISION 3: the merchant keeps the source data, Xeon keeps only the catalog (name, code, brand,
 * selling price). Before this class existed the catalog only lived in test fakes, so two guards
 * were built but never installed:
 *   - `assertCatalogClean` only ran on the CONSOLE side at export time. Xeon kept whatever it was
 *     given; a tampered or buggy console could push customer phone numbers and Xeon would store
 *     them. The guard must sit at BOTH ends: sending so nothing leaks, receiving so nothing is trusted.
 *   - the filler-word collision check ("built but not installed" in the specification): a pack's
 *     filler word swallowing part of a merchant's item name means that item is never recognised.
 *
 * This is the ONLY place a catalog enters the brain, so both guards live in `load`.
 *
 * A filler collision is REPORTED, not REJECTED: the fault is in the industry pack (the platform's
 * job); the merchant cannot rename items to pass the gate, and rejecting the whole load because of
 * one item name would blind the merchant's bot without anyone knowing why. The collisions are
 * returned, logged, and kept for inspection so the platform operator sees them and fixes the pack.
 */

import {
  assertCatalogClean, coverage,
  type CatalogItem, type CatalogItemLite, type TenantId
} from "@sp/contract";
import type { IndustryPack } from "../pack/types";
import { checkFillerWordsAgainstCatalog } from "../pack/validator";
import type { CatalogPort } from "../ports/index";

export interface CatalogLoadResult {
  itemCount: number;
  /** Pack filler words that collide with this merchant's item names/codes. Empty means clean. */
  fillerWordCollisions: string[];
}

export interface XeonCatalog extends CatalogPort {
  /**
   * Replaces the WHOLE catalog of one merchant. Atomic: either every guard passes and the catalog
   * is swapped, or the old one stays and an error is thrown. An item of another merchant mixed in
   * is an error: Xeon serves many merchants, and one row with the wrong tenant makes this
   * merchant's bot sell someone else's goods.
   */
  load(tenant: TenantId, pack: IndustryPack, items: readonly CatalogItem[]): CatalogLoadResult;
  /** Drops one merchant's catalog (merchant left, or licence revoked). */
  drop(tenant: TenantId): void;
  /** Filler collisions of the most recent load. Empty when the merchant never loaded. */
  fillerWordCollisions(tenant: TenantId): string[];
}

interface MerchantIndex {
  items: CatalogItemLite[];
  /** `code + name` per item, precomputed once at load for `coverage`. */
  searchStrings: string[];
  fillerWordCollisions: string[];
}

export interface InMemoryCatalogOptions {
  /** Log sink for filler collisions; defaults to silence. */
  log?: ((line: string) => void) | undefined;
}

/** Catalog held in process memory. Enough for one Xeon; a restart requires reloading. */
export class InMemoryCatalog implements XeonCatalog {
  private readonly byTenant = new Map<TenantId, MerchantIndex>();
  private readonly log: (line: string) => void;

  constructor(options: InMemoryCatalogOptions = {}) {
    this.log = options.log ?? (() => undefined);
  }

  load(tenant: TenantId, pack: IndustryPack, items: readonly CatalogItem[]): CatalogLoadResult {
    const seenIds = new Set<string>();
    for (const item of items) {
      if (item.tenant !== tenant) {
        throw new Error(
          `Muc luc cua shop "${tenant}" mang mon "${item.code}" cua shop "${item.tenant}" — tu choi ca dot nap.`
        );
      }
      if (seenIds.has(item.id)) {
        throw new Error(`Muc luc cua shop "${tenant}" co hai mon cung ma "${item.id}" — tu choi ca dot nap.`);
      }
      seenIds.add(item.id);
    }
    // DECISION 3 guard at the RECEIVING end. Throwing leaves the old catalog untouched.
    assertCatalogClean(items);
    const collisions = checkFillerWordsAgainstCatalog(pack, items);
    if (collisions.length > 0) {
      this.log(
        `[muc-luc] ${tenant}: tu dem cua ho so "${pack.id}" nuot ten mon cua shop: ` +
          `${collisions.join(", ")} — sua ho so nganh, khong sua ten mon.`
      );
    }
    const lite: CatalogItemLite[] = items.map((item) => {
      const prices = item.variants.map((v) => v.price).sort((a, b) => a - b);
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        brand: item.brand,
        priceFrom: prices[0] ?? 0,
        variantCount: item.variants.length,
        url: item.url
      };
    });
    this.byTenant.set(tenant, {
      items: lite,
      searchStrings: lite.map((m) => `${m.code} ${m.name}`),
      fillerWordCollisions: collisions
    });
    return { itemCount: lite.length, fillerWordCollisions: collisions };
  }

  drop(tenant: TenantId): void {
    this.byTenant.delete(tenant);
  }

  fillerWordCollisions(tenant: TenantId): string[] {
    return [...(this.byTenant.get(tenant)?.fillerWordCollisions ?? [])];
  }

  async search(tenant: TenantId, query: string, limit: number): Promise<CatalogItemLite[]> {
    const index = this.byTenant.get(tenant);
    if (index === undefined || limit <= 0) return [];
    // Sort by coverage descending; ties keep WAREHOUSE ORDER so that tests are no easier than the
    // real merchant server (specification: the search engine returns in warehouse order).
    return index.items
      .map((item, i) => ({ item, i, score: coverage(query, index.searchStrings[i] ?? "") }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, limit)
      .map((x) => ({ ...x.item }));
  }

  async size(tenant: TenantId): Promise<number> {
    return this.byTenant.get(tenant)?.items.length ?? 0;
  }
}

/** Factory kept for callers that prefer a function over `new`. */
export function createInMemoryCatalog(options: InMemoryCatalogOptions = {}): XeonCatalog {
  return new InMemoryCatalog(options);
}
