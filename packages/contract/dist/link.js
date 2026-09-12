"use strict";
// DUONG NOI OMI <-> BO NAO.
//
// Chieu mo: MAY SHOP chu dong goi ra Xeon roi giu duong do — giong trinh duyet mo mot
// trang roi giu day. Nho vay khach khong can IP tinh, khong mo cong tuong lua,
// khong dung vao router.
//
// Su kien di CA HAI CHIEU: OMI bao viec vua xay ra (don da tra tien, ton doi),
// Bo nao bao viec cua no (bot da chuyen nguoi that).
//
// Moi khung deu co `v`. Bo nao tu choi phuc vu ban qua cu bang khung `reject`
// va noi ro ly do, con hon de ban cu noi chuyen sai voi ban moi.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFRESH_WHAT = exports.MAX_INFLIGHT = exports.LINK_PROTOCOL_VERSION = void 0;
exports.parseLinkFrame = parseLinkFrame;
exports.isFrameKind = isFrameKind;
exports.isCompatible = isCompatible;
exports.makeCall = makeCall;
const ids_1 = require("./ids");
const errors_1 = require("./errors");
const tools_1 = require("./tools");
const chung_chi_1 = require("./chung-chi");
/** Doi so nay khi hinh dang khung thay doi kieu khong tuong thich nguoc. */
exports.LINK_PROTOCOL_VERSION = "1";
/**
 * Tran so luot goi chay song song ma Xeon duoc phep dat trong khung `welcome`.
 *
 * Phai DUOI suc chua that cua lop du lieu ben OMI (ho ket noi 10 + hang cho 50 = 60),
 * khong thi luot goi thu 61 nhan mot ma loi cua thu vien may chu du lieu — mot chuoi
 * tho, khong phai `LinkError`, va Bo nao khong phan loai duoc.
 */
exports.MAX_INFLIGHT = 40;
/** Nhung thu Xeon co the bao OMI lay lai. `license` = chao lai de `welcome` mang cong cu moi. */
exports.REFRESH_WHAT = ["license", "pack", "recipes"];
// ---------------------------------------------------------------------------
// Kiem khung nhan tu mang. Du lieu tu mang luon la du lieu la.
// ---------------------------------------------------------------------------
const REQUIRED_FIELDS = {
    challenge: ["v", "nonce", "expiresAt"],
    hello: ["v", "tenant", "machine", "contract", "omiVersion", "nonce", "proof", "keyId"],
    activate: ["v", "code", "machine", "publicKeyPem", "contract", "omiVersion", "nonce", "proof"],
    activated: ["v", "tenant", "tenantName", "keyId", "packId", "modules", "expiresAt", "ghim", "khoaCongKy", "ghimSeq", "issuedAt"],
    pins: ["v", "ghim", "reason", "seq", "issuedAt"],
    welcome: ["v", "sessionId", "tools", "heartbeatSec", "maxFrameBytes", "maxInflight", "lastEventSeq"],
    reject: ["v", "error", "retryAfterSec"],
    call: ["v", "id", "sessionId", "tool", "input", "actor", "timeoutMs"],
    cancel: ["v", "id", "sessionId", "reason"],
    result: ["v", "id", "sessionId", "ok"],
    event: ["v", "seq", "event"],
    ack: ["v", "seq"],
    ping: ["v", "at"],
    pong: ["v", "at"],
    refresh: ["v", "what", "reason"]
};
/**
 * Kiem DU truong bat buoc theo tung loai khung roi moi khang dinh kieu.
 *
 * Ban dau ham nay chi nhin truong `t` roi khai `v is LinkFrame` — nghia la
 * `{t:"call"}` rong tuech cung duoc TypeScript tin la mot luot goi day du, va
 * `frame.input` rac chui thang vao tang duoi. Day la ham kiem duy nhat o bien mang
 * nen no khong duoc phep noi doi.
 */
