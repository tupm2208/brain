/**
 * @file 05/10/2026 (phiếu Desk nhóm NHU CẦU / TƯ VẤN): a question the consultation profile says must
 * not be asked this turn — the customer named an item (no "what is it for", no profile question), the
 * piece is already known, or the page already asked it this session (each piece is asked once).
 *
 * The patterns are the industry's own "this asks for X" regexes (`thuc-the.json` → `hoSoTuVan`), chosen
 * by tier 1's verdict (`ConsultProfiler`) and passed in `consultNoAsk`. Only the asking CLAUSE goes; the
 * rest of the draft (stock, price, the item's description) stays. A draft that was nothing but the
 * question is emptied: the pipeline then answers with the next net, never with the question again.
 */

import { splitPieces } from "./size-rules";
import { gateNormalize, tidy, type GateContext, type ReplyRule, type RuleResult } from "./support";

export class ConsultAskRule implements ReplyRule {
  readonly id = "consultAsk";

  apply(reply: string, g: GateContext): RuleResult | null {
    const asks = (g.src.consultNoAsk ?? []).map((p) => g.re(p)).filter((re): re is RegExp => re !== null);
    if (asks.length === 0) return null;
    const asking = (t: string): boolean => { const n = gateNormalize(t); return asks.some((re) => re.test(n)); };
    let cut = 0;
    const out = splitPieces(reply.normalize("NFC")).map((piece) => {
      if (!asking(piece)) return piece;
      const lead = /^\s*/.exec(piece)![0];
      const tail = /\s*$/.exec(piece)![0];
      const body = piece.slice(lead.length, piece.length - tail.length);
      const clauses = body.split(/(?<=[,;])\s+/);
      const keep = clauses.filter((c) => !asking(c));
      cut += clauses.length - keep.length;
      if (keep.length === 0 || keep.length === clauses.length) { if (keep.length === clauses.length) cut += 1; return ""; }
      const joined = keep.join(" ").replace(/[,;]\s*$/, "").trim();
      return lead + joined + (/[.!?]$/.test(joined) ? "" : ".") + (tail === "" ? " " : tail);
    });
    if (cut === 0) return null;
    return { reply: tidy(out.join("").replace(/\n{3,}/g, "\n\n")).trim(), trace: [`consult_no_ask:${cut}`] };
  }
}
