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

import type { LinkError } from "./errors";
import type { EventEnvelope } from "./events";
import { BOT_ACTOR, type ActorId, type ConversationId, type MachineId, type TenantId } from "./ids";
import { isErrorCode } from "./errors";
import { isToolName } from "./tools";
import type { ToolInput, ToolName, ToolOutput } from "./tools";
import type { ModuleId } from "./modules";
import { laGhimHopLe } from "./chung-chi";

/** Doi so nay khi hinh dang khung thay doi kieu khong tuong thich nguoc. */
export const LINK_PROTOCOL_VERSION = "1";

/**
 * Tran so luot goi chay song song ma Xeon duoc phep dat trong khung `welcome`.
 *
 * Phai DUOI suc chua that cua lop du lieu ben OMI (ho ket noi 10 + hang cho 50 = 60),
 * khong thi luot goi thu 61 nhan mot ma loi cua thu vien may chu du lieu — mot chuoi
 * tho, khong phai `LinkError`, va Bo nao khong phan loai duoc.
 */
export const MAX_INFLIGHT = 40;

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

export type ResultFrame<K extends ToolName = ToolName> =
  | { t: "result"; v: string; id: string; sessionId: string; ok: true; data: ToolOutput<K> }
  | { t: "result"; v: string; id: string; sessionId: string; ok: false; error: LinkError };

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

export interface PingFrame { t: "ping"; v: string; at: string }
export interface PongFrame { t: "pong"; v: string; at: string }

/** Nhung thu Xeon co the bao OMI lay lai. `license` = chao lai de `welcome` mang cong cu moi. */
export const REFRESH_WHAT = ["license", "pack", "recipes"] as const;
export type RefreshWhat = (typeof REFRESH_WHAT)[number];

/** Xeon bao OMI phai lay lai thu gi — vi du sau khi doi goi hoac va loi. */
export interface RefreshFrame {
  t: "refresh";
  v: string;
  what: RefreshWhat[];
  reason: string;
}

export type LinkFrame =
  | ChallengeFrame
  | HelloFrame
  | ActivateFrame
  | ActivatedFrame
  | PinsFrame
  | WelcomeFrame
  | RejectFrame
  | CallFrame
  | CancelFrame
  | ResultFrame
  | EventFrame
  | AckFrame
  | PingFrame
  | PongFrame
  | RefreshFrame;

// ---------------------------------------------------------------------------
// Kiem khung nhan tu mang. Du lieu tu mang luon la du lieu la.
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
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

export interface ParseFailure {
  ok: false;
  reason: string;
}
export type ParseResult = { ok: true; frame: LinkFrame } | ParseFailure;

/**
 * Kiem DU truong bat buoc theo tung loai khung roi moi khang dinh kieu.
 *
 * Ban dau ham nay chi nhin truong `t` roi khai `v is LinkFrame` — nghia la
 * `{t:"call"}` rong tuech cung duoc TypeScript tin la mot luot goi day du, va
 * `frame.input` rac chui thang vao tang duoi. Day la ham kiem duy nhat o bien mang
 * nen no khong duoc phep noi doi.
 */
