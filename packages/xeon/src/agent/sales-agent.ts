/**
 * @file The SALES AGENT — Sales Desk's level-2 agent (`agent_level2.js`), moved to Xeon 16/09/2026.
 *
 * It answers like the person on duty: reads the conversation, calls the shop's tools (stock, size
 * chart, policy, bank account) one at a time, then writes ONE message. The rules are the pack's
 * (`IndustryPack.agent`), the data is the landing's; this class only runs the loop.
 *
 * Two guards Desk learned the hard way stay in code, not in the prompt:
 *   - `reviewReply`: a price not seen in a tool result, a link to someone else's site, or a banned
 *     phrase blocks the reply (a model told "never invent a price" still does, now and then);
 *   - a hard step limit and a deadline: a gateway that hangs must not leave the customer waiting.
 * A blocked or failed turn returns `ok: false`, and the caller falls back to the rule engine.
 */

import { redactPII, stripDiacritics, type IndustryPack, type PackAgent } from "@sp/brain";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import type { ChatMessage, ChatModelPort } from "./chat-model";

export const MAX_TOOL_STEPS = 6;
export const TURN_DEADLINE_MS = 60_000;
/** How many times a reply blocked by `reviewReply` may be rewritten before the turn fails. */
export const MAX_REVIEW_RETRIES = 2;
/**
 * Tries per model call. A transient gateway failure (empty answer, 5xx, 429, timeout, network) is
 * called again after a growing pause — the gateway usually recovers within seconds.
 */
export const MODEL_ATTEMPTS = 4;
export const MODEL_BACKOFF_MS = [1000, 2000, 4000];
/** How far around the customer's own budget an amount may go without a tool source. */
export const BUDGET_BAND = 0.25;
const REVIEW_HINTS = "Gia/so tien chi duoc lay tu ket qua tra_kho hoac chinh_sach GOI TRONG LUOT NAY (gia trong tin cu cua PAGE khong tinh) — goi tra_kho lai hoac bo con so do. Link chi lay tu ket qua tra_kho. Viet lai va tra {\"reply\":\"...\"}.";
/** Tool results are cut before they reach the model (Desk's limits). */
const STOCK_RESULT_CHARS = 8000;
const TEXT_RESULT_CHARS = 6000;

/** One line of the conversation as the agent reads it, oldest first; the last one is the message to answer. */
export interface HistoryLine {
  who: "khach" | "bot" | "nguoi";
  text: string;
  images: number;
}

/** What the agent may call. Each returns data for the model; errors come back as data too. */
export interface AgentToolBox {
  findStock(args: Record<string, unknown>): Promise<unknown>;
  policy(): Promise<string>;
  bankAccount(): Promise<unknown>;
}

export interface AgentTurn {
  agent: PackAgent;
  /** Merchant's public address, for `{site}` and for the link check. */
  site: string;
  history: HistoryLine[];
  tools: AgentToolBox;
  neverSay?: readonly string[] | undefined;
  /**
   * What the shop taught the AI (Đ7 `training.knowledge`, rendered by `renderKnowledge`): appended to
   * the system prompt. Approved items only; the review queue never reaches the model.
   */
  extraContext?: string | undefined;
}

export interface AgentTrace {
  step: number;
  tool?: string;
  error?: string;
  /** Đ7 "AI nghĩ gì": the arguments the model chose and a short look at what came back. */
  args?: Record<string, unknown>;
  result?: string;
}

export type AgentOutcome =
  | { ok: true; reply: string; steps: number; trace: AgentTrace[] }
  /** `modelDown`: the turn died because the model could not be reached, not because of what it wrote — worth running again. */
  | { ok: false; viSao: string; steps: number; trace: AgentTrace[]; modelDown?: boolean };

