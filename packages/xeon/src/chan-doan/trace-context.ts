/**
 * @file MÃ VẾT — one id that follows a customer's message across every machine that touches it.
 *
 * A message crosses at least four boundaries: Meta → the landing's inbox → Xeon → back to the
 * landing to be sent. Each side logs its own half, and without a shared id the two halves can only
 * be lined up by guessing from timestamps — which stops working the moment two customers write at
 * once, and stops working completely once there are many landings.
 *
 * The id is created where the chain STARTS (a webhook, an OMI call, a web order) and passed on in
 * the `x-ma-vet` header at every hop. It is carried through the call chain with `AsyncLocalStorage`
 * for the same reason `withUsage` does it (Đ7): the place that knows the id is the entry point, the
 * place that needs it is several calls deeper, and threading an argument would touch every
 * signature in between.
 *
 * It is NOT a secret and NOT a customer identifier: short, typeable, and safe to paste into a chat
 * with a shop.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** The header every hop reads and every hop passes on. */
export const TRACE_HEADER = "x-ma-vet";

/** `v-<thời gian base36>-<ngẫu nhiên>` — sorts by time, short enough to read out loud. */
const TRACE_PATTERN = /^v-[0-9a-z]{1,12}-[0-9a-z]{4,12}$/;

const store = new AsyncLocalStorage<string>();

function randomPart(): string {
  return Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
}

/** A fresh id. `at` only affects the sortable prefix. */
export function newTraceId(at: Date = new Date()): string {
  return `v-${at.getTime().toString(36)}-${randomPart()}`;
}

/**
 * The id from an incoming header, or a fresh one. A header that is not ours is REFUSED rather than
 * passed on: an id is pasted into tickets and typed into commands, and letting a caller choose it
 * turns the log into something a stranger can write to.
 */
export function traceIdFrom(header: unknown, at: Date = new Date()): string {
  const value = String(header ?? "").trim().toLowerCase();
  return TRACE_PATTERN.test(value) ? value : newTraceId(at);
}

/** Runs `work` with `maVet` visible to everything it calls. */
export function withTrace<T>(maVet: string, work: () => T): T {
  return store.run(maVet, work);
}

/** The id of the chain in progress, or `null` outside any `withTrace`. */
export function currentTrace(): string | null {
  return store.getStore() ?? null;
}

/** Headers to add to an outgoing call so the next machine logs under the same id. */
export function traceHeaders(): Record<string, string> {
  const id = currentTrace();
  return id === null ? {} : { [TRACE_HEADER]: id };
}
