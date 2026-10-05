/**
 * @file The "already in your order" net (05/10/2026, phiếu Desk "khách đã có đơn bot bán lại").
 *
 * The item a customer ordered is, by construction, OUT OF STOCK in the shop's books: their own order
 * holds it. So any tier (agent, LLM#3, the engine's facts) that looks it up again reads "hết" and
 * offers something else — to a customer who already paid a deposit for it. This rule runs on every
 * reply, whoever wrote it, and does not depend on a model.
 *
 * It matches by CODE only, never by name (most ordered names are shared by other colourways): the
 * clause names the ordered code, or points at "this item" while the turn's focus IS the ordered code.
 * The size must be the ordered size (named, or the size asked when the clause names none). A clause
 * naming another code or another size is left alone, and so is everything once the customer said
 * they BUY MORE after the order was placed — then "out of stock" is the true answer.
 */

import { itemKey } from "../order-care";
import { gateNormalize, splitSentences, tidy, type GateContext, type GateOrder, type ReplyRule, type RuleResult } from "./support";

/** A size as a whole token: "41" does not match inside "41 1/3", "41 1/3" does not match "41". */
function sizeIn(text: string, size: string): boolean {
  const s = gateNormalize(size).replace(/\s+/g, " ").trim();
  if (s === "") return false;
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
  return new RegExp(`(^|[^0-9a-z/])${escaped}(?![0-9a-z]|\\s*[0-9]\\s*/|\\s*/)`, "i").test(text);
}

export class OrderedItemRule implements ReplyRule {
  readonly id = "orderedItem";

  apply(reply: string, g: GateContext): RuleResult | null {
    const cfg = g.cfg.orderedItem;
    const orders = g.src.runningOrders ?? [];
    if (orders.length === 0 || cfg.outOfStock.length === 0 || cfg.replacement === "") return null;
    const buysMore = g.re(cfg.buysMore);
    const lines = (g.src.customerLines ?? []);
    // An order the customer has since said "buy more" on: the shop may really be out — leave it alone.
    const watched = orders.filter((o) => {
      const since = Date.parse(o.taoLuc);
      return !(buysMore !== null && lines.some((l) => (!Number.isFinite(since) || Date.parse(l.at) >= since) && buysMore.test(gateNormalize(l.text))));
    });
    if (watched.length === 0) return null;
    const out = cfg.outOfStock.map((p) => g.re(p)).filter((r): r is RegExp => r !== null);
    const deictic = cfg.deictic.map((p) => g.re(p)).filter((r): r is RegExp => r !== null);
    const alternative = g.re(cfg.alternative);
    const mentionsVariant = g.re(cfg.mentionsVariant);
    const codeRe = g.re(g.cfg.evidence.codePattern, "g");
    const focus = itemKey(g.src.focusCode ?? g.src.stockFacts?.productCode ?? "");
    const asked = g.src.stockFacts?.requestedSize ?? "";

    const sentences = splitSentences(reply);
    let changed = false;
    const kept: string[] = [];
    let dropNextAlternative = false;
    for (const sentence of sentences) {
      const n = gateNormalize(sentence);
      if (dropNextAlternative && alternative !== null && alternative.test(n) && !out.some((re) => re.test(n))) { dropNextAlternative = false; changed = true; continue; }
      dropNextAlternative = false;
      const clauses = sentence.split(/(?<=[,;])\s+/);
      let hit: { order: GateOrder; line: GateOrder["mon"][number]; at: number } | null = null;
      for (let i = 0; i < clauses.length && hit === null; i += 1) {
        const clause = clauses[i]!;
        const c = gateNormalize(clause);
        if (!out.some((re) => re.test(c))) continue;
        const codes = codeRe === null ? [] : [...clause.matchAll(codeRe)].map((m) => itemKey(m[0]));
        for (const order of watched) {
          for (const line of order.mon) {
            const key = itemKey(line.ma);
            if (key === "") continue;
            const named = codes.includes(key);
            const pointed = !named && codes.length === 0 && focus === key && deictic.some((re) => re.test(c));
            if (!named && !pointed) continue;
            const sizeOk = sizeIn(c, line.size) || (!(mentionsVariant?.test(c) ?? false) && asked !== "" && gateNormalize(asked) === gateNormalize(line.size));
            if (!sizeOk) continue;
            hit = { order, line, at: i };
            break;
          }
          if (hit !== null) break;
        }
      }
      if (hit === null) { kept.push(sentence); continue; }
      changed = true;
      const stage = g.fill(g.cfg.orderedItem.stageLabels[hit.order.giaiDoan] ?? hit.order.giaiDoan);
      const fixed = g.fill(cfg.replacement, { ten: hit.line.ten, ma: hit.line.ma, size: hit.line.size, maDon: hit.order.maDon, giaiDoan: stage });
      // Clauses before the "out of stock" one stay; after it, an alternative offer goes.
      const before = clauses.slice(0, hit.at).join(" ").replace(/[,;]\s*$/, "").trim();
      const after = clauses.slice(hit.at + 1).filter((cl) => !(alternative?.test(gateNormalize(cl)) ?? false)).join(" ").trim();
      kept.push([before !== "" ? `${before}.` : "", fixed, after].filter((x) => x !== "").join(" "));
      dropNextAlternative = true;
    }
    if (!changed) return null;
    return { reply: tidy(kept.join(" ")), trace: ["ordered_item_out_of_stock_fixed"] };
  }
}
