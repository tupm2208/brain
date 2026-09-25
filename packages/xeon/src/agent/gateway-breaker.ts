/**
 * @file THE GATEWAY BREAKER (25/09/2026): when the model gateway keeps failing, stop paying for it.
 *
 * Every model seat of a turn (LLM#1, the agent, LLM#3, the photo reader, LLM#2) sits behind the
 * same gateway. When it is down, each turn used to burn its whole budget on retries and still end
 * at the rule engine — the customer waited a minute for the same answer a script gives in a second.
 *
 * Rule: `threshold` transient failures within `windowMs` OPEN the breaker for `openMs`. While
 * open, every call is refused at once (a failed outcome, no network); the pipeline sees `isOpen()`
 * and goes scripts / rule engine, telling the shop ONCE. Every `probeMs` one light call is let
 * through (`probe`); a success closes the breaker, a failure keeps it open. A real success at any
 * time closes it too. Thresholds come from the environment (`XEON_CAU_DAO_LOI`, `XEON_CAU_DAO_MO_MS`).
 */

import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import type { ChatMessage, ChatModelPort, ChatOutcome } from "./chat-model";

export interface GatewayBreakerOptions {
  clock: Clock;
  logger: Logger;
  /** Transient failures that open the breaker (default 3). */
  threshold?: number | undefined;
  /** Window the failures are counted in (default 5 minutes). */
  windowMs?: number | undefined;
  /** How long the breaker stays open (default 10 minutes). */
  openMs?: number | undefined;
  /** How often one probe call is let through while open (default 60 s). */
  probeMs?: number | undefined;
}

export interface BreakerState {
  open: boolean;
  failures: number;
  openedAt: string | null;
}

const PROBE_MESSAGES: ChatMessage[] = [{ role: "user", content: "Tra loi dung mot chu: ok" }];

export class GatewayBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private lastProbeAt = 0;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly openMs: number;
  private readonly probeMs: number;

  constructor(private readonly options: GatewayBreakerOptions) {
    this.threshold = Math.max(1, options.threshold ?? 3);
    this.windowMs = Math.max(1000, options.windowMs ?? 5 * 60_000);
    this.openMs = Math.max(1000, options.openMs ?? 10 * 60_000);
    this.probeMs = Math.max(1000, options.probeMs ?? 60_000);
  }

  private now(): number {
    return this.options.clock.now().getTime();
  }

  /** Records one outcome. A transient failure counts; a success closes an open breaker and clears the count. */
  record(outcome: ChatOutcome): void {
    const now = this.now();
    if (outcome.ok) {
      if (this.openedAt !== null) this.options.logger.info("[cau-dao] cong AI tra loi lai — dong cau dao");
      this.failures = [];
      this.openedAt = null;
      return;
    }
    if (!outcome.transient) return;
    this.failures = [...this.failures.filter((t) => now - t < this.windowMs), now];
    if (this.openedAt === null && this.failures.length >= this.threshold) {
      this.openedAt = now;
      this.lastProbeAt = now;
      this.options.logger.warn(`[cau-dao] cong AI loi ${this.failures.length} lan trong ${Math.round(this.windowMs / 60000)} phut — MO cau dao ${Math.round(this.openMs / 60000)} phut, chi tra loi bang kich ban / may luat`);
    }
  }

  /** Open right now (an open breaker past `openMs` closes by itself). */
  isOpen(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.openMs) {
      this.options.logger.info("[cau-dao] het thoi gian mo — dong cau dao, thu lai cong AI");
      this.openedAt = null;
      this.failures = [];
      return false;
    }
    return true;
  }

  state(): BreakerState {
    return { open: this.isOpen(), failures: this.failures.length, openedAt: this.openedAt === null ? null : new Date(this.openedAt).toISOString() };
  }

  /**
   * While open: once per `probeMs`, one light call to the gateway. `true` when the gateway answered
   * and the breaker closed — the turn may use the models again. `false` otherwise (still open, or
   * the probe is not due yet).
   */
  async probe(model: ChatModelPort): Promise<boolean> {
    if (!this.isOpen()) return true;
    const now = this.now();
    if (now - this.lastProbeAt < this.probeMs) return false;
    this.lastProbeAt = now;
    const outcome = await model.complete(PROBE_MESSAGES, { timeoutMs: 5000 });
    this.record(outcome);
    return this.openedAt === null;
  }

  /**
   * The model behind the breaker: outcomes are recorded, and while open every call is refused at
   * once with a transient failure — so a caller that forgot to ask `isOpen()` still waits for nothing.
   */
  wrap(inner: ChatModelPort): ChatModelPort {
    return {
      ready: () => inner.ready(),
      complete: async (messages, options) => {
        if (this.isOpen()) return { ok: false, viSao: "cau dao cong AI dang mo", transient: true };
        const outcome = await inner.complete(messages, options);
        this.record(outcome);
        return outcome;
      }
    };
  }
}
