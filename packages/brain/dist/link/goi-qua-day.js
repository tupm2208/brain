"use strict";
// DAU DAY PHIA BO NAO — dong khung, gui di, cho ket qua.
//
// Day la mot `ToolPort` nhu moi `ToolPort` khac, nen bo may khong biet minh dang goi
// qua mang hay goi mot cua gia trong bai kiem tra. Do la ly do `ports` ton tai.
//
// BA dieu khac vao day:
//
// 1. HET GIO PHAI LA MOT CAU TRA LOI, khong phai mot loi hua treo mai. Bot cho mot cua
//    khong bao gio tra loi la khach ngoi nhin man hinh "dang soan tin" den luc bo di.
// 2. MAT DUONG thi `online()` tra ve sai, va bo may co san che do han che cho viec do:
//    van chao khach, khong khang dinh ton kho. Tha im ve con so con hon noi sai.
// 3. MOI luot goi mang theo ma hoi thoai. Phia OMI coi no la mot cai CONG.
Object.defineProperty(exports, "__esModule", { value: true });
exports.taoToolPort = taoToolPort;
const contract_1 = require("@sp/contract");
const node_crypto_1 = require("node:crypto");
function taoToolPort(cfg) {
    const cho = new Map();
    let dem = 0;
    let daDong = false;
    const han = cfg.timeoutMs ?? 15_000;
    // Ma luot goi phai DUY NHAT theo CUA, khong chi theo phien. Hai cua cung mot ma phien
    // (hoac noi lai giu nguyen ma phien, bo dem ve 0) la khung ket qua cua lot cu tra vao
    // nguoi dang cho o luot moi — bot doc cho khach con so ton cua mot luot da bo.
    const tienTo = (0, node_crypto_1.randomUUID)();
    const goDangKy = cfg.kenh.nghe((f) => {
        if (daDong)
            return;
        // Du lieu tu mang la du lieu la — KIEM truoc, khong nhin moi truong `t`. Mot khung
        // `result` hong lam `data.rows.filter` nem o tang duoi va ca luot tin chet.
        const kiem = (0, contract_1.parseLinkFrame)(f);
        if (!kiem.ok || kiem.frame.t !== "result")
            return;
        const r = kiem.frame;
        const doi = cho.get(r.id);
        if (doi === undefined)
            return;
        // Luot goi cua PHIEN KHAC khong duoc tra vao cho nguoi dang cho o phien nay.
        if (r.sessionId !== cfg.sessionId)
            return;
        cho.delete(r.id);
        clearTimeout(doi.dongHo);
        if (r.ok) {
            const loi = (0, contract_1.kiemOutput)(doi.tool, r.data);
            if (loi !== null) {
                doi.xong({
                    t: "result", v: contract_1.LINK_PROTOCOL_VERSION, id: r.id, sessionId: cfg.sessionId, ok: false,
                    error: (0, contract_1.linkError)("internal", `Ket qua "${doi.tool}" sai hinh dang: ${loi}.`)
                });
                return;
            }
        }
        doi.xong(r);
    });
    return {
        available: () => [...cfg.tools],
        online: () => (cfg.online ?? (() => true))(),
        dong: () => {
            daDong = true;
            goDangKy();
            for (const [id, doi] of cho) {
                clearTimeout(doi.dongHo);
                doi.xong({
                    t: "result", v: contract_1.LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId, ok: false,
                    error: (0, contract_1.linkError)("omi_offline", "Duong noi toi may shop da dong.")
                });
            }
            cho.clear();
        },
        async call(tool, input, nguCanh) {
            if (daDong) {
                return { ok: false, tool, error: (0, contract_1.linkError)("omi_offline", "Duong noi toi may shop da dong.") };
            }
            if (!this.online()) {
                return { ok: false, tool, error: (0, contract_1.linkError)("omi_offline", "May shop dang khong noi duoc.") };
            }
            dem += 1;
            const id = `${tienTo}-${dem}`;
            const frame = {
                t: "call",
                v: contract_1.LINK_PROTOCOL_VERSION,
                id,
                sessionId: cfg.sessionId,
                tool,
                input,
                actor: cfg.actor,
                timeoutMs: han,
                ...(nguCanh?.conversationId === undefined
                    ? {}
                    : { conversationId: nguCanh.conversationId }),
                ...(nguCanh?.idempotencyKey === undefined
                    ? {}
                    : { idempotencyKey: nguCanh.idempotencyKey })
            };
            const ra = await new Promise((xong) => {
                // Het gio la MOT CAU TRA LOI. Khong co dong ho nay thi mot luot goi that lac
                // se treo mai, va khach ngoi nhin "dang soan tin" den luc bo di.
                const dongHo = setTimeout(() => {
                    cho.delete(id);
                    cfg.kenh.gui({
                        t: "cancel", v: contract_1.LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId,
                        reason: "het gio"
                    });
                    xong({
                        t: "result", v: contract_1.LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId, ok: false,
                        error: (0, contract_1.linkError)("omi_offline", `May shop khong tra loi trong ${han}ms.`)
                    });
                }, han);
                cho.set(id, { tool, xong, dongHo });
                try {
                    cfg.kenh.gui(frame);
                }
                catch (e) {
                    cho.delete(id);
                    clearTimeout(dongHo);
                    xong({
                        t: "result", v: contract_1.LINK_PROTOCOL_VERSION, id, sessionId: cfg.sessionId, ok: false,
                        error: (0, contract_1.linkError)("omi_offline", String(e?.message ?? e))
                    });
                }
            });
            return ra.ok
                ? { ok: true, tool, data: ra.data }
                : { ok: false, tool, error: ra.error };
        }
    };
}
//# sourceMappingURL=goi-qua-day.js.map