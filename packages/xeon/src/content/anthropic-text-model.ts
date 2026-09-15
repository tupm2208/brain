/**
 * @file The adapter behind `TextModelPort`: Claude through the official Anthropic SDK.
 *
 * This is the ONLY file in the three projects that talks to a language model, and the only reason
 * `@sp/xeon` has a runtime dependency at all. Everything above it — the prompt, the draft reader,
 * the HTTP door — is pure and tested without a key.
 *
 * WHY THE KEY LIVES HERE AND NOWHERE ELSE: a shop never buys or types an AI key (decided
 * 14/09/2026). One key on Xeon serves every merchant, so a shop's landing asks Xeon and Xeon asks
 * the model. If the key were shop configuration it would be in a screen, in a database, and in a
 * backup.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "../support/logger";
import type { TextModelPort, TextOutcome, TextRequest } from "./text-model";

/** Default model. Copy is short output, so a non-streaming call is fine. */
export const DEFAULT_WRITER_MODEL = "claude-opus-5";
const DEFAULT_MAX_TOKENS = 16000;

export interface AnthropicTextModelOptions {
  apiKey: string;
  model?: string | undefined;
  logger: Logger;
  /** Test seam: the SDK client. Production leaves it out. */
  client?: Anthropic | undefined;
}

export class AnthropicTextModel implements TextModelPort {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly configured: boolean;

  constructor(options: AnthropicTextModelOptions) {
    this.configured = options.apiKey.trim() !== "" || options.client !== undefined;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.model = options.model?.trim() || DEFAULT_WRITER_MODEL;
    this.logger = options.logger;
  }

  ready(): boolean {
    return this.configured;
  }

  async complete(request: TextRequest): Promise<TextOutcome> {
    if (!this.configured) return { ok: false, viSao: "Xeon chưa cấu hình mô hình viết bài (thiếu ANTHROPIC_API_KEY)." };
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        // Writing to a dozen constraints at once is exactly the kind of work adaptive thinking is
        // for: the model plans the hook, the length and the banned phrases before it writes.
        thinking: { type: "adaptive" },
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        ...(request.schema === undefined ? {} : { output_config: { format: { type: "json_schema" as const, schema: request.schema } } })
      });

      // A policy decline comes back as a normal 200 — check before reading the content, or the
      // reply looks like an empty draft.
      if (response.stop_reason === "refusal") {
        this.logger.warn(`[bo-nao] mo hinh tu choi viet bai: ${response.stop_details?.category ?? "khong ro"}`);
        return { ok: false, viSao: "Mô hình từ chối viết bài này. Sửa lại chủ đề hoặc mã hàng rồi thử lại." };
      }

      const text = response.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      if (text === "") return { ok: false, viSao: "Mô hình trả về bài rỗng." };
      return { ok: true, text, model: response.model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[bo-nao] goi mo hinh viet bai hong: ${message}`);
      return { ok: false, viSao: `Không gọi được mô hình viết bài: ${message}` };
    }
  }
}
