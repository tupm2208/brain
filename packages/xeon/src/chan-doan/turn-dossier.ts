/**
 * @file THE TURN DOSSIER — everything one answered message needed, kept so the turn can be
 * EXPLAINED and RE-RUN later (decided 21/09/2026, `KE-HOACH-NHAT-KY-CHAN-DOAN.md`).
 *
 * Why it is written while the turn runs and not rebuilt afterwards: nothing survives the turn.
 * Xeon keeps no merchant data between turns; the landing's stored `ConversationState` blanks the
 * customer's own words (`turn-engine.ts`: `text: ""`); and `conversation.recent` has moved on by
 * the time anyone looks. Miss the moment and the turn is gone for good.
 *
 * WHAT IT HOLDS. The rule from 21/09/2026 is that a LITTLE customer data may be kept so a bug can
 * be reproduced — this is an operational step, not a leak:
 *   - kept whole: what the customer wrote, the history, tool arguments AND FULL results, the
 *     resolved prompt, every model answer, every blocked reply and why;
 *   - kept on a deadline: phone, address, name, psid (`RETENTION_DAYS`);
 *   - never kept: passwords, OTPs, card numbers, inbox tokens, admin tokens, cookies — none of
 *     them help reproduce anything (`scrubSecrets`).
 *
 * A dossier must NEVER reach `/nhat-ky`, which is public and unauthenticated. It is a file on
 * Xeon's disk, read by the `chan-doan` tool.
 */

import type { Entities, IntentVerdict, StockFacts } from "@sp/brain";
import type { InboxSentExtras } from "@sp/contract";
import type { AgentTrace, AgentToolBox, AgentTurnInput } from "../agent/sales-agent";
import type { ContextAnalysis } from "../brain/context-analyzer";
import type { Clock } from "../support/clock";

/**
 * 2 since 25/09/2026: the turn pipeline (LLM#1 analysis → rule router → agent → LLM#3 draft → rule
 * engine) writes `phanTich`, `router`, `nhap` and `ghiChu`. A version-1 dossier has none of them,
 * and every reader here treats them as optional.
 */
export const DOSSIER_VERSION = 2;

/** How long a dossier is kept, by class. A turn that went wrong is the one worth keeping longer. */
export const RETENTION_DAYS = { thuong: 7, hong: 30 } as const;
export type RetentionClass = keyof typeof RETENTION_DAYS;

/**
 * Which path PRODUCED THE REPLY. The agent may have tried and failed on a turn marked `may-luat`
 * or `nhap`: that is told by `agent` being present with a `viSao`, not by this field.
 * See `KE-HOACH-NHAT-KY-CHAN-DOAN.md` §2.
 *   - `kich-ban`: the rule router's scripted sentence (greeting, thanks, payment acknowledgement...);
 *   - `agent`: the tier-2 agent;
 *   - `nhap`: LLM#3, the one-shot draft written when the agent could not;
 *   - `may-luat`: the deterministic turn engine, last in line.
 */
export type TurnPath = "kich-ban" | "agent" | "nhap" | "may-luat";

/** How the turn ended for the customer. */
export type TurnOutcomeKind =
  | "da-tra-loi"          // a message was sent
  | "chuyen-nguoi-that"   // handed to a human on duty
  | "im"                  // deliberately silent (a human was answering, message superseded)
  | "hong";               // nothing could be sent

/**
 * One call of the agent's tool box, with the RAW value the landing returned — not the string the
 * model was shown. A replay hands this value back so `numbersIn` / `allowedHosts` rebuild the same
 * way and `reviewReply` reaches the same verdict.
 */
export interface RecordedToolCall {
  ten: "findStock" | "policy" | "bankAccount";
  args?: Record<string, unknown> | undefined;
  ketQua?: unknown;
  loi?: string | undefined;
  ms: number;
}

/** The agent path: everything `SalesAgent.run` was given and everything it produced. */
export interface AgentDossier {
  model: string;
  goiNganh: string;
  /** The turn as data — feed it straight back to `SalesAgent.run` with a replay tool box. */
  luot: AgentTurnInput;
  /** The RESOLVED system message. A pack edited next week must not rewrite last week's turn. */
  systemPrompt: string;
  /** Every answer the model gave, in order: a scripted model replays the turn without the gateway. */
  traLoiModel: string[];
  congCu: RecordedToolCall[];
  buoc: AgentTrace[];
  soBuoc: number;
  traLoi?: string | undefined;
  viSao?: string | undefined;
}

