/**
 * @file The reply rules of a variant said from a MEASUREMENT (05/10/2026, phiếu Desk nhóm số đo).
 *
 * Three rules for every shop whose variants follow a body measurement:
 *
 * - `SizePendingRule` — the measurements the industry needs are not all there (`sizeHint.status`
 *   "thieu"): a sentence that ADVISES a variant the customer never said is cut (clause by clause, a
 *   stock sentence listing variants stays), a shop link loses its variant parameter, and the sentence
 *   asking for the missing measurements goes in its place (phiếu 26/09 "chỉ báo dài chân").
 * - `SizePairRule` — every PAIR the bot writes must be one row of the brand's chart: a variant label
 *   beside a centimetre value (the tag, or the body measurement), a variant label beside another
 *   system's label (UK). Which side is repaired follows the origin: what the customer said is the
 *   root, a number the bot added follows it (phiếu 01/09 + 22/09).
 * - helpers for `SizeChartRule` (content-rules.ts): only a CONVERSION sentence is repaired, never the
 *   stock sentence next to it (phiếu 26/09 "cổng size thay mọi size trong tin").
 *
 * Every word is tier 2 data (`cong-soat.json` `sizeChart` / `sizePair`); the rows come from the
 * pipeline (`variantRows`: the brand's own chart from the landing, or the industry table).
 */

import type { VariantRow } from "../size-advisor";
import { sameVariantLabel } from "../size-advisor";
import { escapeRe, stripDiacritics } from "../text-analysis";
import { gateNormalize, hostOf, type GateContext, type ReplyRule, type RuleResult } from "./support";

/** The reply cut into sentences WITH their ending (punctuation, newline): joining them gives the reply back. */
export function splitPieces(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "\n" || (/[.!?]/.test(ch) && (i + 1 >= text.length || /\s/.test(text[i + 1]!)))) {
      let end = i + 1;
      // The space after a full stop belongs to the sentence it ends.
      while (end < text.length && text[end] === " ") end += 1;
      pieces.push(text.slice(start, end));
      start = end;
      i = end - 1;
    }
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

/** "44" + " 2/3" → "44 2/3"; "42" + ",5" → "42.5". */
export function variantLabel(num: string, frac: string | undefined): string {
  const f = String(frac ?? "").replace(/\s+/g, "");
  if (f === "") return num;
  if (/^[.,]/.test(f)) return `${num}.5`;
  const third = /^([12])\/?3$/.exec(f);
  return third ? `${num} ${third[1]}/3` : `${num} ${f}`;
}

/** Every label a pattern (group 1 number, group 2 fraction) finds in a text, with its place. */
export function labelsIn(text: string, re: RegExp | null): { label: string; start: number; end: number }[] {
  if (re === null) return [];
  const out: { label: string; start: number; end: number }[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    if (!m[1]) continue;
    const at = m.index ?? 0;
    const start = at + m[0].indexOf(m[1]);
    const end = at + m[0].length;
    out.push({ label: variantLabel(m[1], m[2]), start, end });
  }
  return out;
}

