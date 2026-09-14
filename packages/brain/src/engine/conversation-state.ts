/**
 * @file Conversation memory: how state is built up and forgotten across turns.
 *
 * The three numbers below are not guesses; they were measured on real TopRun conversations:
 *  - Keep the last 40 turns: real conversations run 48 to 194 messages; keeping 8 means that
 *    after the customer changes model three times the bot only remembers the last one.
 *  - Episode boundary at 6 hours: measured over 170k gaps in a 60-day archive, 77% were under
 *    4h, 5% between 4 and 24h, 18% over 24h. The 4 to 8h band is the valley, so the cut sits there.
 *  - Photo evidence looks back 15 minutes, matching the legacy odd-image rule.
 */

import type { ConversationState, Turn } from "../ports/index";

export const RECENT_TURN_LIMIT = 40;
export const EPISODE_GAP_HOURS = 6;
export const IMAGE_EVIDENCE_MINUTES = 15;

function millis(at: string | undefined): number {
  const t = Date.parse(at ?? "");
  return Number.isFinite(t) ? t : NaN;
}

/** Most recent customer turn. */
export function lastCustomerTurn(state: ConversationState): Turn | null {
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t !== undefined && t.role === "customer") return t;
  }
  return null;
}

/** Most recent shop turn, used to read a terse customer reply as an answer to what the shop asked. */
export function lastShopTurn(state: ConversationState): Turn | null {
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t !== undefined && t.role === "shop") return t;
  }
  return null;
}

/** Whether the shopping episode has gone cold: the gap since the last turn exceeds the threshold. */
export function isNewEpisode(state: ConversationState, now: Date): boolean {
  const last = state.turns[state.turns.length - 1];
  if (last === undefined) return true;
  const t = millis(last.at);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > EPISODE_GAP_HOURS * 3600_000;
}

/**
 * Whether the customer sent a PHOTO recently.
 *
 * The legacy "ask when unsure" gate only looked at the image of the CURRENT turn, so a turn
 * without an image produced a request for a photo the customer had sent 30 seconds earlier.
 * Here the whole history within a 15-minute window is checked.
 */
export function hasRecentImageEvidence(state: ConversationState, now: Date): boolean {
  const cutoff = now.getTime() - IMAGE_EVIDENCE_MINUTES * 60_000;
  return state.turns.some(
    (t) => t.role === "customer" && (t.imageCount ?? 0) > 0 && millis(t.at) >= cutoff
  );
}

/** Whether the bot asked the customer back within the last `minutes`. */
export function askedBackWithin(state: ConversationState, now: Date, minutes: number): boolean {
  const t = millis(state.lastAskBackAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= minutes * 60_000;
}

/** Appends a turn, trims old turns, and opens a new episode when the conversation went cold. */
export function appendTurn(state: ConversationState, turn: Turn, now: Date): ConversationState {
  const fresh = isNewEpisode(state, now);
  const turns = [...state.turns, turn].slice(-RECENT_TURN_LIMIT);
  const next: ConversationState = { ...state, turns };
  if (fresh) {
    next.episodeStartedAt = turn.at;
    // New episode: drop the old focus. A customer returning a day later usually wants something else.
    next.focusItemCode = undefined;
    next.focusItemId = undefined;
    next.focusSlots = undefined;
    next.lastAskBackAt = undefined;
    next.askBackCount = undefined;
    next.idleCount = undefined;
    next.lastIntentId = undefined;
    next.lastAskedSlot = undefined;
    next.handedOff = undefined;
  }
  return next;
}

/**
 * Appends the SHOP's reply. Unlike `appendTurn` it NEVER opens a new episode.
 *
 * Replies used to go through `appendTurn`, which opens episodes based on the customer turn's
 * timestamp. A webhook redelivering an old message then wiped the whole state, including the
 * "handed off" flag, and the bot jumped back into a conversation a human had taken over.
 */
export function appendShopTurn(state: ConversationState, turn: Turn): ConversationState {
  return { ...state, turns: [...state.turns, turn].slice(-RECENT_TURN_LIMIT) };
}

export function emptyState(
  tenant: ConversationState["tenant"],
  conversationId: ConversationState["conversationId"]
): ConversationState {
  return { tenant, conversationId, turns: [] };
}
