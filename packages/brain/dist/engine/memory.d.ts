import type { ConversationState, Turn } from "../ports/index";
export declare const RECENT_TURN_LIMIT = 40;
export declare const EPISODE_GAP_HOURS = 6;
export declare const IMAGE_EVIDENCE_MINUTES = 15;
/** Luot khach gan nhat. */
export declare function lastCustomerTurn(state: ConversationState): Turn | null;
/** Luot shop gan nhat — de doc tin cut cua khach nhu cau tra loi cho dieu shop vua hoi. */
export declare function lastShopTurn(state: ConversationState): Turn | null;
/** Phien mua da nguoi lanh chua: khoang lang tu luot cuoi vuot nguong. */
export declare function isNewEpisode(state: ConversationState, now: Date): boolean;
/**
 * Khach da tung gui ANH gan day chua.
 *
 * Cong "khong chac thi hoi lai" cua he cu tung chi nhin anh cua DUNG luot dang xu ly,
 * nen luot mu anh lai sinh ra cau xin anh — trong khi khach vua gui anh cach do 30 giay.
 * O day doc ca lich su trong cua so 15 phut.
 */
export declare function hasRecentImageEvidence(state: ConversationState, now: Date): boolean;
/** Bot da hoi nguoc khach trong cua so nay chua. */
export declare function askedBackWithin(state: ConversationState, now: Date, minutes: number): boolean;
/** Them mot luot vao tri nho, cat bot phan cu, mo phien moi neu da nguoi lanh. */
export declare function appendTurn(state: ConversationState, turn: Turn, now: Date): ConversationState;
/**
 * Them luot TRA LOI cua shop. Khac `appendTurn` o cho KHONG BAO GIO mo phien moi.
 *
 * Truoc day cau tra loi cung di qua `appendTurn`, ma ham do mo phien moi theo moc
 * thoi gian cua luot khach. Webhook gui lai mot tin cu la trang thai bi xoa sach —
 * ke ca dau "da chuyen nguoi that" — roi bot nhay vao noi tiep.
 */
export declare function appendShopTurn(state: ConversationState, turn: Turn): ConversationState;
export declare function emptyState(tenant: ConversationState["tenant"], conversationId: ConversationState["conversationId"]): ConversationState;
//# sourceMappingURL=memory.d.ts.map