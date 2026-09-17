/**
 * @file THE TOKEN LEDGER (Đ7) — one row per model call, and the sums the Token AI screen shows.
 *
 * Sales Desk's `ai_usage_kit.js` rebuilt for many shops: every row carries the SHOP, and a summary
 * only ever reads one shop's rows (a landing asks with its inbox token; the shop comes from the
 * token). Rows go to `ai-usage/<yyyy-mm>.ndjson` in the data directory — append-only lines under
 * 1 KB, the one exception to "write atomically" Desk made for the same reason.
 *
 * Two rules kept from Desk:
 *   - recording NEVER breaks a model call: every failure in here is swallowed;
 *   - the unit price is stored on the row, so a later price change does not rewrite the past.
 *
 * What the ledger does not keep: message text. A row names the conversation, never what was said.
 */

import fs from "node:fs";
import path from "node:path";
import type { TokenUsage } from "../agent/chat-model";
import { AGENTS, CHANNEL_LABELS, GROUP_LABELS, channelGroup, type AgentId, type UsageContext } from "./usage-context";
import { costVnd, localDay, type PriceTable } from "./price-table";

export interface UsageRow {
  at: string;
  shop: string;
  agent: AgentId;
  channel: string;
  conversationId: string;
  postId: string;
  model: string;
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  costVnd: number | null;
  /** The call's own failure reason, cut short. */
  error?: string | undefined;
}

export interface UsageEntry {
  context: UsageContext;
  model: string;
  ok: boolean;
  usage?: TokenUsage | undefined;
  error?: string | undefined;
  at: Date;
}

const DAY_MS = 24 * 3600 * 1000;
export const MAX_SUMMARY_DAYS = 90;

type Totals = { calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; costVnd: number; wasteCostVnd: number; failedCalls: number; unpricedCalls: number };

const zero = (): Totals => ({ calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costVnd: 0, wasteCostVnd: 0, failedCalls: 0, unpricedCalls: 0 });

function add(t: Totals, row: UsageRow): void {
  t.calls += 1;
  t.inputTokens += row.inputTokens;
  t.outputTokens += row.outputTokens;
  t.reasoningTokens += row.reasoningTokens;
  const cost = row.costVnd ?? 0;
  t.costVnd += cost;
  if (row.costVnd === null) t.unpricedCalls += 1;
  if (!row.ok) { t.failedCalls += 1; t.wasteCostVnd += cost; }
}

const round = (t: Totals): Totals => ({ ...t, costVnd: Math.round(t.costVnd), wasteCostVnd: Math.round(t.wasteCostVnd) });

