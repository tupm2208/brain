/**
 * @file The content rules of Desk `enforcePolicyClaims` (c0-link) → (z) and of `server.js` after
 * level 2: photo requests answered with links, foreign links, a size converted from centimetres,
 * delivery days, the parcel's tracking link, advice outside the candidates, forgotten links.
 */

import type { SizeChartRow } from "../../pack/types";
import { gateNormalize, hasLetters, hostOf, splitSentences, tidy, wordIn, type GateContext, type ReplyRule, type RuleResult } from "./support";
import { escapeRe } from "../text-analysis";

/** The customer asks for more photos: nobody will take any, so the product links go instead (Desk v80). */
/**
 * The cards go with the reply, so "bấm vào link để xem ảnh" is wrong twice over: the customer gets the
 * pictures, and there is no link (Giai đoạn 7, hồ sơ that-18). The sentence is cut; a reply that
 * was only that sentence becomes the data's note.
 */
export class PhotoLinkClaimRule implements ReplyRule {
  readonly id = "photoLinkClaim";
  apply(reply: string, g: GateContext): RuleResult | null {
    if (g.src.cardsSent !== true) return null;
    const claim = g.re(g.cfg.photos.linkClaim);
    if (claim === null) return null;
    const sentences = splitSentences(reply);
    const kept = sentences.filter((sen) => !claim.test(gateNormalize(sen)));
    if (kept.length === sentences.length) return null;
    const rest = kept.join(" ").replace(/\s{2,}/g, " ").trim();
    return { reply: rest !== "" ? rest : g.fill(g.cfg.photos.cardsNote), trace: ["photo_link_claim_removed"] };
  }
}

/** "từ 2.890.000đ đến 2.890.000đ" — a range whose ends are equal is one price (25/09/2026). */
export class PriceRangeRule implements ReplyRule {
  readonly id = "priceRange";
  apply(reply: string, g: GateContext): RuleResult | null {
    const re = g.re(g.cfg.money.rangeSame, "giu");
    if (re === null) return null;
    const digits = (s: string): string => s.replace(/[^\d]/g, "");
    let changed = false;
    const out = reply.replace(re, (whole: string, a: string, b: string) => {
      if (digits(a) !== digits(b) || digits(a) === "") return whole;
      changed = true;
      return a.trim();
    });
    return changed ? { reply: out, trace: ["price_range_collapsed"] } : null;
  }
}

export class PhotosRule implements ReplyRule {
  readonly id = "photos";
  apply(reply: string, g: GateContext): RuleResult | null {
    const p = g.cfg.photos;
    // The landing sends the cards with this reply: the pictures ARE going, no link list needed.
    if (g.src.cardsSent === true) return null;
    if (!g.test(p.asks, g.custNow)) return null;
    const promise = g.re(p.promise);
    const cands: { name: string; url: string }[] = [];
    const push = (name: string, url: string | undefined): void => {
      const clean = String(url ?? "").trim();
      if (!/^https?:\/\//.test(clean) || cands.some((c) => c.url === clean)) return;
      cands.push({ name: String(name ?? "").trim(), url: clean });
    };
    (g.src.adviceCandidates ?? []).forEach((c) => push(c.name, c.link));
    g.src.found.forEach((it) => push(it.ten, it.link));
    const picks = cands.slice(0, p.maxLinks > 0 ? p.maxLinks : 3);
    const sentences = splitSentences(reply);
    const kept = promise === null ? sentences : sentences.filter((sen) => !promise.test(gateNormalize(sen)));
    let base = kept.join(" ").replace(/\s{2,}/g, " ").trim();
    if (picks.length > 0) {
      const missing = picks.filter((c) => !reply.includes(c.url));
      if (missing.length === 0 && kept.length === sentences.length) return null;
      if (missing.length > 0) {
        const lines = picks.map((c) => (c.name ? `• ${c.name}: ` : "• ") + c.url).join("\n");
        const lead = g.fill(picks.length > 1 ? p.leadMany : p.lead);
        base = `${base !== "" ? base + "\n" : ""}${lead}\n${lines}`;
      }
      return { reply: base, trace: [`photo_request_send_link:${picks.length}`] };
    }
    if (kept.length !== sentences.length && g.src.hasImages !== true) {
      return { reply: `${base !== "" ? base + " " : ""}${g.fill(p.noProduct)}`.trim(), trace: ["photo_request_no_product"] };
    }
    return null;
  }
}

/** A link to someone else's site is rebuilt on the shop's site when it carries a product code, else removed (Desk v42). */
export class LinkRule implements ReplyRule {
  readonly id = "link";
  apply(reply: string, g: GateContext): RuleResult | null {
    const allowed = g.allowedHosts();
    const bad = (reply.match(/https?:\/\/[^\s)]+/g) ?? []).filter((u) => !allowed.has(hostOf(u)));
    if (bad.length === 0) return null;
    let out = reply;
    const codeRe = g.re(g.cfg.link.codeInLink, "i");
    for (const link of bad) {
      const code = codeRe === null ? undefined : link.match(codeRe)?.[1];
      const rebuilt = code !== undefined && g.vars["site"] !== "" ? g.fill(g.cfg.link.productLink, { ma: code.toLowerCase() }) : "";
      out = out.split(link).join(rebuilt);
    }
    return { reply: tidy(out), trace: [`external_link_removed:${bad.length}`] };
  }
}

