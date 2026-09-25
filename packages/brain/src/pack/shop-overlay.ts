/**
 * @file The rule engine's view of an industry pack FOR ONE SHOP (24/09/2026).
 *
 * The engine (`TurnEngine`) reads pronouns, banned phrases, the brands carried and not carried and
 * the "we do not have it" sentences from the pack. Those are the shop's (tier 3), not the
 * industry's, so before a turn the pack is overlaid with the shop profile: a shallow copy with
 * those fields replaced. The engine itself stays industry-agnostic and shop-agnostic.
 */

import type { ShopProfile } from "@sp/contract";
import type { IndustryPack } from "./types";

const lower = (list: readonly string[]): string[] => list.map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Reads the shop's "we do not have it" sentence for a brand and for a model. */
export function notCarriedSentences(cauKhongCo: string): { hang: string; mau: string } | null {
  const text = cauKhongCo.trim();
  if (text === "") return null;
  // "Hiện nhà em không còn mẫu đó / hãng đó ạ" → one sentence per case; a text without the slash is used as is.
  const halves = text.split("/").map((s) => s.trim());
  if (halves.length === 2) {
    const [a, b] = halves as [string, string];
    const tail = b.match(/\s(ạ|nhé|nha)\.?$/)?.[0] ?? "";
    const mau = /mẫu|mau/i.test(a) ? a + (/(ạ|nhé|nha)\.?$/.test(a) ? "" : tail) : b;
    const hang = /hãng|hang/i.test(b) ? b : a;
    return { hang: hang.replace(/hãng đó|hang do/i, "hàng {hang}"), mau };
  }
  return { hang: text, mau: text };
}

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
  const lexicon = {
    ...pack.lexicon,
    ...(p && p.hangCoBan.length > 0 ? { brands: lower(p.hangCoBan) } : {}),
    ...(p && p.hangKhongBan.length > 0 ? { knownBrandsNotCarried: lower(p.hangKhongBan) } : {})
  };
  const sentences = p ? notCarriedSentences(p.banHang.cauKhongCo) : null;
  const templates = sentences
    ? { ...pack.templates, brand_not_carried: sentences.hang, ...(pack.templates["out_of_stock"] ? {} : { out_of_stock: sentences.mau }) }
    : pack.templates;
  return { ...pack, identity, lexicon, templates };
}
