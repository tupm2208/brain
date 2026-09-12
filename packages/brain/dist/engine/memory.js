"use strict";
// TRI NHO HOI THOAI.
//
// Ba con so duoi day khong phai doan, deu do tu hoi thoai that ben he TopRun:
//  - Giu 40 luot gan nhat: hoi thoai that dai 48-194 tin; giu 8 tin thi khach doi mau
//    ba lan la bot chi con nho mau cuoi.
//  - Ranh gioi phien mua 6 gio: do 170 nghin khoang lang tren 60 ngay archive —
//    77% duoi 4h, 5% tu 4-24h, 18% tren 24h. Day 4-8h la thung, nen cat o giua.
//  - Bang chung anh nhin lai 15 phut: khop voi luat anh le cua he cu.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_EVIDENCE_MINUTES = exports.EPISODE_GAP_HOURS = exports.RECENT_TURN_LIMIT = void 0;
exports.lastCustomerTurn = lastCustomerTurn;
exports.lastShopTurn = lastShopTurn;
exports.isNewEpisode = isNewEpisode;
exports.hasRecentImageEvidence = hasRecentImageEvidence;
exports.askedBackWithin = askedBackWithin;
exports.appendTurn = appendTurn;
exports.appendShopTurn = appendShopTurn;
exports.emptyState = emptyState;
exports.RECENT_TURN_LIMIT = 40;
exports.EPISODE_GAP_HOURS = 6;
exports.IMAGE_EVIDENCE_MINUTES = 15;
function ms(at) {
    const t = Date.parse(at ?? "");
    return Number.isFinite(t) ? t : NaN;
}
/** Luot khach gan nhat. */
function lastCustomerTurn(state) {
    for (let i = state.turns.length - 1; i >= 0; i -= 1) {
        const t = state.turns[i];
        if (t !== undefined && t.role === "customer")
            return t;
    }
    return null;
}
/** Luot shop gan nhat — de doc tin cut cua khach nhu cau tra loi cho dieu shop vua hoi. */
function lastShopTurn(state) {
    for (let i = state.turns.length - 1; i >= 0; i -= 1) {
        const t = state.turns[i];
        if (t !== undefined && t.role === "shop")
            return t;
    }
    return null;
}
/** Phien mua da nguoi lanh chua: khoang lang tu luot cuoi vuot nguong. */
function isNewEpisode(state, now) {
    const last = state.turns[state.turns.length - 1];
    if (last === undefined)
        return true;
    const t = ms(last.at);
    if (!Number.isFinite(t))
        return true;
    return now.getTime() - t > exports.EPISODE_GAP_HOURS * 3600_000;
}
/**
 * Khach da tung gui ANH gan day chua.
 *
 * Cong "khong chac thi hoi lai" cua he cu tung chi nhin anh cua DUNG luot dang xu ly,
 * nen luot mu anh lai sinh ra cau xin anh — trong khi khach vua gui anh cach do 30 giay.
 * O day doc ca lich su trong cua so 15 phut.
 */
function hasRecentImageEvidence(state, now) {
    const cutoff = now.getTime() - exports.IMAGE_EVIDENCE_MINUTES * 60_000;
    return state.turns.some((t) => t.role === "customer" && (t.imageCount ?? 0) > 0 && ms(t.at) >= cutoff);
}
/** Bot da hoi nguoc khach trong cua so nay chua. */
function askedBackWithin(state, now, minutes) {
    const t = ms(state.lastAskBackAt);
    if (!Number.isFinite(t))
        return false;
    return now.getTime() - t <= minutes * 60_000;
}
/** Them mot luot vao tri nho, cat bot phan cu, mo phien moi neu da nguoi lanh. */
function appendTurn(state, turn, now) {
    const fresh = isNewEpisode(state, now);
    const turns = [...state.turns, turn].slice(-exports.RECENT_TURN_LIMIT);
    const next = { ...state, turns };
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
function appendShopTurn(state, turn) {
    return { ...state, turns: [...state.turns, turn].slice(-exports.RECENT_TURN_LIMIT) };
}
function emptyState(tenant, conversationId) {
    return { tenant, conversationId, turns: [] };
}
//# sourceMappingURL=memory.js.map