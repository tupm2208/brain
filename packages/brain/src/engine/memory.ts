// TRI NHO HOI THOAI.
//
// Ba con so duoi day khong phai doan, deu do tu hoi thoai that ben he TopRun:
//  - Giu 40 luot gan nhat: hoi thoai that dai 48-194 tin; giu 8 tin thi khach doi mau
//    ba lan la bot chi con nho mau cuoi.
//  - Ranh gioi phien mua 6 gio: do 170 nghin khoang lang tren 60 ngay archive —
//    77% duoi 4h, 5% tu 4-24h, 18% tren 24h. Day 4-8h la thung, nen cat o giua.
//  - Bang chung anh nhin lai 15 phut: khop voi luat anh le cua he cu.

import type { ConversationState, Turn } from "../ports/index";

export const RECENT_TURN_LIMIT = 40;
export const EPISODE_GAP_HOURS = 6;
export const IMAGE_EVIDENCE_MINUTES = 15;

function ms(at: string | undefined): number {
  const t = Date.parse(at ?? "");
  return Number.isFinite(t) ? t : NaN;
}

/** Luot khach gan nhat. */
export function lastCustomerTurn(state: ConversationState): Turn | null {
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t !== undefined && t.role === "customer") return t;
  }
  return null;
}

/** Luot shop gan nhat — de doc tin cut cua khach nhu cau tra loi cho dieu shop vua hoi. */
export function lastShopTurn(state: ConversationState): Turn | null {
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t !== undefined && t.role === "shop") return t;
  }
  return null;
}

/** Phien mua da nguoi lanh chua: khoang lang tu luot cuoi vuot nguong. */
export function isNewEpisode(state: ConversationState, now: Date): boolean {
  const last = state.turns[state.turns.length - 1];
  if (last === undefined) return true;
  const t = ms(last.at);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > EPISODE_GAP_HOURS * 3600_000;
}

/**
 * Khach da tung gui ANH gan day chua.
 *
 * Cong "khong chac thi hoi lai" cua he cu tung chi nhin anh cua DUNG luot dang xu ly,
 * nen luot mu anh lai sinh ra cau xin anh — trong khi khach vua gui anh cach do 30 giay.
 * O day doc ca lich su trong cua so 15 phut.
 */
export function hasRecentImageEvidence(state: ConversationState, now: Date): boolean {
  const cutoff = now.getTime() - IMAGE_EVIDENCE_MINUTES * 60_000;
  return state.turns.some(
    (t) => t.role === "customer" && (t.imageCount ?? 0) > 0 && ms(t.at) >= cutoff
  );
}

/** Bot da hoi nguoc khach trong cua so nay chua. */
export function askedBackWithin(state: ConversationState, now: Date, minutes: number): boolean {
  const t = ms(state.lastAskBackAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= minutes * 60_000;
}

/** Them mot luot vao tri nho, cat bot phan cu, mo phien moi neu da nguoi lanh. */
export function appendTurn(state: ConversationState, turn: Turn, now: Date): ConversationState {
  const fresh = isNewEpisode(state, now);
  const turns = [...state.turns, turn].slice(-RECENT_TURN_LIMIT);
  const next: ConversationState = { ...state, turns };
  if (fresh) {
    next.episodeStartedAt = turn.at;
    // Phien moi: bo tam diem cu di. Khach quay lai sau mot ngay thuong la chuyen khac.
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
 * Them luot TRA LOI cua shop. Khac `appendTurn` o cho KHONG BAO GIO mo phien moi.
 *
 * Truoc day cau tra loi cung di qua `appendTurn`, ma ham do mo phien moi theo moc
 * thoi gian cua luot khach. Webhook gui lai mot tin cu la trang thai bi xoa sach —
 * ke ca dau "da chuyen nguoi that" — roi bot nhay vao noi tiep.
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
