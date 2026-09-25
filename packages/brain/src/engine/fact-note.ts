/**
 * @file The system note handed to the level-2 agent: what tier 1 PROVED this turn, in blocks.
 *
 * Copied from Sales Desk `server.js` (16131–16248). Each block is a lesson from one real
 * conversation: tier 1 found Boston 13 but the agent said "not on sale yet" (v90, Khanh Beer);
 * the customer asked where the parcel was and the agent sent a product link instead of the
 * tracking link (11/09, Hoang Van Tinh). The block texts are data (`ghi-chu-he-thong.json`, tier 1
 * with the industry's wording on top); this file only knows which facts fill which block.
 *
 * Two hard rules from Desk: the note is cut at 4000 characters FROM THE END, so the tracking block
 * goes FIRST (a link cut in half is worse than no link); and the "found in stock" list is only
 * given on turns WITHOUT an image — a photo must be looked at, not guessed from the history.
 */

import type { SystemNoteTexts } from "../pack/types";
import { fillText, formatPrice } from "./fill-text";

/** The whole note; Desk's `.slice(0, 4000)`. */
export const NOTE_LIMIT = 4000;
/** The conversation summary alone; Desk's `.slice(0, 2500)`. */
export const SUMMARY_LIMIT = 2500;
const FOUND_LIMIT = 6;
const VARIANTS_PER_LINE = 16;

export interface FoundProduct {
  code: string;
  name: string;
  price?: number | undefined;
  /** Variants in stock ("41", "42 2/3"), as the lookup returned them. */
  variants?: string[] | undefined;
  /** Stocked by a partner warehouse (ordered in, not on hand). */
  partner?: boolean | undefined;
}

export interface LineFamily {
  name: string;
  note?: string | undefined;
  /** "Adizero SL 2 — 2.190.000đ — CAMPAIGN", already formatted by the caller. */
  examples?: string[] | undefined;
  campaignCount?: number | undefined;
  url: string;
}

/** What tier 1 proved this turn. Every block is optional; a block with no facts is not written. */
export interface TurnFacts {
  /** The shop's site ("toprun.site"), quoted in the tracking and product-type blocks. */
  site?: string | undefined;
  /** How the shop addresses the customer ("bác"), quoted in the closing lines. */
  customerPronoun?: string | undefined;
  /** SO_HOI_THOAI: the rendered ledger + episode (+ the model's summary). */
  conversationSummary?: string | undefined;
  /** The customer sent an image this turn: the DA_TIM_THAY block is withheld. */
  hasImage?: boolean | undefined;
  /** DA_TIM_THAY: what tier 1 found by the name the customer typed. */
  found?: FoundProduct[] | undefined;
  /** MAU_KHAC: the customer asked for other colours / variants of one product. */
  otherVariants?: { productName: string; productCode: string; requestedVariant?: string | undefined; items: FoundProduct[]; filterLink?: string | undefined } | undefined;
  /** PHO_THONG: an everyday need with no specific item. */
  everyday?: { purpose: string; variant?: string | undefined; gender?: string | undefined; groupLinks?: string | undefined } | undefined;
  /** NHIEU_DONG: tier 1 scored the fit and built one link per line family. */
  lineFamilies?: LineFamily[] | undefined;
  /** MON: the customer asked for a sport / category the shop does carry. */
  sport?: { label: string; purpose: string; count: number; variant?: string | undefined } | undefined;
  /** LOAI_HANG: the customer asked for a product type; the web has it even if the lookup came back empty. */
  productType?: { type: string; link: string; variant?: string | undefined } | undefined;
  /** SIZE_TEM: tier 1 converted the customer's measurement with the reference table. */
  variantHint?: { variant: string; label?: string | undefined; bareJp?: boolean | undefined; raw?: string | undefined; tem?: string | undefined } | undefined;
  /** DON_DOI_SIZE: tier 1 checked whether the order can still be changed. */
  orderExchange?: { orderId?: string | undefined; allowed: boolean; note?: string | undefined } | undefined;
  /** VAN_DON: the customer's parcel and its tracking link. */
  tracking?: { orderId?: string | undefined; statusLabel?: string | undefined; trackingCode?: string | undefined; trackingUrl: string } | undefined;
}

/** Cuts at the last whitespace before `limit`, so a link (no whitespace) is never split. */
export function cutNote(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
  return (cut > limit / 2 ? head.slice(0, cut) : head).trimEnd();
}

/** Composes the note from facts and the pack's block templates. */
export class FactNoteComposer {
  /** The note text, "" when no block has facts. */
  static compose(facts: TurnFacts, texts: SystemNoteTexts): string {
    const blocks = new FactNoteComposer(facts, texts).blocks();
    const order = texts.order.length > 0 ? texts.order : Object.keys(blocks);
    const parts: string[] = [];
    for (const key of order) {
      const text = blocks[key];
      if (text !== undefined && text !== "") parts.push(text);
    }
    return cutNote(parts.join("\n"), NOTE_LIMIT);
  }

  private constructor(private readonly facts: TurnFacts, private readonly texts: SystemNoteTexts) {}

  private t(key: string): string {
    return this.texts.blocks[key] ?? "";
  }

  /** Fills a block template. `{khach}` is the pronoun as given, `{Khach}` capitalised for a sentence start. */
  private fill(key: string, vars: Record<string, string | number | undefined>): string {
    const template = this.t(key);
    if (template === "") return "";
    const khach = String(vars["khach"] ?? this.facts.customerPronoun ?? "");
    return fillText(template, { ...vars, khach, Khach: khach.charAt(0).toUpperCase() + khach.slice(1) });
  }