/** Removes anything that looks like a key from a provider's error before it is written down. */
function scrub(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/key=[^&\s"']+/gi, "key=***").replace(/Bearer\s+[\w.~+/-]+=*/gi, "Bearer ***").replace(/\bsk-[\w-]{10,}/g, "***").slice(0, 160);
}

export class UsageLedger {
  /** Rows kept in memory when there is no directory (tests), and the last month read from disk. */
  private readonly memory: UsageRow[] = [];

  /** @param directory the data directory; `null` = memory only. */
  constructor(private readonly directory: string | null, private readonly prices: PriceTable) {}

  /** Records one call. Never throws. */
  record(entry: UsageEntry): UsageRow | null {
    try {
      const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
      const row: UsageRow = {
        at: entry.at.toISOString(),
        shop: String(entry.context.shop || ""),
        agent: entry.context.agent in AGENTS ? entry.context.agent : "khac",
        channel: String(entry.context.channel ?? ""),
        conversationId: String(entry.context.conversationId ?? "").slice(0, 191),
        postId: String(entry.context.postId ?? "").slice(0, 120),
        model: String(entry.model || ""),
        ok: entry.ok,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, cacheReadTokens: usage.cacheReadTokens,
        costVnd: costVnd(usage, this.prices.priceFor(entry.model, entry.at), this.prices.rate())
      };
      const error = scrub(entry.error);
      if (error) row.error = error;
      if (this.directory === null) {
        this.memory.push(row);
      } else {
        const dir = path.join(this.directory, "ai-usage");
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${localDay(entry.at).slice(0, 7)}.ndjson`), `${JSON.stringify(row)}\n`, "utf8");
      }
      return row;
    } catch {
      return null;
    }
  }

  /** Rows of one shop between two instants. */
  rows(shop: string, fromMs: number, toMs: number): UsageRow[] {
    const inRange = (row: UsageRow) => row.shop === shop && Date.parse(row.at) >= fromMs && Date.parse(row.at) <= toMs;
    if (this.directory === null) return this.memory.filter(inRange);
    const months = new Set<string>();
    for (let t = fromMs; t <= toMs + DAY_MS; t += DAY_MS) months.add(localDay(t).slice(0, 7));
    const out: UsageRow[] = [];
    for (const month of months) {
      let text = "";
      try { text = fs.readFileSync(path.join(this.directory, "ai-usage", `${month}.ndjson`), "utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const row = JSON.parse(line) as UsageRow;
          if (inRange(row)) out.push(row);
        } catch { /* a torn last line is skipped */ }
      }
    }
    return out;
  }

  /**
   * The Token AI screen's numbers for one shop (Desk `summarizeUsage`, the parts Xeon can know):
   * totals against the previous period, per day stacked by group, per group / agent / model, the
   * most expensive conversations and posts. Orders are the landing's to count and are not here.
   */
  summarize(input: { shop: string; days?: number; channel?: string; model?: string; now: Date }): Record<string, unknown> {
    const days = Math.min(Math.max(Math.trunc(Number(input.days)) || 7, 1), MAX_SUMMARY_DAYS);
    const nowMs = input.now.getTime();
    const today = localDay(nowMs);
    // The window starts at local midnight `days - 1` days ago.
    const fromMs = Date.parse(`${localDay(nowMs - (days - 1) * DAY_MS)}T00:00:00.000+07:00`);
    const previousFromMs = fromMs - days * DAY_MS;
    const wanted = (row: UsageRow) => (!input.channel || channelGroup(row.channel) === input.channel) && (!input.model || row.model === input.model);
    const all = this.rows(input.shop, previousFromMs, nowMs);
    const current = all.filter((r) => Date.parse(r.at) >= fromMs);
    const rows = current.filter(wanted);
    const previousRows = all.filter((r) => Date.parse(r.at) < fromMs).filter(wanted);

    const totals = zero();
    const previous = zero();
    for (const r of rows) add(totals, r);
    for (const r of previousRows) add(previous, r);

    const byDayMap = new Map<string, Record<string, { tokens: number; costVnd: number }>>();
    for (let t = fromMs; localDay(t) <= today; t += DAY_MS) byDayMap.set(localDay(t), {});
    const groups = new Map<string, Totals>();
    const agents = new Map<string, Totals>();
    const models = new Map<string, Totals>();
    const conversations = new Map<string, Totals & { channel: string; conversationId: string }>();
    const posts = new Map<string, Totals & { postId: string }>();
    for (const r of rows) {
      const group = AGENTS[r.agent]?.group ?? "khac";
      const day = byDayMap.get(localDay(r.at));
      if (day) {
        const cell = day[group] ?? (day[group] = { tokens: 0, costVnd: 0 });
        cell.tokens += r.inputTokens + r.outputTokens;
        cell.costVnd = Math.round((cell.costVnd + (r.costVnd ?? 0)) * 100) / 100;
      }
      add(groups.get(group) ?? groups.set(group, zero()).get(group)!, r);
      add(agents.get(r.agent) ?? agents.set(r.agent, zero()).get(r.agent)!, r);
      add(models.get(r.model) ?? models.set(r.model, zero()).get(r.model)!, r);
      if (r.conversationId && r.channel !== "demo") {
        const c = conversations.get(r.conversationId) ?? conversations.set(r.conversationId, { ...zero(), channel: channelGroup(r.channel), conversationId: r.conversationId }).get(r.conversationId)!;
        add(c, r);
      }
      if (r.postId) add(posts.get(r.postId) ?? posts.set(r.postId, { ...zero(), postId: r.postId }).get(r.postId)!, r);
    }
    const activeDays = new Set(rows.map((r) => localDay(r.at))).size;
    const channels = [...new Set(current.map((r) => channelGroup(r.channel)).filter(Boolean))];
    return {
      days, from: new Date(fromMs).toISOString(), to: input.now.toISOString(), activeDays,
      rateVndPerUsd: this.prices.rate(),
      firstLedgerDay: all.length > 0 ? localDay(all.map((r) => r.at).sort()[0]!) : "",
      totals: round(totals),
      previous: { totals: round(previous) },
      byDay: [...byDayMap.entries()].map(([day, g]) => ({ day, groups: g })),
      byGroup: [...groups.entries()].map(([group, t]) => ({ group, label: GROUP_LABELS[group] ?? group, ...round(t) })),
      byAgent: [...agents.entries()].map(([agent, t]) => ({ agent, label: AGENTS[agent as AgentId]?.label ?? agent, group: AGENTS[agent as AgentId]?.group ?? "khac", ...round(t) })),
      byModel: [...models.entries()].map(([model, t]) => ({ model, ...round(t) })).sort((a, b) => b.costVnd - a.costVnd),
      topConversations: [...conversations.values()].map((c) => ({ ...round(c), channelGroup: c.channel, conversationId: c.conversationId }))
        .sort((a, b) => b.costVnd - a.costVnd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)).slice(0, 10),
      content: { posts: [...posts.values()].map((p) => ({ ...round(p), postId: p.postId, title: p.postId })).sort((a, b) => b.costVnd - a.costVnd).slice(0, 10) },
      channelOptions: channels.map((channel) => ({ channel, label: CHANNEL_LABELS[channel] ?? channel })),
      modelOptions: [...new Set(current.map((r) => r.model).filter(Boolean))].sort()
    };
  }
}
