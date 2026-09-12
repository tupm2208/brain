import type { LinkError } from "./errors";
import type { EventEnvelope } from "./events";
import { type ActorId, type ConversationId, type MachineId, type TenantId } from "./ids";
import type { ToolInput, ToolName, ToolOutput } from "./tools";
import type { ModuleId } from "./modules";
/** Doi so nay khi hinh dang khung thay doi kieu khong tuong thich nguoc. */
export declare const LINK_PROTOCOL_VERSION = "1";
/**
 * Tran so luot goi chay song song ma Xeon duoc phep dat trong khung `welcome`.
 *
 * Phai DUOI suc chua that cua lop du lieu ben OMI (ho ket noi 10 + hang cho 50 = 60),
 * khong thi luot goi thu 61 nhan mot ma loi cua thu vien may chu du lieu — mot chuoi
 * tho, khong phai `LinkError`, va Bo nao khong phan loai duoc.
 */
export declare const MAX_INFLIGHT = 40;
/**
 * Xeon phat thu thach TRUOC khi OMI chao. Khong co buoc nay thi ai bat duoc mot khung
 * hello (nhat ky, may trung gian, hoac mot ban OMI bi lay trom) la phat lai duoc vo han.
 */
export interface ChallengeFrame {
    t: "challenge";
    v: string;
    nonce: string;
    /** Han dung cua thu thach, dang ISO. */
    expiresAt: string;
}
/** OMI chao Xeon, mang theo thu thach vua nhan. */
export interface HelloFrame {
    t: "hello";
    v: string;
    tenant: TenantId;
    machine: MachineId;
    /** Phien ban ban giao keo ma OMI nay dung — Xeon so voi `minContract`. */
    contract: string;
    /** Phien ban OMI, dang semver. */
    omiVersion: string;
    /** Chinh la `nonce` cua khung challenge, gui lai de chung minh khong phai ban phat lai. */
    nonce: string;
    /**
     * Chu ky cua chuoi `${nonce}.${tenant}.${machine}.${contract}` bang khoa may.
     * Khoa may do Xeon cap luc kich hoat; OMI khong tu tao duoc.
     */
    proof: string;
    keyId: string;
    /** Su kien cuoi cung OMI da nhan duoc ack — de noi lai ma khong mat su kien. */
    lastAckedSeq?: number | undefined;
}
/**
 * OMI CHUA CO KHOA MAY: thay vi `hello`, tra loi thu thach bang khung nay (A5). Mang ma kich
 * hoat (giay phep ky so), khoa CONG KHAI vua sinh tren may shop, va `proof` = chu ky cua
 * `chuoiDeKyKichHoat({ nonce, licenseId, machine, contract })` bang khoa RIENG tuong ung —
 * chung minh OMI giu khoa rieng, va chong phat lai. Khoa rieng khong bao gio di qua day:
 * `parseLinkFrame` chan khung mang "PRIVATE KEY" ngay o bien mang.
 */
export interface ActivateFrame {
    t: "activate";
    v: string;
    code: string;
    machine: MachineId;
    publicKeyPem: string;
    contract: string;
    omiVersion: string;
    nonce: string;
    proof: string;
}
/** Xeon da kich hoat: OMI luu ho so nay roi chao lai bang `hello`. Xeon dong day sau khung nay. */
export interface ActivatedFrame {
    t: "activated";
    v: string;
    tenant: TenantId;
    tenantName: string;
    /** keyId Xeon dat cho khoa cong khai vua nhan. */
    keyId: string;
    packId: string;
    /** Manh dang bat (ke ca loi) — de OMI hien dung menu; quyen that nam o `welcome.tools`. */
    modules: ModuleId[];
    expiresAt: string;
    /** Ghim TLS cua Xeon (chinh + du phong). Rong = Xeon noi bo khong TLS. */
    ghim: string[];
    /** Khoa CONG KHAI ky giay phep cua Xeon (PEM) — OMI luu de kiem chu ky khung `pins`. */
    khoaCongKy: string;
    /**
     * SO THU TU cua danh sach ghim (bo dem ben o so ma cua Xeon, tang moi khi danh sach DOI). OMI luu
     * lam `ghim_seq` va chi nhan `pins` co `seq` lon hon — khong dua vao dong ho nao (may shop hay Xeon
     * dat gio sai khong lam OMI tu choi ghim moi, va khung cu khong phat lai duoc).
     */
    ghimSeq: number;
    issuedAt: string;
}
/**
 * Xeon day CA danh sach ghim moi xuong OMI (A5): them du phong, hay bo khoa cu sau khi xoay.
 * OMI thay ca danh sach — nhung TU CHOI: danh sach khong chua ghim cua chinh ket noi dang dung
 * (mot lenh sai khong duoc khoa OMI ngoai); khung khong co chu ky bang khoa KY cua Xeon khi ho so
 * da co khoa do (ke co khoa TLS cu bi lo khong day duoc ghim); `issuedAt` khong moi hon lan da luu
 * (phat lai khung cu). Xeon gui khung nay ngay SAU `welcome` (OMI tat may luc xoay khoa van nhan
 * duoc) va khi nguoi quan tri `dayGhim`.
 */