/** The number as written to the customer: 26.5 → "26,5", 28 → "28". */
export function formatMeasure(value: number): string {
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

/** A number typed by the customer (accent-stripped text), not followed by a unit that makes it something else. */
export function customerSaidNumber(custNorm: string, value: number, notNumber: string): boolean {
  const n = String(value).replace(".", "\\.");
  const tail = notNumber === "" ? "" : `|${notNumber.replace(/^\^/, "")}`;
  try {
    return new RegExp(`(?<![\\d.,/])${n}(?:\\.0)?(?![\\d/]|\\.\\d${tail})`).test(custNorm.replace(/(\d),(\d)/g, "$1.$2"));
  } catch {
    return false;
  }
}

/** The sentence converts from the customer's measurement: the industry's words, or the measurement itself quoted. */
export function isConversionPiece(piece: string, g: GateContext): boolean {
  const re = g.re(g.cfg.sizeChart.conversion, "iu");
  if (re !== null && re.test(piece)) return true;
  const said = g.src.sizeHint?.primarySaid ?? "";
  if (said === "") return false;
  const n = said.replace(".", "[.,]");
  return new RegExp(`(?<![\\d.,])${n}(?![\\d]|[.,]\\d)`).test(piece);
}

/**
 * 05/10/2026 (phiếu Desk 26/09 "chỉ báo dài chân thì xin đủ thông số"): the industry needs more
 * measurements before a variant may be named. Cuts the bot's own variant advice, keeps stock talk.
 */
export class SizePendingRule implements ReplyRule {
  readonly id = "sizePending";
  apply(reply: string, g: GateContext): RuleResult | null {
    const hint = g.src.sizeHint ?? null;
    if (hint === null || hint.status !== "thieu") return null;
    const s = g.cfg.sizeChart;
    const botRe = g.re(s.botVariant, "giu");
    if (botRe === null) return null;
    const text = reply.normalize("NFC");
    const custSizes = new Set(labelsIn(String(g.src.customerSaid ?? "").normalize("NFC"), g.re(s.customerVariant, "giu")).map((l) => l.label));
    const said = (label: string): boolean => [...custSizes].some((c) => sameVariantLabel(c, label));
    const own = (t: string): string[] => labelsIn(t, botRe).map((l) => l.label).filter((l) => !said(l));
    const adviceVerb = g.re(s.adviceVerb, "iu");
    const stockWord = g.re(s.stockWord, "iu");
    const linkRe = shopLinkWithVariant(g);
    const linkOwnSize = (t: string): boolean => linkRe !== null && [...t.matchAll(linkRe)].some((m) => !said(decodeVariant(m[3] ?? "")));
    const isAdvice = (t: string): boolean => {
      if (own(t).length === 0 && !linkOwnSize(t)) return false;
      if (isConversionPiece(t, g) || linkOwnSize(t)) return true;
      return adviceVerb !== null && adviceVerb.test(t) && !(stockWord !== null && stockWord.test(t));
    };
    const dropped: string[] = [];
    let firstDrop = -1;
    const pieces = splitPieces(text);
    const kept: (string | { links: string[]; tail: string })[] = pieces.map((piece, idx) => {
      if (!isAdvice(piece)) return piece;
      const lead = /^\s*/.exec(piece)![0];
      const tail = /\s*$/.exec(piece)![0];
      const body = piece.slice(lead.length, piece.length - tail.length);
      const clauses = body.split(/(?<=[,;])\s+/);
      const keepClauses = clauses.filter((c) => !isAdvice(c));
      dropped.push(...own(piece));
      // A clause left on its own keeps only when it still says something about a variant (stock talk) and quotes no measurement.
      if (keepClauses.length > 0 && keepClauses.length < clauses.length && !keepClauses.some((c) => isConversionPiece(c, g)) && keepClauses.some((c) => labelsIn(c, botRe).length > 0 || /\d/.test(c))) {
        const joined = keepClauses.join(" ").replace(/[,;]\s*$/, "").trim();
        return lead + joined + (/[.!?]$/.test(joined) ? "" : ".") + (tail === "" ? " " : tail);
      }
      if (firstDrop < 0) firstDrop = idx;
      const all = shopLinks(g);
      const links = all === null ? [] : [...body.matchAll(all)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
      return { links, tail };
    });
    let linkTouched = false;
    const fixLinks = (t: string): string => linkRe === null ? t : t.replace(linkRe, (all: string, head: string, sep: string, value: string, amp: string) => {
      if (said(decodeVariant(value))) return all;
      linkTouched = true;
      dropped.push(decodeVariant(value));
      return amp ? head + sep : head;
    });
    const fixed = kept.map((p) => (typeof p === "string" ? fixLinks(p) : { ...p, links: p.links.map(fixLinks) }));
    if (dropped.length === 0 && !linkTouched) return null;
    const pageAsked = g.test(s.askedBefore, gateNormalize(g.src.pageSaid ?? g.src.shopSaid));
    const ask = g.fill(pageAsked && s.askMeasuresShort !== "" ? s.askMeasuresShort : s.askMeasures, { thieu: hint.missing.join(", "), daCo: hint.given.join(", ") });
    const keptText = fixed.filter((p): p is string => typeof p === "string").join("");
    let askPlaced = ask === "" || g.test(s.alreadyAsks, gateNormalize(keptText));
    const out = fixed.map((p, idx) => {
      if (typeof p === "string") return p;
      const linkLine = p.links.length > 0 && s.linkLine !== "" ? g.fill(s.linkLine, { link: p.links.join(" ") }) : "";
      if (!askPlaced && idx === firstDrop) { askPlaced = true; return ask + (linkLine !== "" ? `\n${linkLine}` : "") + (p.tail === "" ? " " : p.tail); }
      return linkLine !== "" ? linkLine + (p.tail === "" ? " " : p.tail) : "";
    });
    let result = out.join("");
    if (!askPlaced) result = `${result.replace(/\s*$/, "")}\n\n${ask}`;
    result = result.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (result === reply.trim()) return null;
    return { reply: result, trace: [`size_needs_measures:${[...new Set(dropped)].join(",")}${linkTouched ? ",link" : ""}`] };
  }
}

/** The shop's own links carrying a variant parameter: groups head, separator, value, trailing "&". `null` without a site. */
function shopLinkWithVariant(g: GateContext): RegExp | null {
  const host = hostOf(g.src.site ?? "");
  if (host === "") return null;
  return new RegExp(`(https?:\\/\\/(?:www\\.)?${escapeRe(host)}\\/[^\\s)]*?)([?&])size=([^&#\\s)]*)(&?)`, "gi");
}

/** Every link to the shop's own site. `null` without a site. */
function shopLinks(g: GateContext): RegExp | null {
  const host = hostOf(g.src.site ?? "");
  if (host === "") return null;
  return new RegExp(`https?:\\/\\/(?:www\\.)?${escapeRe(host)}\\/[^\\s)]*`, "gi");
}

function decodeVariant(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, " ")).trim(); } catch { return value.trim(); }
}

