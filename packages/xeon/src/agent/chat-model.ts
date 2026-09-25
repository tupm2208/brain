/**
 * @file The CHAT MODEL PORT — how the sales agent asks a language model for its next step.
 *
 * Separate from `TextModelPort` (post writing): the agent holds a multi-turn conversation of tool
 * calls and results, answers in seconds, and runs on a cheap fast model through an
 * OpenAI-compatible gateway — the same one Sales Desk's level-2 agent used
 * (`ai.elevenvoice.site/v1`, `ag/gemini-3.7-flash-low`). A port so every agent test runs with no
 * network, no key and no cost.
 */

import type { Logger } from "../support/logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /**
   * Pictures attached to a user message (Đ7: the customer's photo, an external product's photo):
   * https addresses or `data:image/...` URLs. The adapter turns them into image parts.
   */
  images?: string[] | undefined;
}

/** Tokens one model call used, as the provider reported them (Đ7 token ledger). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Reads an OpenAI-compatible `usage` block. The gateway (ai.elevenvoice.site) reports reasoning
 * tokens OUTSIDE `completion_tokens` (Desk measured 08/09: completion 111, reasoning 2885), OpenAI
 * inside; reasoning larger than completion, or a total that adds up that way, means outside.
 */
export function readOpenAiUsage(raw: unknown): TokenUsage | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const details = (u["completion_tokens_details"] ?? {}) as Record<string, unknown>;
  const promptDetails = (u["prompt_tokens_details"] ?? {}) as Record<string, unknown>;
  const prompt = num(u["prompt_tokens"] ?? u["input_tokens"]);
  const completion = num(u["completion_tokens"] ?? u["output_tokens"]);
  const reasoning = num(details["reasoning_tokens"] ?? u["reasoning_tokens"]);
  const total = num(u["total_tokens"]);
  const separate = reasoning > 0 && (reasoning > completion || (total > 0 && Math.abs(total - (prompt + completion + reasoning)) <= 2));
  return {
    inputTokens: prompt,
    outputTokens: separate ? completion + reasoning : completion,
    reasoningTokens: reasoning,
    cacheReadTokens: Math.min(num(promptDetails["cached_tokens"]), prompt)
  };
}

export type ChatOutcome =
  | { ok: true; text: string; model: string; usage?: TokenUsage | undefined }
  /** `transient`: worth calling again (empty answer, 5xx, 429, timeout, network). False: a wrong key or request — retrying cannot help. */
  | { ok: false; viSao: string; transient: boolean };

/**
 * Per-call knobs. Desk used two settings on the same gateway: the level-2 agent at temperature 0.4,
 * and the context analysis / catalog check at temperature 0 with `response_format: json_object`.
 */
export interface ChatCallOptions {
  timeoutMs?: number | undefined;
  /** Sampling temperature; the agent's 0.4 when absent. */
  temperature?: number | undefined;
  /** Ask the gateway for a JSON object (OpenAI `response_format`); gateways that ignore it still get a JSON prompt. */
  json?: boolean | undefined;
}

export interface ChatModelPort {
  /** Whether a model is configured. False = the agent is off and the rule engine answers alone. */
  ready(): boolean;
  complete(messages: ChatMessage[], options?: ChatCallOptions): Promise<ChatOutcome>;
}

/** The port when no model is configured. */
export const noChatModel: ChatModelPort = {
  ready: () => false,
  complete: async () => ({ ok: false, viSao: "Xeon chưa cấu hình mô hình cho agent (XEON_AI_CHAT_URL / XEON_AI_CHAT_KEY).", transient: false })
};

/** A message as the OpenAI-compatible wire wants it: plain text, or text + image parts. */
function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const images = (message.images ?? []).filter((url) => /^(https:\/\/|data:image\/)/i.test(url));
  if (images.length === 0) return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: [{ type: "text", text: message.content }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
  };
}

/** Default per-call limit: a gateway that hangs must not hold a customer's answer forever. */
export const DEFAULT_CHAT_TIMEOUT_MS = 25_000;
export const DEFAULT_CHAT_MODEL = "ag/gemini-3.7-flash-low";

export interface OpenAiCompatChatModelOptions {
  /** Base URL ending before `/chat/completions`, e.g. `https://ai.elevenvoice.site/v1`. */
  baseUrl: string;
  apiKey: string;
  model?: string | undefined;
  logger: Logger;
  /** Test seam. */
  fetch?: typeof fetch | undefined;
}

/** The agent's sampling temperature (Desk's level-2 setting). */
const DEFAULT_TEMPERATURE = 0.4;

/** `POST {baseUrl}/chat/completions`, non-streaming. */
export class OpenAiCompatChatModel implements ChatModelPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatChatModelOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = options.apiKey.trim();
    this.model = options.model?.trim() || DEFAULT_CHAT_MODEL;
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  ready(): boolean {
    return this.baseUrl !== "" && this.apiKey !== "";
  }

  async complete(messages: ChatMessage[], options: ChatCallOptions = {}): Promise<ChatOutcome> {
    if (!this.ready()) return noChatModel.complete(messages, options);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model, messages: messages.map(toWireMessage), stream: false,
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          ...(options.json ? { response_format: { type: "json_object" } } : {})
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS)
      });
      const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: unknown } }[]; model?: unknown; usage?: unknown };
      if (!response.ok) {
        const transient = response.status >= 500 || response.status === 429 || response.status === 408;
        return { ok: false, viSao: `gateway HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`, transient };
      }
      const text = String(body.choices?.[0]?.message?.content ?? "");
      if (text.trim() === "") return { ok: false, viSao: "mô hình trả về rỗng", transient: true };
      return { ok: true, text, model: String(body.model ?? this.model), usage: readOpenAiUsage(body.usage) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[agent] goi mo hinh hong: ${message}`);
      return { ok: false, viSao: `không gọi được mô hình: ${message}`, transient: true };
    }
  }
}