export interface PinsFrame {
    t: "pins";
    v: string;
    ghim: string[];
    reason: string;
    /** So thu tu ben (xem `ActivatedFrame.ghimSeq`). Cung danh sach thi cung so. */
    seq: number;
    issuedAt: string;
    /** Chu ky (base64) cua `chuoiDeKyGhim({ ghim, reason, seq })` bang khoa ky cua Xeon. */
    signature?: string | undefined;
}
/** Xeon dong y. */
export interface WelcomeFrame {
    t: "welcome";
    v: string;
    /** Ma phien. Moi lan noi lai la mot ma moi — de `id` cua luot goi khong lan giua hai phien. */
    sessionId: string;
    /** Cong cu bot duoc phep goi voi giay phep hien tai. */
    tools: ToolName[];
    heartbeatSec: number;
    /** Tran kich thuoc mot khung, tinh bang byte. Vuot thi ben nhan dong duong. */
    maxFrameBytes: number;
    /** So luot goi duoc chay song song. */
    maxInflight: number;
    /** Su kien cuoi cung Xeon da nhan — OMI gui tiep tu day. */
    lastEventSeq: number;
}
/** Xeon tu choi: het han thue, ban qua cu, chu ky sai. Day la duong di cua `version_too_old`. */
export interface RejectFrame {
    t: "reject";
    v: string;
    error: LinkError;
    /** Bao lau nen thu lai, tinh bang giay. 0 = dung thu lai, phai co nguoi xu ly. */
    retryAfterSec: number;
}
/** Mot ben goi cong cu sang ben kia. */
export interface CallFrame<K extends ToolName = ToolName> {
    t: "call";
    v: string;
    id: string;
    /** Phien nao — chan viec `id` cua phien cu lan sang phien moi sau khi noi lai. */
    sessionId: string;
    tool: K;
    input: ToolInput<K>;
    /**
     * Ai goi. Bot goi thi dung `BOT_ACTOR`. Bat buoc, vi su kien sinh ra tu luot goi nay
     * can `actor` de ghi nhat ky — nhat ky khong biet ai lam thi vo dung.
     */
    actor: ActorId;
    /**
     * Hoi thoai nao. Bat buoc voi moi luot goi cua bot: day la cho cai luat
     * "moi luot goi Bo nao phai gan voi mot hoi thoai that" duoc cai vao khung,
     * de chan viec vat sua API.
     */
    conversationId?: ConversationId | undefined;
    /** Khoa chong trung. Goi lai cung khoa nay phai ra cung ket qua, khong tao them don nhap. */
    idempotencyKey?: string | undefined;
    /** Han cho, tinh bang mili giay. */
    timeoutMs: number;
}
/** Huy mot luot goi dang cho — tranh canh het han cho o mot ben ma ben kia van chay tiep. */
export interface CancelFrame {
    t: "cancel";
    v: string;
    id: string;
    sessionId: string;
    reason: string;
}
export type ResultFrame<K extends ToolName = ToolName> = {
    t: "result";
    v: string;
    id: string;
    sessionId: string;
    ok: true;
    data: ToolOutput<K>;
} | {
    t: "result";
    v: string;
    id: string;
    sessionId: string;
    ok: false;
    error: LinkError;
};
/** Bao mot viec vua xay ra. Di ca hai chieu. */
export interface EventFrame {
    t: "event";
    v: string;
    /** So thu tu tang dan trong mot phien — de ben nhan biet minh co bo sot khong. */
    seq: number;
    event: EventEnvelope;
}
/** Xac nhan da nhan su kien toi so thu tu nay. Rot mang thi noi lai tu day. */
export interface AckFrame {
    t: "ack";
    v: string;
    seq: number;
}
export interface PingFrame {
    t: "ping";
    v: string;
    at: string;
}
export interface PongFrame {
    t: "pong";
    v: string;
    at: string;
}
/** Nhung thu Xeon co the bao OMI lay lai. `license` = chao lai de `welcome` mang cong cu moi. */
export declare const REFRESH_WHAT: readonly ["license", "pack", "recipes"];
export type RefreshWhat = (typeof REFRESH_WHAT)[number];
/** Xeon bao OMI phai lay lai thu gi — vi du sau khi doi goi hoac va loi. */
export interface RefreshFrame {
    t: "refresh";
    v: string;
    what: RefreshWhat[];
    reason: string;
}
export type LinkFrame = ChallengeFrame | HelloFrame | ActivateFrame | ActivatedFrame | PinsFrame | WelcomeFrame | RejectFrame | CallFrame | CancelFrame | ResultFrame | EventFrame | AckFrame | PingFrame | PongFrame | RefreshFrame;
export interface ParseFailure {
    ok: false;
    reason: string;
}
export type ParseResult = {
    ok: true;
    frame: LinkFrame;
} | ParseFailure;
/**
 * Kiem DU truong bat buoc theo tung loai khung roi moi khang dinh kieu.
 *
 * Ban dau ham nay chi nhin truong `t` roi khai `v is LinkFrame` — nghia la
 * `{t:"call"}` rong tuech cung duoc TypeScript tin la mot luot goi day du, va
 * `frame.input` rac chui thang vao tang duoi. Day la ham kiem duy nhat o bien mang
 * nen no khong duoc phep noi doi.
 */
export declare function parseLinkFrame(value: unknown): ParseResult;
/** Chi hoi "co phai khung khong", khong khang dinh du truong. Dung khi da parse roi. */
export declare function isFrameKind(v: unknown, kind: LinkFrame["t"]): boolean;
/** `have` co dat toi thieu `min` khong. Sai dinh dang thi coi nhu KHONG dat. */
export declare function isCompatible(have: string, min: string): boolean;
export declare function makeCall<K extends ToolName>(args: {
    id: string;
    sessionId: string;
    tool: K;
    input: ToolInput<K>;
    actor: ActorId;
    conversationId?: ConversationId | undefined;
    idempotencyKey?: string | undefined;
    timeoutMs?: number | undefined;
}): CallFrame<K>;
//# sourceMappingURL=link.d.ts.map