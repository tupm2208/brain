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
   * Đ7 (21/09/2026): the ADDRESSES of those images (https, at most four). The brain reads them for
   * this turn — what the picture shows, and which catalogue code it matches — and keeps none of
   * them. An older landing sends only `soAnh`; the bot then answers as before, picture unseen.
   */
  anh?: string[] | undefined;
  /**
   * 24/09/2026 (tái tạo tầng 1 Desk): mã tin mà khách BẤM "Trả lời" (Meta `reply_to.mid`). Vắng =
   * tin thường, hoặc landing cũ chưa gửi.
   */
  traLoiTin?: string | undefined;
  /**
   * Đ7: how the landing answers this conversation — `auto` (the bot sends), `suggest` (drafts for a
   * person only), `off`. Anything but `auto` is never sent by `/tin-den`. Absent = auto (older landings).
   */
  cheDo?: string | undefined;
  /**
   * 05/10/2026 (phiếu Desk "nhường xong phải tiếp quản"): the landing pushes the customer's last message
   * AGAIN. `het-nhuong` = the yield window passed and the customer is still waiting (the bot answers unless
   * a person is still active); `nguoi-bam` = a person pressed "bot trả lời tiếp" (no yield applies).
   */
  tiepQuan?: "het-nhuong" | "nguoi-bam" | undefined;
}

/** Result of handling an inbound message, returned to the landing. */
export type InboundResult =
  | { daTraLoi: true; hanhDong: "send" | "ask_back" | "agent"; traLoi: string }
  | { daTraLoi: false; viSao: "chuyen_nguoi_that"; traLoi: string }
  /**
   * A human answered (or is typing in) this conversation within the yield window: the bot stays out of it.
   * `nhuongDen` (05/10/2026) = when the window ends; the brain then asks the landing to hand the turn back.
   */
  | { daTraLoi: false; viSao: "nguoi_dang_truc"; nhuongDen?: string | undefined }
  /** The customer sent another message before this one was answered: the later turn answers the whole burst. */
  | { daTraLoi: false; viSao: "gop_vao_tin_sau" }
  /** 05/10/2026: the landing says this customer message was already answered (another turn got there first) — nothing sent. */
  | { daTraLoi: false; viSao: "da_tra_loi_tin_nay" }
  | { daTraLoi: false; viSao: "khong_phuc_vu_shop" }
  /** 05/10/2026: the customer said "ok" again after the bot's short acknowledgement of their order — nothing to add. */
  | { daTraLoi: false; viSao: "khong_can_tra_loi" }
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
  /** The platform's own legal pages (02/10/2026): one copy for the Meta app, every shop links here. */
  policyPrivacy: "/chinh-sach",
  policyTerms: "/chinh-sach/dieu-khoan",
  policyDeletion: "/chinh-sach/xoa-du-lieu",
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
  /** The "AI tư vấn" box on the shop's own website: the same brain, for a visitor nobody is chatting with yet. */
  aiWebAdvisor: "/ai/tu-van-web",
  aiAnalyze: "/ai/phan-tich-lo",
  aiKnowledge: "/ai/de-xuat-kien-thuc",
  aiImage: "/ai/doc-anh",
  aiTokens: "/ai/token",
  /**
   * A model call the LANDING paid for itself (the partner portal reads a box label with the
   * operator's key, never through Xeon), reported here so the shop's token book still shows it.
   * Ported from the running site 15/09/2026, where the same lesson cost a whole column of the
   * Token AI screen: a call nobody writes down is a call nobody can price.
   */
  aiUsageReport: "/ai/ghi-token",
  aiPricing: "/ai/bang-gia",
  /**
   * 24/09/2026 — the Chatbot tab of OMI (tier 3 screen): the industry's suggested profile and its
   * blocks, and a preview of the system message the agent would be given for this shop right now.
   */
  aiProfileTemplate: "/ai/mau-ho-so",
  aiPromptPreview: "/ai/loi-dan-xem-thu",
  /** 02/10/2026: the shop's document (frequent questions, own procedure) split into points for its profile. */
  aiShopDoc: "/ai/nap-tai-lieu",
  /** Đ8 — the Content screen: critique (three judges), optimise against the critique, weekly trend research. */
  contentReview: "/noi-dung/phan-bien",
  contentOptimize: "/noi-dung/toi-uu",
  contentTrends: "/noi-dung/xu-huong",
  /**
   * 22/09/2026 — the shop tells the workshop HOW IT WANTS CONTENT MADE in its own words, and this
   * turns those words into the form the landing stores. It only proposes: the landing writes
   * nothing until a person approves what came back.
   */
  contentProfile: "/noi-dung/hieu-y",
  /**
   * 02/10/2026 — the shop's PRICE TABLES (OMI → Kho → Cách tính giá): the ready-made tables to
   * start from (the platform's, then the shop's industry's), and the shop's own words turned into a
   * table. Xeon prices nothing and stores nothing: the table lives on the landing, which saves only
   * when a person presses "Lưu bảng giá".
   */
  priceTemplates: "/kho/mau-bang-gia",
  priceRulesFromWords: "/kho/bang-gia/hieu-y",
  /** 02/10/2026 — the shop's INDUSTRY default wording for its website (`nganh/<id>/mac-dinh-web.json`). */
  industryWebDefaults: "/nganh/mac-dinh-web",
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
  /**
   * 02/10/2026 — the developer app's "Data deletion callback URL" and "Deauthorize callback URL"
   * (Meta POSTs a `signed_request`), and the public status page the deletion answer links to.
   */
  metaDataDeletion: "/meta/xoa-du-lieu",
  metaDataDeletionStatus: "/meta/xoa-du-lieu/trang-thai",
  metaDeauthorize: "/meta/go-app",
  /** Admin log viewer: build log + stderr tail (authenticated, same session as /quan-tri). */
  adminLog: "/quan-tri/api/nhat-ky",
  /** Public activity log: every webhook, message, outbound call — ring buffer in memory. */
  activityLog: "/nhat-ky"
} as const;