/** Pulls the first balanced JSON object out of a model answer (models wrap JSON in prose or fences). */
export function parseAgentJson(text: string): Record<string, unknown> | null {
  const cleaned = String(text ?? "").replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(cleaned.slice(start, i + 1)) as unknown;
          return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Money amounts written the ways Vietnamese sellers and customers write them, in VND. */
export function moneyAmounts(text: string): number[] {
  const plain = stripDiacritics(String(text ?? "")).toLowerCase();
  const out: number[] = [];
  // 1.290.000 / 1,290,000 / 1290000. Not a phone, an account number or a code: plain digits only
  // 5-8 long, no leading 0, not glued to letters ("JP9252", "TR12345") — except the currency: "đ"
  // becomes "d" once accents are stripped, so "3.290.000đ" must still count.
  for (const m of plain.matchAll(/(?<![\w.,])(\d{1,3}(?:[.,]\d{3})+|[1-9]\d{4,7})(?![.,]?\d)(?!(?!d\b|vnd\b|dong\b)[a-z])/g)) {
    out.push(Number(m[1]!.replace(/[.,]/g, "")));
  }
  // 1tr2 / 1 tr / 1,2 trieu / 1.5 trieu
  for (const m of plain.matchAll(/(\d+)(?:[.,](\d+))?\s*(?:tr|trieu)(\d)?(?![a-z])/g)) {
    const whole = Number(m[1]);
    const fraction = m[2] ?? m[3] ?? "";
    out.push(Math.round((whole + (fraction ? Number(`0.${fraction}`) : 0)) * 1_000_000));
  }
  // 890k / 890 nghin / 890 ngan
  for (const m of plain.matchAll(/(\d+)\s*(?:k|nghin|ngan)(?![a-z])/g)) out.push(Number(m[1]) * 1000);
  return out;
}

/** Every number in a JSON-ish value, for the "price has a source" check. */
function numbersIn(value: unknown, into: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) { into.add(value); return; }
  if (typeof value === "string") { for (const n of moneyAmounts(value)) into.add(n); return; }
  if (Array.isArray(value)) { for (const v of value) numbersIn(v, into); return; }
  if (value !== null && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, into);
}

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); } catch { return ""; }
}

export interface ReviewInput {
  reply: string;
  /** Numbers seen in tool results and the policy. */
  knownAmounts: ReadonlySet<number>;
  /**
   * Amounts the CUSTOMER wrote (their budget). Talking around a budget is not inventing a price:
   * "1tr2" from the customer licenses "tầm 1tr–1tr2" (16/09/2026), so a band of ±25% is allowed.
   */
  budgetAmounts?: readonly number[] | undefined;
  /** Hosts a link may point to. */
  allowedHosts: ReadonlySet<string>;
  neverSay?: readonly string[] | undefined;
}