/**
 * The customer gave a foot length in cm and the bot named a size: the size must come from the
 * industry's chart (or be what the customer / a person / the catalog said). With a chart the wrong
 * number is corrected (`size_chart_fix`); without one the bot asks the brand instead (Desk (c) v32).
 */
export class SizeChartRule implements ReplyRule {
  readonly id = "sizeChart";
  apply(reply: string, g: GateContext): RuleResult | null {
    const s = g.cfg.sizeChart;
    const cmRe = g.re(s.customerCm);
    if (cmRe === null) return null;
    const custCm = cmRe.exec(g.cust);
    if (custCm === null || !g.test(s.mentionsSize, gateNormalize(reply))) return null;
    const cm = Number(custCm[1]!.replace(",", "."));
    const sizeRe = g.re(s.sizeInReply, "g");
    if (sizeRe === null) return null;
    const flat = (t: string): string => t.replace(/\//g, " ");
    const sizesInReply = Array.from(gateNormalize(reply).matchAll(sizeRe))
      .map((x) => `${x[1]}${x[2] ? " " + x[2].trim() : ""}`.replace(/\s+/g, " ").trim());
    if (sizesInReply.length === 0) return null;
    const chart = acceptableSizes(g.src.sizeChart ?? [], cm);
    const chartText = chart.join(" ");
    const known = (size: string): boolean => wordIn(flat(g.cust), flat(size)) || wordIn(flat(g.shop), flat(size)) || wordIn(flat(g.catalog), flat(size)) || (chartText !== "" && wordIn(flat(chartText), flat(size)));
    const unsourced = sizesInReply.filter((size) => !known(size));
    if (unsourced.length === 0) return null;
    if (chart.length > 0) {
      const want = chart[0]!;
      const before = reply;
      const out = reply.replace(/size\s*\d{2}(?:\s*[12]\s*\/\s*3|[.,]5)?/gi, `size ${want}`);
      return out === before ? null : { reply: out, trace: [`size_chart_fix:${unsourced.join(",")}->${want}`] };
    }
    if (g.test(s.hedge, gateNormalize(reply))) return null;
    return { reply: g.fill(s.askBack, { cm: custCm[1] }), trace: [`foot_cm_size_no_source:${unsourced.join(",")}`] };
  }
}

/** The chart's sizes for a foot length: the closest row first, then its two neighbours (a snug or roomy fit is one step away). */
export function acceptableSizes(rows: readonly SizeChartRow[], cm: number): string[] {
  if (rows.length === 0 || !Number.isFinite(cm)) return [];
  const sorted = [...rows].filter((r) => Number.isFinite(r.daiChanCm)).sort((a, b) => a.daiChanCm - b.daiChanCm);
  let best = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (best < 0 || Math.abs(sorted[i]!.daiChanCm - cm) < Math.abs(sorted[best]!.daiChanCm - cm)) best = i;
  }
  if (best < 0 || Math.abs(sorted[best]!.daiChanCm - cm) > 0.8) return [];
  const out = [sorted[best]!.size];
  if (sorted[best + 1] !== undefined) out.push(sorted[best + 1]!.size);
  if (sorted[best - 1] !== undefined) out.push(sorted[best - 1]!.size);
  return out;
}

