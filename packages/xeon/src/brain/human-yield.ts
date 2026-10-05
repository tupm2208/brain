/**
 * @file YIELDING TO THE PERSON ON DUTY (05/10/2026, phiếu Desk "nhường khi người thật đang trực" +
 * "nhường xong phải tiếp quản").
 *
 * The bot speaks only when no person is handling the conversation. "A person is handling it" is read
 * from FACTS the landing keeps, never from the wording of a message (a person may well type "em là
 * trợ lý AI…"):
 *
 *   1. a page message in the window that a PERSON wrote — not the bot (`boi` = "bo-nao"), not a line the
 *      channel itself produced (`boi` = "meta"), not a line of unknown origin (`boi` = "", filed before
 *      authors were recorded);
 *   2. a person TYPING in the reply box within the window (`hoiThoai.nguoiGoLuc`; opening the thread is
 *      not typing).
 *
 * The window is the shop's own choice (tier 3, `chuyenNguoi.phutNhuong`); unset = the platform default.
 * Yielding is TEMPORARY: the verdict says when the window ends, and the brain asks the landing to hand
 * the turn back then (`BrainService`), so yielding never turns into silence. A person pressing
 * "bot trả lời tiếp" (`tiepQuan: "nguoi-bam"`) lifts the yield for that turn.
 *
 * Pure: no clock, no network.
 */

import { DEFAULT_HUMAN_YIELD_MINUTES, MAX_HUMAN_YIELD_MINUTES, type ShopProfile, type ToolOutput } from "@sp/contract";

type RecentOutput = ToolOutput<"conversation.recent">;
type RecentLine = RecentOutput["tin"][number];

/** Authors of page lines that are NOT a person on duty: the bot, and the channel's own notices. */
// 05/10/2026: "don-hang" = the landing's own order notices (a milestone of the customer's order) — not a person.
export const NOT_A_PERSON: ReadonlySet<string> = new Set(["bo-nao", "don-hang", "meta", "khach"]);

/** Whether a page line was written by a person on duty (unknown authors are not assumed to be one). */
export function writtenByPerson(line: Pick<RecentLine, "chieu" | "boi">): boolean {
  const who = String(line.boi ?? "").trim();
  return line.chieu === "di" && who !== "" && !NOT_A_PERSON.has(who);
}

/** The shop's yield window in milliseconds (tier 3), the platform default when unset. */
export function yieldWindowMs(profile: Pick<ShopProfile, "chuyenNguoi"> | null): number {
  const set = profile?.chuyenNguoi?.phutNhuong;
  const minutes = typeof set === "number" && set >= 1 && set <= MAX_HUMAN_YIELD_MINUTES ? set : DEFAULT_HUMAN_YIELD_MINUTES;
  return minutes * 60_000;
}

export interface YieldVerdict {
  yields: boolean;
  /** When the yield ends (ms since epoch); present when `yields`. */
  untilMs?: number;
  /** What made the bot yield, for the log: "nhan-tay" (a person wrote) or "dang-go" (a person is typing). */
  why?: "nhan-tay" | "dang-go";
}

/**
 * Whether the bot keeps out of the conversation now. `takeover` = the landing pushed the message again
 * because a person asked (`nguoi-bam`, never yields) or the window passed (`het-nhuong`, yields again only
 * if a person became active since).
 */
export function humanYield(input: {
  recent: Pick<RecentOutput, "tin" | "hoiThoai">;
  profile: Pick<ShopProfile, "chuyenNguoi"> | null;
  nowMs: number;
  takeover?: string | undefined;
}): YieldVerdict {
  if (input.takeover === "nguoi-bam") return { yields: false };
  const windowMs = yieldWindowMs(input.profile);
  let last = -Infinity;
  let why: YieldVerdict["why"];
  for (const line of input.recent.tin) {
    if (!writtenByPerson(line)) continue;
    const at = Date.parse(line.luc);
    if (Number.isFinite(at) && at > last) { last = at; why = "nhan-tay"; }
  }
  const typed = Date.parse(String(input.recent.hoiThoai?.nguoiGoLuc ?? ""));
  if (Number.isFinite(typed) && typed > last) { last = typed; why = "dang-go"; }
  if (!Number.isFinite(last)) return { yields: false };
  // 05/10/2026 (phiếu Desk "tin khách đến trong lúc AI chạy"): a person pressed "bot trả lời tiếp" AFTER their
  // last activity — they handed the conversation back. A customer message that superseded that turn (or any
  // later one) must not fall back into the yield the person already lifted.
  const handedBack = Date.parse(String(input.recent.hoiThoai?.botTiepLuc ?? ""));
  if (Number.isFinite(handedBack) && handedBack >= last) return { yields: false };
  const untilMs = last + windowMs;
  return untilMs > input.nowMs ? { yields: true, untilMs, ...(why !== undefined ? { why } : {}) } : { yields: false };
}