/** `null` when the reply may go out, otherwise the reason it may not. */
export function reviewReply(input: ReviewInput): string | null {
  const reply = input.reply.trim();
  if (reply === "") return "tra_loi_rong";
  const plain = stripDiacritics(reply).toLowerCase();
  for (const phrase of input.neverSay ?? []) {
    if (phrase.trim() !== "" && plain.includes(stripDiacritics(phrase).toLowerCase())) return `cau_cam: ${phrase}`;
  }
  // A money amount below 10.000đ is not a price (sizes, days, percentages written with k...).
  for (const amount of moneyAmounts(reply)) {
    if (amount < 10_000 || input.knownAmounts.has(amount)) continue;
    if ((input.budgetAmounts ?? []).some((budget) => Math.abs(amount - budget) <= budget * BUDGET_BAND)) continue;
    return `gia_khong_nguon: ${amount}`;
  }
  for (const m of reply.matchAll(/https?:\/\/[^\s)"'<>]+/g)) {
    const host = hostOf(m[0]);
    if (!input.allowedHosts.has(host)) return `link_la: ${host || m[0]}`;
  }
  return null;
}

function renderHistory(history: HistoryLine[]): string {
  return history.map((line) => {
    const who = line.who === "khach" ? "KHACH"
      : line.who === "bot" ? "PAGE (bot tu dong — co the sai, khong phai nguon su that)"
      : "PAGE (nguoi truc)";
    const images = line.images > 0 ? ` [khach gui ${line.images} anh]` : "";
    return `${who}: ${line.text}${images}`;
  }).join("\n");
}

export interface SalesAgentOptions {
  model: ChatModelPort;
  logger: Logger;
  clock: Clock;
  /** Test seam for the retry pauses. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export class SalesAgent {
  constructor(private readonly options: SalesAgentOptions) {}

  ready(): boolean {
    return this.options.model.ready();
  }

  /** Whether this pack's rules say a human, not the agent, must take the message. */
  static mustHuman(pack: IndustryPack, message: string): boolean {
    const pattern = pack.agent?.mustHumanPattern ?? "";
    return pattern !== "" && new RegExp(pattern).test(stripDiacritics(message).toLowerCase());
  }

  async run(turn: AgentTurn): Promise<AgentOutcome> {
    const started = this.options.clock.now().getTime();
    const trace: AgentTrace[] = [];
    const knownAmounts = new Set<number>();
    const allowedHosts = new Set<string>([hostOf(turn.site)].filter(Boolean));
    const budgetAmounts = turn.history.filter((line) => line.who === "khach").flatMap((line) => moneyAmounts(line.text));

    const site = turn.site.replace(/\/+$/, "");
    const convo: ChatMessage[] = [
      { role: "system", content: [turn.agent.systemPrompt.split("{site}").join(site), turn.extraContext ?? ""].filter((part) => part.trim() !== "").join("\n\n") },
      { role: "user", content: `LICH SU HOI THOAI (cu → moi, tin CUOI la tin can tra loi):\n${renderHistory(turn.history)}\nHay xu ly tin cuoi cua khach.` }
    ];

    // The gateway fails now and then for no reason of ours (an empty answer, a 5xx): one retry per
    // call before the turn gives up (16/09/2026: "mô hình trả về rỗng" left a customer unanswered).
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const elapsed = () => this.options.clock.now().getTime() - started;
    let modelDown = false;
    const ask = async (): Promise<string | null> => {
      for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
        const left = TURN_DEADLINE_MS - elapsed();
        if (left < 3000) { modelDown = true; return null; }
        const answer = await this.options.model.complete(convo, { timeoutMs: Math.min(25_000, left) });
        if (answer.ok) return answer.text;
        trace.push({ step: trace.length + 1, error: answer.viSao });
        this.options.logger.warn(`[agent] mo hinh loi lan ${attempt}/${MODEL_ATTEMPTS}: ${answer.viSao}`);
        if (!answer.transient) return null;
        modelDown = true;
        const pause = MODEL_BACKOFF_MS[attempt - 1];
        if (pause === undefined || elapsed() + pause > TURN_DEADLINE_MS - 3000) return null;
        await sleep(pause);
      }
      return null;
    };

    // A blocked reply is not the end of the turn (16/09/2026: "cho tôi đôi khác xem" was answered
    // with a price from memory, blocked, and the customer got the rule engine's bare greeting).
    // The model is told WHY and writes again, up to MAX_REVIEW_RETRIES times.
    let reviewRetries = 0;
    const finish = (reply: string, steps: number): AgentOutcome | "retry" => {
      const blocked = reviewReply({ reply, knownAmounts, budgetAmounts, allowedHosts, neverSay: turn.neverSay });
      if (!blocked) return { ok: true, reply: reply.trim(), steps, trace };
      trace.push({ step: steps, error: `chan: ${blocked}` });
      this.options.logger.warn(`[agent] cau bi chan (${blocked}): ${redactPII(reply).slice(0, 300)}`);
      if (reviewRetries >= MAX_REVIEW_RETRIES) return { ok: false, viSao: `chan: ${blocked}`, steps, trace };
      reviewRetries += 1;
      convo.push(
        { role: "assistant", content: JSON.stringify({ reply }) },
        { role: "user", content: `CAU TRA LOI BI CHAN, CHUA GUI KHACH — ly do: ${blocked}. ${REVIEW_HINTS}` }
      );
      return "retry";
    };

    for (let step = 1; step <= MAX_TOOL_STEPS; step += 1) {
      const raw = await ask();
      if (raw === null) return { ok: false, viSao: trace.at(-1)?.error ?? "het_gio", steps: step, trace, modelDown };
      const parsed = parseAgentJson(raw);
      if (!parsed) {
        trace.push({ step, error: "khong_doc_duoc_json" });
        convo.push({ role: "assistant", content: raw }, { role: "user", content: "Output phai la MOT JSON duy nhat theo dung dinh dang. Lam lai." });
        continue;
      }
      if (typeof parsed["reply"] === "string") {
        const done = finish(parsed["reply"], step);
        if (done !== "retry") return done;
        continue;
      }

      const tool = String(parsed["tool"] ?? "");
      const args = (parsed["args"] !== null && typeof parsed["args"] === "object" ? parsed["args"] : {}) as Record<string, unknown>;
      const entry: AgentTrace = { step, tool, args };
      trace.push(entry);
      convo.push({ role: "assistant", content: JSON.stringify(parsed) });
      const result = await this.runTool(tool, args, turn, knownAmounts, allowedHosts);
      entry.result = result.slice(0, 400);
      convo.push({ role: "user", content: result });
    }

    // Out of steps: make it answer with what it knows.
    convo.push({ role: "user", content: "Da du buoc. Bay gio BAT BUOC tra {\"reply\":\"...\"} dua tren nhung gi da biet, dieu chua chac thi noi se kiem tra sau." });
    const raw = await ask();
    const parsed = raw === null ? null : parseAgentJson(raw);
    if (!parsed || typeof parsed["reply"] !== "string") return { ok: false, viSao: raw === null ? (trace.at(-1)?.error ?? "het_gio") : "het_buoc_khong_tra_loi", steps: MAX_TOOL_STEPS + 1, trace, modelDown: raw === null && modelDown };
    const done = finish(parsed["reply"], MAX_TOOL_STEPS + 1);
    return done === "retry" ? { ok: false, viSao: "het_buoc_sau_khi_bi_chan", steps: MAX_TOOL_STEPS + 1, trace } : done;
  }

  private async runTool(tool: string, args: Record<string, unknown>, turn: AgentTurn, knownAmounts: Set<number>, allowedHosts: Set<string>): Promise<string> {
    try {
      if (tool === "tra_kho") {
        const result = await turn.tools.findStock(args);
        numbersIn(result, knownAmounts);
        // Links the finder returned are the shop's own pages.
        for (const m of JSON.stringify(result).matchAll(/https?:\/\/[^\s"\\]+/g)) { const host = hostOf(m[0]); if (host) allowedHosts.add(host); }
        return `KET QUA tra_kho:\n${JSON.stringify(result).slice(0, STOCK_RESULT_CHARS)}`;
      }
      if (tool === "bang_size") return `KET QUA bang_size:\n${turn.agent.sizeGuide.slice(0, TEXT_RESULT_CHARS)}`;
      if (tool === "chinh_sach") {
        const policy = await turn.tools.policy();
        numbersIn(policy, knownAmounts);
        return `KET QUA chinh_sach:\n${policy.slice(0, TEXT_RESULT_CHARS)}`;
      }
      if (tool === "tai_khoan_shop") return `KET QUA tai_khoan_shop:\n${JSON.stringify(await turn.tools.bankAccount())}`;
      if (tool === "xem_anh") return "KET QUA xem_anh: he thong CHUA xem duoc anh — xin khach ten mau hoac ma tren tem.";
      return "Cong cu khong ton tai. Chi dung: tra_kho, bang_size, chinh_sach, tai_khoan_shop, hoac {\"reply\":...}.";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn(`[agent] cong cu ${tool} loi: ${message}`);
      return `KET QUA ${tool}: LOI — ${message}. Khong duoc bia; noi se kiem tra roi bao lai.`;
    }
  }
}