export function parseLinkFrame(value: unknown): ParseResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "Khung phai la mot doi tuong." };
  }
  const obj = value as Record<string, unknown>;
  const t = obj["t"];
  if (typeof t !== "string") return { ok: false, reason: "Thieu truong 't'." };

  const required = REQUIRED_FIELDS[t];
  if (required === undefined) return { ok: false, reason: `Loai khung la: "${t}".` };

  const missing = required.filter((f) => obj[f] === undefined);
  if (missing.length > 0) {
    return { ok: false, reason: `Khung "${t}" thieu truong: ${missing.join(", ")}.` };
  }
  if (obj["v"] !== LINK_PROTOCOL_VERSION) {
    return { ok: false, reason: `Khung "${t}" dung giao thuc "${String(obj["v"])}", ben nay dung "${LINK_PROTOCOL_VERSION}".` };
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
    } else {
      const e = obj["error"] as { code?: unknown } | undefined;
      if (e === null || typeof e !== "object" || !isErrorCode(e.code)) {
        return { ok: false, reason: "Khung result ok=false phai co 'error' voi ma loi hop le." };
      }
    }
  }
  // Khung `call`: ten cong cu phai co that, va `input` phai la mot doi tuong — `[]`, `42`,
  // `"rac"` deu tung qua duoc, va voi `[]` thi `stock.lookup` tra `rows: []` de bot
  // khang dinh HET HANG tren mot dau vao rac.
  if (t === "call") {
    if (!isToolName(obj["tool"])) {
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
    if (!Array.isArray(w) || w.length === 0 || !w.every((x) => (REFRESH_WHAT as readonly string[]).includes(x as string))) {
      return { ok: false, reason: `Khung refresh phai co 'what' la mang khong rong trong ${REFRESH_WHAT.join("/")}.` };
    }
  }
  // Khung `activate`: khoa CONG KHAI phai la PEM cong khai — mang "PRIVATE KEY" la OMI (hay mot
  // ban vá sai) vua gui khoa rieng len Xeon; chan o bien, khong de tang duoi "tien tay" luu.
  // Cac truong chuoi phai KHONG RONG: ma rong / proof rong qua duoc thi tang duoi kiem chu ky
  // tren chuoi rong, va loi doc ra kho hieu.
  if (t === "activate") {
    for (const f of ["code", "machine", "publicKeyPem", "contract", "omiVersion", "nonce", "proof"]) {
      if (typeof obj[f] !== "string" || obj[f] === "") return { ok: false, reason: `Khung activate: '${f}' phai la chuoi khong rong.` };
    }
    const pem = obj["publicKeyPem"] as string;
    if (/PRIVATE KEY/.test(pem)) return { ok: false, reason: "Khung activate mang KHOA RIENG (PRIVATE KEY) — khoa rieng khong duoc roi khoi may shop." };
    if (!/BEGIN PUBLIC KEY/.test(pem)) return { ok: false, reason: "Khung activate: 'publicKeyPem' phai la PEM PUBLIC KEY." };
  }
  // Danh sach ghim: moi ghim dung dang va KHONG TRUNG. `pins` phai KHONG RONG (rong = OMI
  // khong tin ai nua); `activated.ghim` duoc rong (Xeon noi bo khong TLS).
  if (t === "pins" || t === "activated") {
    const g = obj["ghim"];
    if (!Array.isArray(g) || !g.every((x) => laGhimHopLe(x)) || new Set(g).size !== g.length) {
      return { ok: false, reason: `Khung ${t}: 'ghim' phai la mang ghim sha256/<base64> hop le, khong trung.` };
    }
    if (t === "pins" && g.length === 0) return { ok: false, reason: "Khung pins: danh sach ghim rong." };
  }
  if (t === "pins") {
    if (typeof obj["issuedAt"] !== "string" || !Number.isFinite(Date.parse(obj["issuedAt"]))) return { ok: false, reason: "Khung pins: 'issuedAt' phai la moc ISO." };
    if (typeof obj["seq"] !== "number" || !Number.isSafeInteger(obj["seq"]) || obj["seq"] < 0) return { ok: false, reason: "Khung pins: 'seq' phai la so nguyen khong am." };
    if (typeof obj["reason"] !== "string") return { ok: false, reason: "Khung pins: 'reason' phai la chuoi." };
    if (obj["signature"] !== undefined && (typeof obj["signature"] !== "string" || obj["signature"] === "")) return { ok: false, reason: "Khung pins: 'signature' phai la chuoi khong rong." };
  }
  if (t === "activated") {
    const m = obj["modules"];
    if (!Array.isArray(m) || !m.every((x) => typeof x === "string")) return { ok: false, reason: "Khung activated: 'modules' phai la mang chuoi." };
    for (const f of ["tenant", "tenantName", "keyId", "packId", "expiresAt", "khoaCongKy"]) {
      if (typeof obj[f] !== "string" || obj[f] === "") return { ok: false, reason: `Khung activated: '${f}' phai la chuoi khong rong.` };
    }
    const ky = obj["khoaCongKy"] as string;
    if (/PRIVATE KEY/.test(ky) || !/BEGIN PUBLIC KEY/.test(ky)) return { ok: false, reason: "Khung activated: 'khoaCongKy' phai la PEM PUBLIC KEY." };
    if (!Number.isFinite(Date.parse(obj["issuedAt"] as string))) return { ok: false, reason: "Khung activated: 'issuedAt' phai la moc ISO." };
    if (typeof obj["ghimSeq"] !== "number" || !Number.isSafeInteger(obj["ghimSeq"]) || obj["ghimSeq"] < 0) return { ok: false, reason: "Khung activated: 'ghimSeq' phai la so nguyen khong am." };
  }
  // BOT PHAI GAN VOI MOT HOI THOAI. Cuong che ngay o bien mang, khong de tang duoi tu
  // xoay so: OMI coi ma hoi thoai la mot cai CONG (bot khong co no thi khong mo duoc
  // don nao), nen de truong nay tuy chon cho bot la mo lai dung con duong bot tu dat
  // ma hoi thoai, tu cap chia khoa cho cai ten no bia ra, roi doc ho so mua hang cua
  // nguoi la. Nguoi that thi khong bat buoc — ho lam viec tren kho cua chinh ho.
  if (t === "call" && obj["actor"] === BOT_ACTOR) {
    const hoi = obj["conversationId"];
    if (typeof hoi !== "string" || hoi === "") {
      return { ok: false, reason: "Luot goi cua bot phai co 'conversationId'." };
    }
  }
  return { ok: true, frame: value as LinkFrame };
}

/** Chi hoi "co phai khung khong", khong khang dinh du truong. Dung khi da parse roi. */
export function isFrameKind(v: unknown, kind: LinkFrame["t"]): boolean {
  return v !== null && typeof v === "object" && (v as { t?: unknown }).t === kind;
}

// ---------------------------------------------------------------------------
// So sanh phien ban — cai vao ma cai luat "tu choi ban qua cu"
// ---------------------------------------------------------------------------

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `have` co dat toi thieu `min` khong. Sai dinh dang thi coi nhu KHONG dat. */
export function isCompatible(have: string, min: string): boolean {
  const a = parseSemver(have);
  const b = parseSemver(min);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export function makeCall<K extends ToolName>(args: {
  id: string;
  sessionId: string;
  tool: K;
  input: ToolInput<K>;
  actor: ActorId;
  conversationId?: ConversationId | undefined;
  idempotencyKey?: string | undefined;
  timeoutMs?: number | undefined;
}): CallFrame<K> {
  return {
    t: "call",
    v: LINK_PROTOCOL_VERSION,
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