/** The rule-engine path. The state is kept because the copy on the landing has the customer blanked. */
export interface RuleEngineDossier {
  trangThaiVao: unknown;
  trangThaiRa: unknown;
  hanhDong: string;
  maYDinh: string | null;
  maHang?: string | undefined;
  cong: unknown[];
  traLoi: string;
}

/** What the rule router decided, kept so a replay can say WHY the turn went where it went. */
export interface RouterDossier {
  /** `script_reply` | `ask_clarification` | `human_handoff` | `agent_draft`. */
  quyetDinh: string;
  lyDo: string;
  /** The intent after every correction, and the keyword intent of the message alone. */
  yDinh: IntentVerdict;
  yDinhCucBo: IntentVerdict;
  thucThe: Entities;
  /** The rule names that fired, in order. */
  duongOng: string[];
  /** The sentence the router chose (a script, an ask-back, a handoff line), or "" for `agent_draft`. */
  traLoi: string;
  /** The ask-back hint handed to the agent, "" when none. */
  goiY: string;
  /** Whether the handoff sentence was safe to send as is. */
  tuGui?: boolean | undefined;
}

/** LLM#3, when it ran: what it was asked for and what it wrote. */
export interface DraftDossier {
  model: string;
  yDinh: string;
  traLoi?: string | undefined;
  canNguoi?: boolean | undefined;
  lyDo?: string | undefined;
  /** Why the draft was not used: the model failed, wrote no reply, or `reviewReply` blocked it. */
  viSao?: string | undefined;
  /** The model's raw answer. */
  tho?: string | undefined;
}

/** One landing call the pipeline made BEFORE any model wrote (stock ladder, finder rungs, orders, customer). */
export interface LookupRecord {
  ten: string;
  vao: Record<string, unknown>;
  /** The result, cut for the file: item codes and names, an order's id and status — never whole catalog rows. */
  ra: unknown;
  loi?: string | undefined;
  ms: number;
}

/** What tier 1 PROVED this turn (Desk steps 5–7): the stock truth, the catalog verdict, the focus, the orders. */
export interface TruthDossier {
  ton: StockFacts | null;
  /** The catalog resolver's verdict: status, reason, whether the agent must confirm before quoting, the codes selected. */
  khop?: { trangThai: string; lyDo: string; canXacNhan: boolean; ma: string[] } | undefined;
  /** The uncertain-product gate's reason when it fired ("uncertain_product_ask_back:no_product"). */
  chuaChac?: string | undefined;
  /** The product in focus after the resolver, and where it came from. */
  mauChinh?: { ma: string; ten: string; nguon: string; boDi?: string | undefined } | undefined;
  /** The rung of the stock ladder that answered ("exact", "same_line_other_version"...), "" when none ran. */
  bacThang: string;
  donHang?: { maDon: string; trangThai: string; vanDon: boolean; doiSize?: boolean | undefined } | undefined;
  khach?: { daMua: number; sizeHayMua: string[] } | undefined;
}

/** The reply gate (stage 6): what the model wrote, what went out, and which rules fired. Numbers of 9+ digits are masked in `goc`. */
export interface GateDossier {
  goc: string;
  sua: string;
  dauVet: string[];
  canNguoi: boolean;
  lyDo: string;
}

/** What went WITH the reply (Giai đoạn 7): the plan, and what the landing says really went. */
export interface DispatchDossier {
  the: string[];
  linkLoc?: string | undefined;
  phieu?: { items: { ma: string; size: string }[]; url?: string | undefined; chan?: string | undefined } | undefined;
  anhHuongDan?: boolean | undefined;
  chaoAi?: boolean | undefined;
  goiNguoi?: boolean | undefined;
  lyDo: string[];
  daGui?: InboxSentExtras | undefined;
}

/** The customer's photos this turn: what kind, and what went wrong reading them. */
export interface PhotoDossier {
  loai: string;
  soAnh: number;
  thamChieu: boolean;
  loi: string[];
}