/** "3-5 ngày" must appear as a pair in what a person said, the policy or the profile's lead time (Desk (d)). */
export class EtaRule implements ReplyRule {
  readonly id = "eta";
  apply(reply: string, g: GateContext): RuleResult | null {
    const etaRe = g.re(g.cfg.eta.pattern, "g");
    if (etaRe === null) return null;
    if (g.trace.some((t) => t.startsWith("deposit_amount"))) return null;
    const unsourced = (text: string): boolean => {
      for (const eta of gateNormalize(text).matchAll(etaRe)) {
        if (eta[1] && eta[2]) {
          if (!new RegExp(`(^|[^0-9])${eta[1]}\\s*(-|den|toi|->|~)\\s*${eta[2]}\\s*ngay`).test(g.source)) return true;
        } else if (eta[3]) {
          if (!new RegExp(`(^|[^0-9])${eta[3]}\\s*ngay`).test(g.source)) return true;
        }
      }
      return false;
    };
    if (!unsourced(reply)) return null;
    const cleaned = splitSentences(reply).filter((sen) => !unsourced(sen)).join(" ").replace(/\s{2,}/g, " ").trim();
    return { reply: hasLetters(cleaned) ? cleaned : g.fill(g.cfg.eta.fallback), trace: ["eta_no_source"] };
  }
}

/**
 * The parcel's tracking link (Desk 11/09, case Hoang Van Tinh): a carrier link nobody looked up is
 * removed, a product link put where the tracking link belongs is swapped, and when the customer asks
 * where the parcel is and the reply talks about the order, the real link is appended.
 */
export class TrackingRule implements ReplyRule {
  readonly id = "tracking";
  apply(reply: string, g: GateContext): RuleResult | null {
    const t = g.cfg.tracking;
    const track = g.src.lookups.tracking ?? null;
    const trace: string[] = [];
    let out = reply;
    let needsHuman: boolean | undefined;
    let handoffReason: string | undefined;
    if (g.src.inGroup === true) return null;
    // (z1) a carrier link with no source
    const carrierRe = carrierLinkRe(g.cfg.link.carrierHosts);
    if (carrierRe !== null) {
      const known = `${g.shop} ${g.cust} ${track ? gateNormalize(`${track.code ?? ""} ${track.url}`) : ""}`;
      const codeRe = g.re(t.carrierCode, "i");
      const bad = (out.match(carrierRe) ?? []).filter((link) => {
        if (track !== null && link === track.url) return false;
        const code = codeRe === null ? "" : (link.match(codeRe)?.[0] ?? "");
        return !(code !== "" && known.includes(gateNormalize(code)));
      });
      if (bad.length > 0) {
        for (const link of bad) out = out.split(link).join(track?.url ?? "");
        out = tidy(out);
        if (track === null || track.url === "") { needsHuman = true; handoffReason = t.handoffReason; }
        trace.push(`tracking_link_unverified:${bad.length}`);
      }
    }
    if (track !== null && track.url !== "" && g.test(t.asksShipment, g.custNow)) {
      const productRe = g.productLinkRe();
      const trackingWords = g.re(t.trackingWords);
      let fixed = false;
      if (productRe !== null) {
        const parts = out.split(/((?<=[.!?])\s+|\n+)/);
        out = parts.map((part, index) => {
          if (index % 2 === 1) return part;
          const inTracking = (track.code !== undefined && track.code !== "" && part.includes(track.code)) || trackingWords?.test(gateNormalize(part)) === true;
          if (!inTracking) return part;
          return part.replace(productRe, () => { fixed = true; return track.url; });
        }).join("");
      }
      if (fixed) { out = tidy(out); trace.push("tracking_link_fixed"); }
      const norm = gateNormalize(out);
      const aboutOrder = (track.code !== undefined && track.code !== "" && out.includes(track.code))
        || g.test(t.aboutOrder, norm)
        || (g.test(t.orderNoun, norm) && g.test(t.orderVerb, norm));
      if (!out.includes(track.url) && aboutOrder) {
        out = `${out.replace(/\s*$/, "")}\n${g.fill(t.addedText, { link: track.url })}`;
        trace.push("tracking_link_added");
      }
    }
    if (trace.length === 0) return null;
    return { reply: out, trace, ...(needsHuman !== undefined ? { needsHuman } : {}), ...(handoffReason !== undefined ? { handoffReason } : {}) };
  }
}

