/**
 * @file The rule engine's view of an industry pack FOR ONE SHOP (24/09/2026).
 *
 * The engine (`TurnEngine`) reads pronouns and banned phrases from the pack. Those are the shop's
 * (tier 3), not the industry's, so before a turn the pack is overlaid with the shop profile: a
 * shallow copy with those fields replaced. The engine itself stays industry-agnostic and shop-agnostic.
 *
 * 02/10/2026: the profile no longer lists brands carried / not carried nor a "we do not have it"
 * sentence (Dũng: what the shop sells is its stock). A brand the stock does not have is "đang hết
 * hàng" for every shop — tier 1, not an overlay.
 */

import type { ShopProfile } from "@sp/contract";
import type { IndustryPack } from "./types";

/**
 * The pack as this shop runs it. Only fields the profile SET replace the pack's; an unfilled
 * profile leaves the pack's own values (the industry's defaults), so an old shop keeps working.
 */
export function applyShopProfile(pack: IndustryPack, hoSo: ShopProfile | null | undefined, extraNeverSay: readonly string[] = []): IndustryPack {
  if (!hoSo && extraNeverSay.length === 0) return pack;
  const p = hoSo;
  const identity = {
    ...pack.identity,
    ...(p?.xungHo.khach ? { customerPronoun: p.xungHo.khach } : {}),
    ...(p?.xungHo.shop ? { selfPronoun: p.xungHo.shop } : {}),
    neverSay: [...new Set([...pack.identity.neverSay, ...extraNeverSay, ...(p?.cauCam ?? [])])]
  };
  return { ...pack, identity };
}
