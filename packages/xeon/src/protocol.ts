/**
 * @file Wire protocol between Xeon and the outside: the landing (merchant server) and the console.
 *
 * Field names are Vietnamese because they are the EXTERNAL CONTRACT already implemented by the
 * landing and the console; renaming them would break every deployed site. Everything internal to
 * Xeon uses English names and converts at the edge, in the controllers.
 */

/** Body of `POST /tin-den`: a customer message forwarded by the landing. */
export interface InboundMessageBody {
  /** Only honoured with the legacy shared token; otherwise derived from the inbox token. */
  tenant?: string | undefined;
  /** Channel: "facebook" (default), "zalo", "fb-ca-nhan", ... */
  kenh?: string | undefined;
  /** Customer identifier on that channel. */
  nguoi: string;
  /** Message text. */
  chu: string;
  /** Message id on the channel, for de-duplication on the landing. */
  maTin?: string | undefined;
  /** ISO timestamp of the message. */
  luc?: string | undefined;
  /** Conversation id; defaults to `${kenh}:${nguoi}`. */
  maHoiThoai?: string | undefined;
  /** Number of images attached. */
  soAnh?: number | undefined;
}

/** Result of handling an inbound message, returned to the landing. */
export type InboundResult =
  | { daTraLoi: true; hanhDong: "send" | "ask_back"; traLoi: string }
  | { daTraLoi: false; viSao: "chuyen_nguoi_that"; traLoi: string }
  | { daTraLoi: false; viSao: "khong_phuc_vu_shop" };

/** Body of `POST /license/kiem`. */
export interface MachineCheckBody {
  key?: unknown;
  maMay?: unknown;
  tenMay?: unknown;
}

/** Body of `POST /license/landing-dang-ky`. */
export interface LandingRegistrationBody {
  key?: unknown;
  diaChi?: unknown;
}

/**
 * One page a landing connects on `POST /meta/trang`. The token only PROVES the landing holds the
 * page: Xeon asks Meta whose token it is, and never keeps it.
 */
export interface PageClaimBody {
  trang?: unknown;
  /** Also subscribe the page to the developer app (`subscribed_apps`), so Meta starts delivering. */
  dangKyNhanTin?: unknown;
}

/** What `POST /meta/trang` says about each page. */
export type PageClaimOutcome =
  | { ma: string; ok: true; ten: string; daDangKyNhanTin: boolean; loiDangKy?: string }
  | { ma: string; ok: false; viSao: "thieu_ma_hoac_token" | "token_khong_dung_trang" | "trang_thuoc_shop_khac" | "khong_hoi_duoc_meta" | "khong_co_key"; chiTiet?: string };

/** Header every state-changing request of the two web pages must carry (CSRF protection). */
export const CSRF_HEADER = "x-yeu-cau";
export const CSRF_HEADER_VALUE = "xeon";

/** Well-known paths. */
export const PATHS = {
  health: "/health",
  licensePrefix: "/license/",
  licenseCheck: "/license/kiem",
  licenseDuty: "/license/truc",
  licenseLeave: "/license/roi",
  licenseLandingRegister: "/license/landing-dang-ky",
  licensePublicKey: "/license/khoa-cong",
  inbound: "/tin-den",
  write: "/viet-bai",
  admin: "/quan-tri",
  machines: "/may",
  /** Meta's webhook for every merchant's Fanpages (one developer app, decided 15/09/2026). */
  metaWebhook: "/meta/webhook",
  /** A landing lists / connects its Fanpages. */
  metaPages: "/meta/trang"
} as const;