function parseLinkFrame(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, reason: "Khung phai la mot doi tuong." };
    }
    const obj = value;
    const t = obj["t"];
    if (typeof t !== "string")
        return { ok: false, reason: "Thieu truong 't'." };
    const required = REQUIRED_FIELDS[t];
    if (required === undefined)
        return { ok: false, reason: `Loai khung la: "${t}".` };
    const missing = required.filter((f) => obj[f] === undefined);
    if (missing.length > 0) {
        return { ok: false, reason: `Khung "${t}" thieu truong: ${missing.join(", ")}.` };
    }
    if (obj["v"] !== exports.LINK_PROTOCOL_VERSION) {
        return { ok: false, reason: `Khung "${t}" dung giao thuc "${String(obj["v"])}", ben nay dung "${exports.LINK_PROTOCOL_VERSION}".` };
    }
    if (t === "result" && typeof obj["ok"] !== "boolean") {
        return { ok: false, reason: "Khung result phai co truong 'ok' dang dung/sai." };
    }
    // Khung `result` phai MANG mot trong hai thu: du lieu, hoac loi co ma. Truoc day mot
    // khung `{ok:true}` trong ruot van qua duoc, roi `data.rows.filter` nem o tang duoi va
    // ca luot tin chet — khach khong nhan duoc gi.
    if (t === "result") {
        if (obj["ok"] === true) {
            const d = obj["data"];
            if (d === null || typeof d !== "object" || Array.isArray(d)) {
                return { ok: false, reason: "Khung result ok=true phai co 'data' la mot doi tuong." };
            }
        }
        else {
            const e = obj["error"];
            if (e === null || typeof e !== "object" || !(0, errors_1.isErrorCode)(e.code)) {
                return { ok: false, reason: "Khung result ok=false phai co 'error' voi ma loi hop le." };
            }
        }
    }
    // Khung `call`: ten cong cu phai co that, va `input` phai la mot doi tuong — `[]`, `42`,
    // `"rac"` deu tung qua duoc, va voi `[]` thi `stock.lookup` tra `rows: []` de bot
    // khang dinh HET HANG tren mot dau vao rac.
    if (t === "call") {
        if (!(0, tools_1.isToolName)(obj["tool"])) {
            return { ok: false, reason: `Khung call goi cong cu la: "${String(obj["tool"])}".` };
        }
        const i = obj["input"];
        if (i === null || typeof i !== "object" || Array.isArray(i)) {
            return { ok: false, reason: "Khung call phai co 'input' la mot doi tuong." };
        }
    }
    // Khung `refresh`: `what` phai la mang KHONG RONG cac muc da biet. OMI doc `what.includes`
    // — mot chuoi cung co `includes`, nen khong kiem o day thi "license" dang chuoi lot qua va
    // OMI lam viec tren mot khung ma hai ben hieu khac nhau.
    if (t === "refresh") {
        const w = obj["what"];
        if (!Array.isArray(w) || w.length === 0 || !w.every((x) => exports.REFRESH_WHAT.includes(x))) {
            return { ok: false, reason: `Khung refresh phai co 'what' la mang khong rong trong ${exports.REFRESH_WHAT.join("/")}.` };
        }
    }
    // Khung `activate`: khoa CONG KHAI phai la PEM cong khai — mang "PRIVATE KEY" la OMI (hay mot
    // ban vá sai) vua gui khoa rieng len Xeon; chan o bien, khong de tang duoi "tien tay" luu.
    // Cac truong chuoi phai KHONG RONG: ma rong / proof rong qua duoc thi tang duoi kiem chu ky
    // tren chuoi rong, va loi doc ra kho hieu.
    if (t === "activate") {
        for (const f of ["code", "machine", "publicKeyPem", "contract", "omiVersion", "nonce", "proof"]) {
            if (typeof obj[f] !== "string" || obj[f] === "")
                return { ok: false, reason: `Khung activate: '${f}' phai la chuoi khong rong.` };
        }
        const pem = obj["publicKeyPem"];
        if (/PRIVATE KEY/.test(pem))
            return { ok: false, reason: "Khung activate mang KHOA RIENG (PRIVATE KEY) — khoa rieng khong duoc roi khoi may shop." };
        if (!/BEGIN PUBLIC KEY/.test(pem))
            return { ok: false, reason: "Khung activate: 'publicKeyPem' phai la PEM PUBLIC KEY." };
    }
    // Danh sach ghim: moi ghim dung dang va KHONG TRUNG. `pins` phai KHONG RONG (rong = OMI
    // khong tin ai nua); `activated.ghim` duoc rong (Xeon noi bo khong TLS).
    if (t === "pins" || t === "activated") {
        const g = obj["ghim"];
        if (!Array.isArray(g) || !g.every((x) => (0, chung_chi_1.laGhimHopLe)(x)) || new Set(g).size !== g.length) {
            return { ok: false, reason: `Khung ${t}: 'ghim' phai la mang ghim sha256/<base64> hop le, khong trung.` };
        }
        if (t === "pins" && g.length === 0)
            return { ok: false, reason: "Khung pins: danh sach ghim rong." };
    }
    if (t === "pins") {
        if (typeof obj["issuedAt"] !== "string" || !Number.isFinite(Date.parse(obj["issuedAt"])))
            return { ok: false, reason: "Khung pins: 'issuedAt' phai la moc ISO." };
        if (typeof obj["seq"] !== "number" || !Number.isSafeInteger(obj["seq"]) || obj["seq"] < 0)
            return { ok: false, reason: "Khung pins: 'seq' phai la so nguyen khong am." };
        if (typeof obj["reason"] !== "string")
            return { ok: false, reason: "Khung pins: 'reason' phai la chuoi." };
        if (obj["signature"] !== undefined && (typeof obj["signature"] !== "string" || obj["signature"] === ""))
            return { ok: false, reason: "Khung pins: 'signature' phai la chuoi khong rong." };
    }
    if (t === "activated") {
        const m = obj["modules"];
        if (!Array.isArray(m) || !m.every((x) => typeof x === "string"))
            return { ok: false, reason: "Khung activated: 'modules' phai la mang chuoi." };
        for (const f of ["tenant", "tenantName", "keyId", "packId", "expiresAt", "khoaCongKy"]) {
            if (typeof obj[f] !== "string" || obj[f] === "")
                return { ok: false, reason: `Khung activated: '${f}' phai la chuoi khong rong.` };
        }
        const ky = obj["khoaCongKy"];
        if (/PRIVATE KEY/.test(ky) || !/BEGIN PUBLIC KEY/.test(ky))
            return { ok: false, reason: "Khung activated: 'khoaCongKy' phai la PEM PUBLIC KEY." };
        if (!Number.isFinite(Date.parse(obj["issuedAt"])))
            return { ok: false, reason: "Khung activated: 'issuedAt' phai la moc ISO." };
        if (typeof obj["ghimSeq"] !== "number" || !Number.isSafeInteger(obj["ghimSeq"]) || obj["ghimSeq"] < 0)
            return { ok: false, reason: "Khung activated: 'ghimSeq' phai la so nguyen khong am." };
    }
    // BOT PHAI GAN VOI MOT HOI THOAI. Cuong che ngay o bien mang, khong de tang duoi tu
    // xoay so: OMI coi ma hoi thoai la mot cai CONG (bot khong co no thi khong mo duoc
    // don nao), nen de truong nay tuy chon cho bot la mo lai dung con duong bot tu dat
    // ma hoi thoai, tu cap chia khoa cho cai ten no bia ra, roi doc ho so mua hang cua
    // nguoi la. Nguoi that thi khong bat buoc — ho lam viec tren kho cua chinh ho.
    if (t === "call" && obj["actor"] === ids_1.BOT_ACTOR) {
        const hoi = obj["conversationId"];
        if (typeof hoi !== "string" || hoi === "") {
            return { ok: false, reason: "Luot goi cua bot phai co 'conversationId'." };
        }
    }
    return { ok: true, frame: value };
}
/** Chi hoi "co phai khung khong", khong khang dinh du truong. Dung khi da parse roi. */
function isFrameKind(v, kind) {
    return v !== null && typeof v === "object" && v.t === kind;
}
// ---------------------------------------------------------------------------
// So sanh phien ban — cai vao ma cai luat "tu choi ban qua cu"
// ---------------------------------------------------------------------------
function parseSemver(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (m === null)
        return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}
/** `have` co dat toi thieu `min` khong. Sai dinh dang thi coi nhu KHONG dat. */
function isCompatible(have, min) {
    const a = parseSemver(have);
    const b = parseSemver(min);
    if (a === null || b === null)
        return false;
    for (let i = 0; i < 3; i += 1) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y)
            return x > y;
    }
    return true;
}
function makeCall(args) {
    return {
        t: "call",
        v: exports.LINK_PROTOCOL_VERSION,
        id: args.id,
        sessionId: args.sessionId,
        tool: args.tool,
        input: args.input,
        actor: args.actor,
        conversationId: args.conversationId,
        idempotencyKey: args.idempotencyKey,
        timeoutMs: args.timeoutMs ?? 8000
    };
}
//# sourceMappingURL=link.js.map