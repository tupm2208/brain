/**
 * @file DIỄN LẠI — running a kept turn again, from the dossier alone.
 *
 * No landing, no gateway, no network, no MySQL. The dossier holds the turn as plain data
 * (`AgentTurnInput`), the RAW values the landing returned (`congCu`) and every answer the model
 * gave (`traLoiModel`), so all three of the agent's live dependencies can be handed back to it.
 * This is only possible because `SalesAgent` receives ports: the model is one, the tool box is
 * three methods, and the turn itself is data.
 *
 * Two ways to use it, and they answer different questions:
 *
 *   - SCRIPTED (default): the model answers exactly what it answered then. The turn must come out
 *     identical. A difference here means the DOSSIER IS WRONG — something the turn depended on is
 *     not being kept — or that the code around the model changed. Run this first; a replay you
 *     cannot trust proves nothing.
 *   - REAL MODEL (`model` given): the recorded tool results, the live model. This is the one that
 *     answers "did my prompt fix actually work on the case the shop complained about".
 */

import { loadPack, type PackAgent } from "@sp/brain";
import { SalesAgent, type AgentOutcome, type AgentTrace } from "../agent/sales-agent";
import type { ChatMessage, ChatModelPort } from "../agent/chat-model";
import { silentLogger, type Logger } from "../support/logger";
import type { Clock } from "../support/clock";
import { replayToolBox, type TurnDossier } from "./turn-dossier";

/** A model that answers from a list, the way the recorded one did. */
export function scriptedChatModel(answers: readonly string[], model = "dien-lai"): ChatModelPort & { seen: ChatMessage[][] } {
  const left = [...answers];
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => true,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = left.shift();
      // Running out means the replayed turn asked MORE of the model than the original did — which
      // is a real finding, not a crash: say so instead of pretending the gateway failed.
      if (next === undefined) return { ok: false, viSao: "het_cau_da_ghi", transient: false };
      return { ok: true, text: next, model };
    }
  };
}

export interface ReplayOptions {
  /** The model to use. Absent = a scripted one replaying `traLoiModel` exactly. */
  model?: ChatModelPort | undefined;
  /** Try another pack's agent profile (prompt, tools, rules) on this same case. */
  agent?: PackAgent | undefined;
  /** Try other knowledge (Đ7 `extraContext`). Absent = what the turn actually had. */
  extraContext?: string | undefined;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
}

/** One side of the comparison, small enough to print. */
export interface ReplaySide {
  traLoi?: string | undefined;
  viSao?: string | undefined;
  soBuoc: number;
  /** `tool` or `error` per step — the shape of the turn. */
  buoc: string[];
}

export interface ReplayResult {
  goc: ReplaySide;
  dienLai: ReplaySide;
  /** True when the reply AND the step shape both came out the same. */
  giongNhau: boolean;
  /** What differed, in words, for the person reading the terminal. */
  khac: string[];
  /** The full outcome, for a caller that wants the whole trace. */
  ketQua: AgentOutcome;
}

function sideOf(traLoi: string | undefined, viSao: string | undefined, soBuoc: number, trace: readonly AgentTrace[]): ReplaySide {
  return { traLoi, viSao, soBuoc, buoc: trace.map((t) => t.tool ?? t.error ?? "?") };
}

/** The path of a dossier in words, for messages and headlines (an old dossier only knows two of them). */
export function pathWord(path: string): string {
  return path === "agent" ? "agent" : path === "kich-ban" ? "kịch bản" : path === "nhap" ? "soạn nháp (LLM#3)" : "máy luật";
}

/** The pack's agent profile by id, for `--pack`. Throws with the pack's own message when unknown. */
export function agentProfileOf(packId: string): PackAgent {
  const profile = loadPack(packId).agent;
  if (profile === undefined) throw new Error(`Gói ngành "${packId}" không có phần agent — không diễn lại được bằng gói này.`);
  return profile;
}

/**
 * Runs the kept turn again and compares. Never touches the network: whatever `model` is given,
 * the tools come from the dossier.
 */
export async function replayTurn(dossier: TurnDossier, options: ReplayOptions = {}): Promise<ReplayResult> {
  const kept = dossier.agent;
  if (kept === undefined) {
    throw new Error(`Lượt ${dossier.shop}/${dossier.maHoiThoai}#${dossier.stt} do ${pathWord(dossier.duongDi)} trả lời, không có phần agent để diễn lại.`);
  }

  const clock = options.clock ?? { now: () => new Date(dossier.luc) };
  const agent = new SalesAgent({
    model: options.model ?? scriptedChatModel(kept.traLoiModel, kept.model || "dien-lai"),
    logger: options.logger ?? silentLogger,
    clock,
    // A replay must not sit through the real back-off pauses.
    sleep: async () => undefined
  });

  const turn = {
    ...kept.luot,
    ...(options.agent !== undefined ? { agent: options.agent } : {}),
    ...(options.extraContext !== undefined ? { extraContext: options.extraContext } : {}),
    tools: replayToolBox(kept.congCu)
  };
  const outcome = await agent.run(turn);

  const goc = sideOf(kept.traLoi, kept.viSao, kept.soBuoc, kept.buoc);
  const dienLai = outcome.ok
    ? sideOf(outcome.reply, undefined, outcome.steps, outcome.trace)
    : sideOf(undefined, outcome.viSao, outcome.steps, outcome.trace);

  const khac: string[] = [];
  if (goc.traLoi !== dienLai.traLoi) khac.push("câu trả lời khác");
  if (goc.viSao !== dienLai.viSao) khac.push(`lý do khác (${goc.viSao ?? "—"} → ${dienLai.viSao ?? "—"})`);
  if (goc.buoc.join(" › ") !== dienLai.buoc.join(" › ")) khac.push("chuỗi bước khác");

  return { goc, dienLai, giongNhau: khac.length === 0, khac, ketQua: outcome };
}