export interface TurnDossier {
  /** 1 = before the pipeline (agent + engine only); 2 = with analysis, router, draft and notes. */
  version: 1 | 2;
  /** Sequence within the conversation, 1-based. */
  stt: number;
  luc: string;
  shop: string;
  maHoiThoai: string;
  /** The customer's channel id (psid). Pseudonymous, but still theirs — it falls under the deadline. */
  nguoi: string;
  kenh: string;
  duongDi: TurnPath;
  ketCuc: TurnOutcomeKind;
  viSao?: string | undefined;
  msTong: number;
  /** What the shop is running, so "it was the old build" is answerable without guessing. */
  ban?: string | undefined;
  /** MÃ VẾT of the chain this turn belongs to — the bridge to the infrastructure log on both sides. */
  maVet?: string | undefined;
  tinKhach: { chu: string; soAnh: number; luc: string };
  /** LLM#1's reading of the conversation (with `ms`, how long the call took); `null` when the model was off or answered badly. Absent in version 1. */
  phanTich?: (ContextAnalysis & { ms?: number | undefined }) | null | undefined;
  /** How long LLM#1 took, also when it answered nothing (a timeout is the case worth seeing). */
  phanTichMs?: number | undefined;
  /** The rule router's decision. Absent in version 1 and on turns that never reached it (a comment, a human on duty). */
  router?: RouterDossier | undefined;
  /** The landing calls made before any model wrote (stage 3 / 4, 25/09/2026). */
  traCuu?: LookupRecord[] | undefined;
  /** What those calls proved. */
  suThat?: TruthDossier | undefined;
  agent?: AgentDossier | undefined;
  /** LLM#3, when it ran. */
  nhap?: DraftDossier | undefined;
  mayLuat?: RuleEngineDossier | undefined;
  /** The notes the agent / draft were given (`extraContext`): memory, frame, focus, photo, analysis. */
  ghiChu?: string | undefined;
  /** The reply gate's work on the model's draft (stage 6). */
  cong?: GateDossier | undefined;
  /** What went with the reply (Giai đoạn 7). */
  guiKem?: DispatchDossier | undefined;
  anh?: PhotoDossier | undefined;
  /** The gateway breaker was open: no model ran this turn. */
  cauDaoMo?: boolean | undefined;
}

/** How much of a message the index row carries — enough to recognise a case, not enough to be a copy. */
export const INDEX_EXCERPT_CHARS = 200;

/** A short row per turn so `tim` / `gan-day` never have to open every dossier. */
export interface DossierIndexRow {
  stt: number;
  luc: string;
  maHoiThoai: string;
  nguoi: string;
  duongDi: TurnPath;
  ketCuc: TurnOutcomeKind;
  viSao?: string | undefined;
  /** Enough of the customer's message to recognise the case by eye. */
  tin: string;
  /** And enough of the answer: a shop complaining usually quotes what the bot SAID. */
  traLoi?: string | undefined;
  tep: string;
}

export interface DossierStore {
  write(dossier: TurnDossier): Promise<void>;
}

/** Writes nowhere. The default: a shop that has not turned the dossier on pays nothing for it. */
export const nullDossierStore: DossierStore = { write: async () => undefined };

/** Keeps dossiers in memory so a test can assert on them. */
export class MemoryDossierStore implements DossierStore {
  readonly written: TurnDossier[] = [];
  async write(dossier: TurnDossier): Promise<void> { this.written.push(dossier); }
  last(): TurnDossier | undefined { return this.written.at(-1); }
  clear(): void { this.written.length = 0; }
}

// ----------------------------------------------------------------------------------------------
// Secrets
// ----------------------------------------------------------------------------------------------

/**
 * Field names whose value is never kept. Deliberately NOT here: `ma` (a product code is `ma`),
 * `ten`, `sdt` — the phone IS kept on a deadline, that is the whole point of the 21/09 decision.
 */
const SECRET_FIELDS = /^(token|maNhanTin|ma_nhan_tin|matKhau|mat_khau|password|pass|otp|secret|biMat|bi_mat|apiKey|api_key|khoaBiMat|khoa_bi_mat|cookie|authorization|cvv|soThe|so_the)$/i;

/** A licence key, and anything handed over as a bearer token, wherever it turns up in free text. */
const SECRET_TEXT: readonly [RegExp, string][] = [
  [/TR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/g, "TR-****-****-****-****"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***"]
];

export const SECRET_MASK = "***";

function scrubText(text: string): string {
  let out = text;
  for (const [pattern, mask] of SECRET_TEXT) out = out.replace(pattern, mask);
  return out;
}

/**
 * Removes what must never be stored, anywhere in a value, and leaves everything else untouched —
 * the customer's own words included. Cycles are cut rather than followed.
 */
export function scrubSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return undefined as T;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, seen)) as T;
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
    out[name] = SECRET_FIELDS.test(name) ? SECRET_MASK : scrubSecrets(v, seen);
  }
  return out as T;
}

