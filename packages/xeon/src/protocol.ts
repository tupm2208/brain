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
  /**
   * Đ7: how the landing answers this conversation — `auto` (the bot sends), `suggest` (drafts for a
   * person only), `off`. Anything but `auto` is never sent by `/tin-den`. Absent = auto (older landings).
   */
  cheDo?: string | undefined;
}

/** Result of handling an inbound message, returned to the landing. */
export type InboundResult =
  | { daTraLoi: true; hanhDong: "send" | "ask_back" | "agent"; traLoi: string }
  | { daTraLoi: false; viSao: "chuyen_nguoi_that"; traLoi: string }
  /** A human answered this conversation in the last few minutes: the bot stays out of it. */
  | { daTraLoi: false; viSao: "nguoi_dang_truc" }
  /** The customer sent another message before this one was answered: the later turn answers the whole burst. */
  | { daTraLoi: false; viSao: "gop_vao_tin_sau" }
  | { daTraLoi: false; viSao: "khong_phuc_vu_shop" }
  /** Đ7: the conversation (or its page, or the shop) is in suggest-only or off mode. */
  | { daTraLoi: false; viSao: "che_do_khong_tu_gui" };

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
  /** Đ7 — the AI desk: draft (never sends), sandbox, batch analysis, knowledge proposal, image reading, token ledger, price table. */
  aiDraft: "/ai/goi-y",
  aiSandbox: "/ai/hop-cat",
  aiAnalyze: "/ai/phan-tich-lo",
  aiKnowledge: "/ai/de-xuat-kien-thuc",
  aiImage: "/ai/doc-anh",
  aiTokens: "/ai/token",
  aiPricing: "/ai/bang-gia",
  /** Đ8 — the Content screen: critique (three judges), optimise against the critique, weekly trend research. */
  contentReview: "/noi-dung/phan-bien",
  contentOptimize: "/noi-dung/toi-uu",
  contentTrends: "/noi-dung/xu-huong",
  /** Đ9 — industry knowledge (sample profiles, research queue, line knowledge) and the Video Studio ticket. */
  knowledgePrefix: "/kien-thuc/",
  videoTicket: "/video/ve",
  admin: "/quan-tri",
  machines: "/may",
  /** Meta's webhook for every merchant's Fanpages (one developer app, decided 15/09/2026). */
  metaWebhook: "/meta/webhook",
  /** A landing lists / connects its Fanpages. */
  metaPages: "/meta/trang",
  /** A landing stops routing some of its Fanpages (Đ6). */
  metaPagesDisconnect: "/meta/trang/ngat",
  /** Facebook Login through the developer app (Đ6): start, Meta's redirect back, the landing collects the pages. */
  metaLogin: "/meta/dang-nhap",
  metaLoginDone: "/meta/dang-nhap/xong",
  metaLoginResult: "/meta/dang-nhap/ket-qua",
  /** Admin log viewer: build log + stderr tail (authenticated, same session as /quan-tri). */
  adminLog: "/quan-tri/api/nhat-ky",
  /** Public activity log: every webhook, message, outbound call — ring buffer in memory. */
  activityLog: "/nhat-ky"
} as const;
