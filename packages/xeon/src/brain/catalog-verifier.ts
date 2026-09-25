/**
 * @file LLM#2 — CATALOG VERIFICATION (Desk `ai_router.js` 1574–1626 + `ai_fallback.js`
 * `verifyCatalogMatch`, moved to Xeon 25/09/2026).
 *
 * The scorer sometimes ends with ONE candidate and no strong reason ("boston" against three Boston
 * colourways): a guess. Before the agent quotes it, one cheap call asks the model which candidate
 * — if any — the customer means, with the last six lines in view. The model may answer "none":
 * the focus then stays (Do Quan, 24/08: the AI dropped JQ0764 while the customer was still asking
 * about it), or the uncertain gate asks back.
 *
 * The prompt is data (`loi-chung/xac-nhan-catalog.json` ⊕ `nganh/<id>/xac-nhan-catalog.json`);
 * this class arranges the candidates and the lines, calls at temperature 0 as JSON, and reads the
 * answer against the candidate list — a code the model invents is "none".
 */

import type { OneShotPromptText } from "@sp/brain";
import type { ChatMessage, ChatModelPort } from "../agent/chat-model";
import { parseAgentJson, type HistoryLine } from "../agent/sales-agent";
import { withUsage } from "../ai/usage-context";
import type { Logger } from "../support/logger";
import type { UsageTag } from "./context-analyzer";

export const VERIFY_TIMEOUT_MS = 8000;
export const VERIFY_CANDIDATES = 8;
export const VERIFY_HISTORY_LINES = 6;

export interface VerifyCandidate {
  code: string;
  name: string;
  brand?: string | undefined;
}

export interface VerifyInput {
  candidates: readonly VerifyCandidate[];
  history: readonly HistoryLine[];
  message: string;
  text: OneShotPromptText;
  usage: UsageTag;
}

/** `code` is one of the candidates, or "" when the model chose none. `null` = the model was off or failed. */
export interface VerifyOutcome {
  code: string;
  reason: string;
}

export class CatalogVerifier {
  constructor(private readonly options: { model: ChatModelPort; logger: Logger }) {}

  ready(): boolean {
    return this.options.model.ready();
  }

  static composePrompt(input: VerifyInput): ChatMessage[] {
    const t = input.text;
    const label = (key: string, fallback: string): string => t.nhan[key] ?? fallback;
    const candidates = input.candidates.slice(0, VERIFY_CANDIDATES).map((c) => `- ${c.code} — ${c.name}${c.brand ? ` — ${c.brand}` : ""}`);
    const lines = input.history.slice(-VERIFY_HISTORY_LINES).map((h) => `${h.who === "khach" ? "KHACH" : h.who === "nguoi" ? "PAGE (nguoi truc)" : "PAGE (bot)"}: ${h.text}`);
    const user = [
      ...t.huongDan,
      "",
      label("ungVien", "UNG VIEN TRONG KHO (ma — ten — hang):"),
      ...candidates,
      "",
      label("hoiThoai", "6 TIN GAN NHAT (cu → moi):"),
      ...lines,
      "",
      `${label("tinMoi", "TIN CAN DOI CHIEU:")} ${JSON.stringify(input.message)}`
    ].join("\n");
    return [
      { role: "system", content: t.heThong || "Ban doi chieu loi khach voi danh sach ung vien trong kho. Chi tra JSON." },
      { role: "user", content: user }
    ];
  }

  async verify(input: VerifyInput, budgetMs: number = VERIFY_TIMEOUT_MS): Promise<VerifyOutcome | null> {
    if (!this.options.model.ready() || input.candidates.length === 0) return null;
    const timeoutMs = Math.max(1000, Math.min(VERIFY_TIMEOUT_MS, Math.floor(budgetMs)));
    const answer = await withUsage(
      { shop: input.usage.shop, agent: "verify_match", channel: input.usage.channel, conversationId: input.usage.conversationId },
      () => this.options.model.complete(CatalogVerifier.composePrompt(input), { temperature: 0, json: true, timeoutMs })
    );
    if (!answer.ok) {
      this.options.logger.warn(`[xac-nhan-catalog] mo hinh loi: ${answer.viSao}`);
      return null;
    }
    const parsed = parseAgentJson(answer.text);
    if (parsed === null) {
      this.options.logger.warn(`[xac-nhan-catalog] JSON khong doc duoc: ${answer.text.slice(0, 160)}`);
      return null;
    }
    const picked = String(parsed["ma"] ?? "").trim().toUpperCase();
    const known = input.candidates.find((c) => c.code.toUpperCase() === picked);
    return { code: known?.code ?? "", reason: String(parsed["lyDo"] ?? "").slice(0, 200) };
  }
}