type Token = { kind: "size"; start: number; end: number; label: string; prefixed: boolean }
  | { kind: "unit"; start: number; end: number; value: number; numText: string; numStart: number; type: "body" | "link" | "plain" | "noise" };

/**
 * 05/10/2026 (phiếu Desk 01/09 + 22/09): a pair the bot writes must be one row of the brand's chart.
 * Runs after `SizeChartRule`, which already settled the variant of a conversion sentence.
 */
export class SizePairRule implements ReplyRule {
  readonly id = "sizePair";
  apply(reply: string, g: GateContext): RuleResult | null {
    const rows = g.src.variantRows ?? [];
    if (rows.length === 0) return null;
    const p = g.cfg.sizePair;
    let text = reply.normalize("NFC");
    const norm = stripDiacritics(text);
    if (g.src.variantWomenDiffer === true) {
      const names = g.src.found.map((it) => it.ten).join(" ");
      let hay = gateNormalize(`${text} ${names}`);
      const unisex = g.re(p.unisex, "g");
      if (unisex !== null) hay = hay.replace(unisex, " ");
      if (g.test(p.women, hay)) return null;
    }
    const custRaw = String(g.src.customerSaid ?? "").normalize("NFC");
    const custNorm = gateNormalize(custRaw);
    const custLabels = labelsIn(custRaw, g.re(g.cfg.sizeChart.customerVariant, "giu")).map((l) => l.label);
    const custSaidLabel = (label: string): boolean => custLabels.some((c) => sameVariantLabel(c, label));
    const rowOf = (label: string): VariantRow | undefined => rows.find((r) => sameVariantLabel(r.label, label));
    const rowByLink = (v: number): VariantRow | undefined => rows.find((r) => r.link !== null && Math.abs(r.link - v) < 0.26);
    const trace: string[] = [];
    const edits: { start: number; end: number; text: string }[] = [];

    // ---- A. variant ↔ centimetre value
    const sizeRe = g.re(p.size, "giu");
    const unitRe = g.re(p.unit, "giu");
    if (sizeRe !== null && unitRe !== null && unitRe.test(text)) {
      const tokens: Token[] = [];
      const prefixRe = g.re(p.prefix);
      for (const l of labelsIn(text, sizeRe)) tokens.push({ kind: "size", start: l.start, end: l.end, label: l.label, prefixed: prefixRe !== null && prefixRe.test(gateNormalize(norm.slice(Math.max(0, l.start - 10), l.start))) });
      const bodyLead = g.re(p.bodyLead, "iu");
      const linkLead = g.re(p.linkLead, "iu");
      const noiseLead = g.re(p.noiseLead, "iu");
      for (const m of text.matchAll(new RegExp(unitRe.source, "giu"))) {
        if (!m[1]) continue;
        const at = m.index ?? 0;
        const lead = text.slice(Math.max(0, at - 18), at);
        const type = noiseLead?.test(lead) ? "noise" : bodyLead?.test(lead) ? "body" : linkLead?.test(lead) ? "link" : "plain";
        tokens.push({ kind: "unit", start: at, end: at + m[0].length, value: Number(m[1].replace(",", ".")), numText: m[1], numStart: at + m[0].indexOf(m[1]), type });
      }
      tokens.sort((a, b) => a.start - b.start);
      const stop = g.re(p.gapStop);
      const gapOk = (a: Token, b: Token): boolean => {
        const gap = text.slice(a.end, b.start);
        return gap.length <= 24 && !/[0-9.!?\n)]/.test(gap) && !(stop !== null && stop.test(gateNormalize(gap)));
      };
      const used = new Map<number, "body" | "other">();
      // A sentence that converts from the measurement settled its variant (SizeChartRule): the tag follows it.
      const pieceStarts: number[] = [];
      { let at = 0; for (const piece of splitPieces(text)) { pieceStarts.push(at); at += piece.length; } }
      const pieceOf = (pos: number): string => { let i = pieceStarts.length - 1; while (i > 0 && pieceStarts[i]! > pos) i -= 1; const start = pieceStarts[i]!; const end = pieceStarts[i + 1] ?? text.length; return text.slice(start, end); };
      for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i]!;
        if (t.kind !== "unit" || t.type === "noise") continue;
        const free = (j: number): boolean => { const u = used.get(j); return u === undefined || (u === "body" && t.type === "link"); };
        const prev = i > 0 && tokens[i - 1]!.kind === "size" && free(i - 1) && gapOk(tokens[i - 1]!, t) ? i - 1 : -1;
        const next = i + 1 < tokens.length && tokens[i + 1]!.kind === "size" && free(i + 1) && gapOk(t, tokens[i + 1]!) ? i + 1 : -1;
        let pick = prev >= 0 && next >= 0 ? (t.start - tokens[prev]!.end <= tokens[next]!.start - t.end ? prev : next) : prev >= 0 ? prev : next;
        if (prev >= 0 && next >= 0 && used.has(prev) !== used.has(next)) pick = used.has(prev) ? next : prev;
        if (pick < 0) continue;
        const size = tokens[pick] as Extract<Token, { kind: "size" }>;
        const rooted = used.get(pick) === "body" || isConversionPiece(pieceOf(size.start), g);
        used.set(pick, t.type === "body" ? "body" : "other");
        if (t.type === "body") continue; // body ↔ variant: SizeChartRule's
        const row = rowOf(size.label);
        if (row === undefined) continue;
        const okLink = row.link !== null && Math.abs(row.link - t.value) < 0.26;
        const okBody = t.type !== "link" && row.body !== null && Math.abs(row.body - t.value) < 0.26;
        if (okLink || okBody) continue;
        const sizeIsRoot = rooted || custSaidLabel(size.label);
        const unitIsRoot = !sizeIsRoot && (customerSaidNumber(custNorm, t.value, p.customerNotNumber) || t.type === "link");
        const target = unitIsRoot ? rowByLink(t.value) : undefined;
        if (unitIsRoot && target !== undefined && !sameVariantLabel(target.label, size.label)) {
          edits.push({ start: size.start, end: size.start + labelSpan(text, size), text: target.label });
          trace.push(`cm_size_pair_fix:${t.numText}cm:${size.label}->${target.label}`);
        } else if (!unitIsRoot && row.link !== null) {
          edits.push({ start: t.numStart, end: t.numStart + t.numText.length, text: formatMeasure(row.link) });
          trace.push(`size_cm_pair_fix:${size.label}:${t.numText}->${formatMeasure(row.link)}`);
        }
      }
      text = applyEdits(text, edits);
      edits.length = 0;
    }

    // ---- B. variant ↔ another system's label (UK)
    const brand = String(g.src.variantBrand ?? "").trim().toLowerCase();
    const replyNorm = gateNormalize(text);
    const otherBrand = (g.src.brandWords ?? []).some((b) => { const k = b.trim().toLowerCase(); return k !== "" && k !== brand && new RegExp(`(^|[^a-z0-9])${gateNormalize(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(replyNorm); });
    if (sizeRe !== null && !otherBrand) {
      for (const [altId, pattern] of Object.entries(p.alt)) {
        const altRe = g.re(pattern, "giu");
        if (altRe === null || !rows.some((r) => r.alt[altId] !== undefined)) continue;
        const flat = stripDiacritics(text);
        // A label inside a range ("40–44 (UK 6.5–9.5)") pairs with nothing; the joining words are the industry's.
        const join = p.rangeJoin === "" ? null : { after: g.re(`^(?:${p.rangeJoin})(?:[a-z]{2}\\s*)?\\d`), before: g.re(`\\d(?:${p.rangeJoin})(?:[a-z]{2}\\s*)?$`) };
        const inRange = (start: number, end: number): boolean => join !== null && ((join.after?.test(stripDiacritics(text.slice(end, end + 12))) ?? false) || (join.before?.test(stripDiacritics(text.slice(Math.max(0, start - 12), start))) ?? false));
        const prefixRe = g.re(p.prefix);
        const sizes = labelsIn(text, sizeRe).filter((l) => !inRange(l.start, l.end)).map((l) => ({ ...l, prefixed: prefixRe !== null && prefixRe.test(gateNormalize(flat.slice(Math.max(0, l.start - 10), l.start))) }));
        const alts = [...text.matchAll(new RegExp(altRe.source, "giu"))].filter((m) => m[1] && !inRange(m.index ?? 0, (m.index ?? 0) + m[0].length)).map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, num: Number(m[1]!.replace(",", ".")), numText: m[1]!, numStart: (m.index ?? 0) + m[0].lastIndexOf(m[1]!) }));
        if (alts.length === 0) continue;
        const stop = g.re(p.gapStop);
        const fwd = g.re(p.altForward);
        // A measurement between the pair ("size 42 (tem 27cm / UK 8)") does not break it.
        const withoutUnits = (gap: string): string => (unitRe === null ? gap : gap.replace(new RegExp(unitRe.source, "giu"), ""));
        const backGapOk = (gap: string): boolean => { const bare = withoutUnits(gap); return gap.length <= 40 && !/[0-9.!?\n)]/.test(bare) && !(stop !== null && stop.test(gateNormalize(bare))); };
        const custAlt = (n: number): boolean => new RegExp(`(^|[^a-z0-9])${altId}\\s*${String(n).replace(".", "\\.")}(?![\\d.])`).test(custNorm.replace(/(\d),(\d)/g, "$1.$2"));
        const usedSizes = new Set<number>();
        for (const alt of alts) {
          let pick = -1;
          for (let j = sizes.length - 1; j >= 0; j -= 1) { if (sizes[j]!.end <= alt.start) { if (!usedSizes.has(j) && sizes[j]!.prefixed && backGapOk(text.slice(sizes[j]!.end, alt.start))) pick = j; break; } }
          if (pick < 0) { const j = sizes.findIndex((s) => s.start >= alt.end); if (j >= 0 && !usedSizes.has(j) && fwd !== null && fwd.test(gateNormalize(text.slice(alt.end, sizes[j]!.start)))) pick = j; }
          if (pick < 0) continue;
          usedSizes.add(pick);
          const size = sizes[pick]!;
          const between = text.slice(Math.min(size.end, alt.end), Math.max(size.start, alt.start));
          const cmBetween = withoutUnits(between) !== between;
          const byLabel = rowOf(size.label);
          const byAlt = rows.find((r) => r.alt[altId] !== undefined && Math.abs(Number(r.alt[altId]) - alt.num) < 0.01);
          if (byLabel === undefined && byAlt === undefined) continue;
          if (byLabel !== undefined && byLabel.alt[altId] !== undefined && Math.abs(Number(byLabel.alt[altId]) - alt.num) < 0.01) continue;
          const altRoot = byAlt !== undefined && (custAlt(alt.num) || (custSaidLabel(byAlt.label) && !custSaidLabel(size.label)));
          if (altRoot || byLabel === undefined || byLabel.alt[altId] === undefined) {
            if (byAlt === undefined || cmBetween) continue;
            edits.push({ start: size.start, end: size.start + labelSpan(text, size), text: byAlt.label });
            trace.push(`size_${altId}_pair_fix:${altId.toUpperCase()}${alt.num}:${size.label}->${byAlt.label}`);
          } else {
            edits.push({ start: alt.numStart, end: alt.numStart + alt.numText.length, text: String(byLabel.alt[altId]) });
            trace.push(`${altId}_size_pair_fix:${size.label}:${altId.toUpperCase()}${alt.num}->${altId.toUpperCase()}${byLabel.alt[altId]}`);
          }
        }
        text = applyEdits(text, edits);
        edits.length = 0;
      }
    }
    if (trace.length === 0) return null;
    return { reply: text, trace };
  }
}

/** The length of a label token as written ("44 2/3", "40.5"), from its start. */
function labelSpan(text: string, token: { start: number; label: string }): number {
  const m = /^\d{2}(?:\s*[12]\s*\/\s*3|[.,]5)?/.exec(text.slice(token.start));
  return m ? m[0].length : token.label.length;
}

function applyEdits(text: string, edits: { start: number; end: number; text: string }[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