function carrierLinkRe(hosts: readonly string[]): RegExp | null {
  const clean = hosts.map((h) => hostOf(h)).filter((h) => h !== "");
  if (clean.length === 0) return null;
  return new RegExp(`https?:\\/\\/(www\\.)?(${clean.map(escapeRe).join("|")})\\/[^\\s)]*`, "gi");
}

/**
 * With a filtered list of candidates, a code outside it that neither the customer nor a person named
 * is invented advice (Desk (e) + the v60 note: what the finder returned this turn is NOT a licence,
 * a `tra_kho` call brings up to 8 items and every line the bot named would count as sourced).
 */
export class AdviceRule implements ReplyRule {
  readonly id = "advice";
  apply(reply: string, g: GateContext): RuleResult | null {
    const candidates = g.src.adviceCandidates ?? [];
    if (candidates.length === 0) return null;
    const allowed = new Set(candidates.map((c) => c.code.toUpperCase()));
    const outside = g.codesIn(reply).filter((code) => !allowed.has(code) && !wordIn(g.shop, gateNormalize(code)) && !wordIn(g.cust, gateNormalize(code)));
    if (outside.length === 0) return null;
    const top = candidates.slice(0, 2).map((c) => `${c.name} (${c.code})${c.price ? " giá " + Number(c.price).toLocaleString("vi-VN") + "đ" : ""}`).join(" và ");
    return { reply: g.fill(g.cfg.advice.replacement, { danhSach: top }), trace: [`outside_advice_candidates:${outside.join(",")}`] };
  }
}

/** Links the pipeline prepared and the model forgot: line links, the group link, the filter link (Desk `server.js` v78/v96). */
export class AppendLinksRule implements ReplyRule {
  readonly id = "appendLinks";
  apply(reply: string, g: GateContext): RuleResult | null {
    const a = g.cfg.appendLinks;
    const links = g.src.links;
    let out = reply.trim();
    if (out === "") return null;
    const added: string[] = [];
    const missingLines = (links.lineLinks ?? []).slice(0, 4).filter((l) => l.url !== "" && !out.includes(l.url));
    if (missingLines.length > 0 && a.lineText !== "") {
      out += "\n" + missingLines.map((l) => g.fill(a.lineText, { ten: l.name, link: l.url, soMau: l.count !== undefined && l.count > 0 ? ` (${l.count} mẫu đúng size)` : "" })).join("\n");
      added.push("line");
    }
    const productRe = g.productLinkRe();
    const hasShopLink = productRe !== null && productRe.test(out);
    const hasCode = g.codesIn(out).length > 0;
    if (links.groupLink !== undefined && links.groupLink !== "" && !out.includes(links.groupLink) && !hasShopLink && !hasCode && a.groupText !== "") {
      out += "\n" + g.fill(a.groupText, { link: links.groupLink });
      added.push("group");
    }
    if (links.filterLink !== undefined && links.filterLink !== "" && !out.includes(links.filterLink) && !/https?:\/\//.test(out) && a.filterText !== "") {
      out += "\n" + g.fill(a.filterText, { link: links.filterLink });
      added.push("filter");
    }
    if (added.length === 0) return null;
    return { reply: out, trace: [`append_missing_links:${added.join(",")}`] };
  }
}