  private line(p: FoundProduct, prefix: string): string {
    const variants = (p.variants ?? []).filter((v) => v !== "").slice(0, VARIANTS_PER_LINE).join(", ");
    return this.fill(`${prefix}.dong`, {
      ten: p.name !== "" ? p.name : p.code, ma: p.code,
      gia: p.price ? this.fill(`${prefix}.gia`, { gia: formatPrice(p.price) }) : "",
      bienThe: prefix === "DA_TIM_THAY" ? (variants !== "" ? this.fill(`${prefix}.bienThe`, { bienThe: variants }) : "") : variants,
      doiTac: p.partner === true ? this.t(`${prefix}.doiTac`) : ""
    });
  }

  private blocks(): Record<string, string> {
    const f = this.facts;
    const out: Record<string, string> = {};
    const site = f.site ?? "";
    const khach = f.customerPronoun ?? "";

    const summary = (f.conversationSummary ?? "").trim();
    if (summary !== "") out["SO_HOI_THOAI"] = cutNote(summary, SUMMARY_LIMIT);

    if (f.hasImage !== true && (f.found ?? []).length > 0) {
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const p of f.found ?? []) {
        const code = p.code.trim().toUpperCase();
        if (code === "" || seen.has(code)) continue;
        seen.add(code);
        lines.push(this.line({ ...p, code }, "DA_TIM_THAY"));
        if (lines.length >= FOUND_LIMIT) break;
      }
      if (lines.length > 0) out["DA_TIM_THAY"] = this.fill("DA_TIM_THAY", { danhSach: lines.join("\n") });
    }

    const ov = f.otherVariants;
    if (ov !== undefined && ov.items.length > 0) {
      out["MAU_KHAC"] = this.fill("MAU_KHAC", {
        ten: ov.productName, ma: ov.productCode,
        bienTheHoi: ov.requestedVariant ? this.fill("MAU_KHAC.bienTheHoi", { bienThe: ov.requestedVariant }) : "",
        danhSach: ov.items.map((p) => this.line(p, "MAU_KHAC")).join("\n"),
        linkLoc: ov.filterLink ? this.fill("MAU_KHAC.linkLoc", { link: ov.filterLink, khach }) : ""
      });
    }

    const ed = f.everyday;
    if (ed !== undefined) {
      out["PHO_THONG"] = this.fill("PHO_THONG", {
        mucDich: ed.purpose,
        bienThe: ed.variant ? this.fill("PHO_THONG.bienThe", { bienThe: ed.variant }) : "",
        gioiTinh: ed.gender ? this.fill("PHO_THONG.gioiTinh", { gioiTinh: ed.gender }) : "",
        khach,
        nhom: ed.groupLinks ? this.fill("PHO_THONG.nhom", { nhom: ed.groupLinks }) : ""
      });
    }

    const families = (f.lineFamilies ?? []).slice(0, 4);
    if (families.length > 0 && f.everyday === undefined) {
      const lines = families.map((l) => this.fill("NHIEU_DONG.dong", {
        ten: l.name, ghiChu: l.note ?? "",
        viDu: (l.examples ?? []).length > 0 ? this.fill("NHIEU_DONG.viDu", { viDu: (l.examples ?? []).slice(0, 2).join("; ") }) : "",
        campaign: l.campaignCount ? this.fill("NHIEU_DONG.campaign", { so: l.campaignCount }) : "",
        link: l.url
      }));
      out["NHIEU_DONG"] = this.fill("NHIEU_DONG", { so: lines.length, danhSach: lines.join("\n") });
    }

    const sp = f.sport;
    if (sp !== undefined) {
      out["MON"] = this.fill("MON", { mon: sp.label, so: sp.count, mucDich: sp.purpose, bienThe: sp.variant ? this.fill("MON.bienThe", { bienThe: sp.variant }) : "" });
    }

    const pt = f.productType;
    if (pt !== undefined && pt.link !== "") {
      out["LOAI_HANG"] = this.fill("LOAI_HANG", { loai: pt.type, site, link: pt.link, khach, bienThe: pt.variant ? this.fill("LOAI_HANG.bienThe", { bienThe: pt.variant }) : "" });
    }

    const vh = f.variantHint;
    if (vh !== undefined && vh.variant !== "") {
      out["SIZE_TEM"] = this.fill("SIZE_TEM", {
        nhan: vh.label ?? this.fill("SIZE_TEM.nhan", { size: vh.variant }),
        bienThe: vh.variant,
        bareJp: vh.bareJp === true ? this.fill("SIZE_TEM.bareJp", { goc: vh.raw ?? vh.tem ?? "" }) : "",
        tem: vh.tem ? this.fill("SIZE_TEM.tem", { tem: vh.tem.replace(".", ",") }) : ""
      });
    }

    const oe = f.orderExchange;
    if (oe !== undefined) {
      out["DON_DOI_SIZE"] = this.fill("DON_DOI_SIZE", {
        maDon: oe.orderId ? this.fill("DON_DOI_SIZE.maDon", { maDon: oe.orderId }) : "",
        ketLuan: this.t(oe.allowed ? "DON_DOI_SIZE.allowed" : "DON_DOI_SIZE.denied"),
        ghiChu: oe.note ?? ""
      }).trimEnd();
    }

    const tr = f.tracking;
    if (tr !== undefined && tr.trackingUrl !== "") {
      out["VAN_DON"] = this.fill("VAN_DON", {
        maDon: tr.orderId ?? "", trangThai: tr.statusLabel ? this.fill("VAN_DON.trangThai", { trangThai: tr.statusLabel }) : "",
        maVanDon: tr.trackingCode ?? "", link: tr.trackingUrl, site
      });
    }
    return out;
  }
}