// ----------------------------------------------------------------------------------------------
// Recording the tool box
// ----------------------------------------------------------------------------------------------

/**
 * Wraps the agent's tool box and writes every call into `into`. The agent is not told: it receives
 * an `AgentToolBox` like any other, which is why recording costs the engine nothing.
 */
export function recordingToolBox(inner: AgentToolBox, into: RecordedToolCall[], clock: Clock): AgentToolBox {
  const record = async <T>(ten: RecordedToolCall["ten"], args: Record<string, unknown> | undefined, run: () => Promise<T>): Promise<T> => {
    const started = clock.now().getTime();
    const entry: RecordedToolCall = { ten, ms: 0 };
    if (args !== undefined) entry.args = args;
    into.push(entry);
    try {
      const result = await run();
      entry.ketQua = result;
      return result;
    } catch (error) {
      // The agent turns a tool error into data for the model; the dossier must show it happened.
      entry.loi = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      entry.ms = clock.now().getTime() - started;
    }
  };
  return {
    findStock: (args) => record("findStock", args, () => inner.findStock(args)),
    policy: () => record("policy", undefined, () => inner.policy()),
    bankAccount: () => record("bankAccount", undefined, () => inner.bankAccount())
  };
}

/**
 * Plays recorded calls back in the order they were made, so a replay reaches the same answer
 * without a landing. A call the recording does not have returns the last value of that method —
 * a pack under test may call one more time than the original turn did.
 */
export function replayToolBox(calls: readonly RecordedToolCall[]): AgentToolBox {
  const queues = new Map<string, RecordedToolCall[]>();
  for (const call of calls) {
    const queue = queues.get(call.ten) ?? [];
    queue.push(call);
    queues.set(call.ten, queue);
  }
  const next = (ten: RecordedToolCall["ten"]): unknown => {
    const queue = queues.get(ten) ?? [];
    const call = queue.length > 1 ? queue.shift()! : queue[0];
    if (call === undefined) throw new Error(`Hồ sơ không có lần gọi "${ten}" nào để diễn lại.`);
    if (call.loi !== undefined) throw new Error(call.loi);
    return call.ketQua;
  };
  return {
    findStock: async () => next("findStock"),
    policy: async () => String(next("policy") ?? ""),
    bankAccount: async () => next("bankAccount")
  };
}

// ----------------------------------------------------------------------------------------------
// Classifying
// ----------------------------------------------------------------------------------------------

/**
 * Which retention class a dossier falls in. A turn that answered cleanly is ordinary; a handoff,
 * a failure, a blocked reply or a tool error is what someone will come looking for.
 */
export function retentionClass(dossier: TurnDossier): RetentionClass {
  if (dossier.ketCuc !== "da-tra-loi") return "hong";
  const steps = dossier.agent?.buoc ?? [];
  if (steps.some((s) => s.error !== undefined || s.blocked !== undefined)) return "hong";
  // The agent gave up and LLM#3 or the engine answered instead: worth keeping longer too.
  return dossier.agent?.viSao !== undefined || dossier.nhap?.viSao !== undefined ? "hong" : "thuong";
}

/** What the bot ended up saying, whichever part said it (each part only has a reply when it answered). */
export function replyOf(dossier: TurnDossier): string {
  if (dossier.duongDi === "kich-ban") return dossier.router?.traLoi ?? "";
  return dossier.agent?.traLoi ?? dossier.nhap?.traLoi ?? dossier.mayLuat?.traLoi ?? dossier.router?.traLoi ?? "";
}

/** The row `tim` and `gan-day` read, without opening the dossier itself. */
export function indexRow(dossier: TurnDossier, tep: string): DossierIndexRow {
  const row: DossierIndexRow = {
    stt: dossier.stt,
    luc: dossier.luc,
    maHoiThoai: dossier.maHoiThoai,
    nguoi: dossier.nguoi,
    duongDi: dossier.duongDi,
    ketCuc: dossier.ketCuc,
    tin: dossier.tinKhach.chu.slice(0, INDEX_EXCERPT_CHARS),
    tep
  };
  if (dossier.viSao !== undefined) row.viSao = dossier.viSao;
  const reply = replyOf(dossier);
  if (reply !== "") row.traLoi = reply.slice(0, INDEX_EXCERPT_CHARS);
  return row;
}
