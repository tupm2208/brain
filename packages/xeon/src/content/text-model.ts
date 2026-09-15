/**
 * @file The TEXT MODEL PORT — the one door through which Xeon may ask a language model for prose.
 *
 * `@sp/brain` still never calls a model: the turn engine that answers customers is deterministic,
 * and that is deliberate (it is testable, cheap, and cannot invent a price). Writing marketing
 * copy is a different job with a different risk profile, so it lives here in the application
 * layer, behind a port — same shape as `LandingGateway`.
 *
 * Why a port at all, when there is one adapter today: every test of the writing path runs without
 * a network, without an API key and without spending money. That is the only way a rule like "a
 * sold-out size never reaches the prompt" can be tested at all.
 */

export interface TextRequest {
  system: string;
  user: string;
  /** JSON schema the answer must match, when the caller wants structured output. */
  schema?: Record<string, unknown> | undefined;
  maxTokens?: number | undefined;
}

export type TextOutcome =
  | { ok: true; text: string; model: string }
  | { ok: false; viSao: string };

export interface TextModelPort {
  /** Whether a model is configured at all. False = the feature is off, and says so. */
  ready(): boolean;
  complete(request: TextRequest): Promise<TextOutcome>;
}

/** The port when no model is configured: every call refuses, in a sentence a shop owner can act on. */
export const noTextModel: TextModelPort = {
  ready: () => false,
  complete: async () => ({ ok: false, viSao: "Xeon chưa cấu hình mô hình viết bài (thiếu ANTHROPIC_API_KEY)." })
};
