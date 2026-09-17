/**
 * @file Metered models (Decorator): the same ports, plus one ledger row per call (Đ7).
 *
 * The agent, the writer and the AI desk keep calling `ChatModelPort` / `TextModelPort` exactly as
 * before; `app.ts` hands them these wrappers. A call outside any `withUsage` is still written down
 * — as agent `khac` of shop `(khong ro)` — because an unlabelled cost is a bug to find, not a cost
 * to hide.
 */

import type { ChatMessage, ChatModelPort, ChatOutcome } from "../agent/chat-model";
import type { TextModelPort, TextOutcome, TextRequest } from "../content/text-model";
import type { Clock } from "../support/clock";
import { currentUsage, type AgentId } from "./usage-context";
import type { UsageLedger } from "./usage-ledger";

const UNKNOWN = { shop: "(khong ro)", agent: "khac" as AgentId };

export class MeteredChatModel implements ChatModelPort {
  constructor(private readonly inner: ChatModelPort, private readonly ledger: UsageLedger, private readonly clock: Clock, private readonly modelName: string) {}

  ready(): boolean {
    return this.inner.ready();
  }

  async complete(messages: ChatMessage[], options?: { timeoutMs?: number | undefined }): Promise<ChatOutcome> {
    const outcome = await this.inner.complete(messages, options);
    const context = currentUsage() ?? UNKNOWN;
    this.ledger.record(outcome.ok
      ? { context, model: outcome.model || this.modelName, ok: true, usage: outcome.usage, at: this.clock.now() }
      : { context, model: this.modelName, ok: false, error: outcome.viSao, at: this.clock.now() });
    return outcome;
  }
}

export class MeteredTextModel implements TextModelPort {
  constructor(private readonly inner: TextModelPort, private readonly ledger: UsageLedger, private readonly clock: Clock, private readonly modelName: string) {}

  ready(): boolean {
    return this.inner.ready();
  }

  async complete(request: TextRequest): Promise<TextOutcome> {
    const outcome = await this.inner.complete(request);
    const context = currentUsage() ?? UNKNOWN;
    this.ledger.record(outcome.ok
      ? { context, model: outcome.model || this.modelName, ok: true, usage: outcome.usage, at: this.clock.now() }
      : { context, model: this.modelName, ok: false, error: outcome.viSao, at: this.clock.now() });
    return outcome;
  }
}
