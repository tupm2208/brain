/**
 * @file THE SHOP PROFILE — tier 3 of the brain's three tiers (decided 24/09/2026).
 *
 * Tier 1 is the platform's own conduct (code + `loi-chung/`), tier 2 is an industry's know-how
 * (`nganh/<id>/`), and tier 3 is what is true of ONE shop only: how it addresses customers, what it
 * sells, how it sells (deposit, lead time, COD, bargaining), when a person must take over. Two
 * shops in the same industry run the same brain and still speak their own policy because of this.
 *
 * The profile LIVES ON THE SHOP'S LANDING and reaches Xeon through the `shop.profile` tool, once per
 * turn, never stored there. Field names are wire: OMI's Chatbot tab writes them, the landing keeps
 * them, the brain reads them.
 *
 * THREE STATES PER FIELD. A field is "khai" (the shop set it), "mac-dinh" (the shop pressed "use
 * the industry's suggestion", and the value is a copy of it), or "chua" (nothing there). The brain
 * treats "chua" as "do not speak of it — hand over": a shop that never said its deposit rate must
 * not hear the bot quote another shop's. `nguon` records the first two; an absent key with an empty
 * value is the third.
 */

/** Yes / no / not answered. An empty string is "chua khai", never a default. */
export type ProfileChoice = "co" | "khong" | "";

export interface ShopProfileSelling {
  coHangOrder: ProfileChoice;
  /** Free text: "3–7 ngày hàng về tới kho rồi mới gửi đi". */
  thoiGianOrder: string;
  /** Minimum deposit for made-to-order goods, in percent. `null` = chua khai. */
  tiLeCoc: number | null;
  codHangSan: ProfileChoice;
  doiTraHangOrder: string;
  doiSizeDonDaDat: string;
  macCa: { kieu: "khong-giam" | "giam-toi-da" | "qua-tang" | ""; chiTiet: string };
  /**
   * What the bot does when the customer wants to buy (Dũng, 24/09/2026): `phieu` = the system sends
   * the order form (pre-filled model + size; the form shows the deposit QR once filled), `goi-nguoi`
   * = a person is called in to close. The shop picks one.
   */
  khiChot: "phieu" | "goi-nguoi" | "";
  /**
   * The sentence for a model or brand the shop does not have (24/09/2026, Dũng: "Hiện nhà em không
   * còn mẫu đó / hãng đó"). Both the agent and the rule engine say exactly this; `{hang}` / `{mau}`
   * are filled when known.
   */
  cauKhongCo: string;
}

export interface ShopProfileHandoff {
  /** Topics the shop wants a person on, beyond the platform's own (complaints, money). */
  chuDe: string[];
  /** How forward the bot is about closing: never / only on a buying signal / after quoting. */
  mucChot: "khong" | "dau-hieu" | "sau-bao-gia" | "";
  gioTruc: string;
}

/**
 * One industry block the shop touched. `nganh` = use the industry's text (the default for every
 * block), `tat` = drop the block, `rieng` = the shop's own text instead. `phienBanNganh` is the
 * industry text's fingerprint at the time the shop edited, so the screen can say "the industry's
 * version changed since".
 */
export interface ShopProfileBlock {
  cheDo: "nganh" | "tat" | "rieng";
  vanBan: string;
  phienBanNganh: string;
}

export interface ShopProfile {
  /** Bumped on every save; the turn dossier records which version answered. */
  phienBan: number;
  capNhatLuc: string;
  xungHo: { khach: string; shop: string };
  giong: { emoji: ProfileChoice; doDai: "ngan" | "vua" | ""; ghiChu: string };
  cauCam: string[];
  hangCoBan: string[];
  hangKhongBan: string[];
  monTheThao: string[];
  banHang: ShopProfileSelling;
  chuyenNguoi: ShopProfileHandoff;
  /**
   * 24/09/2026 (đánh giá đợt 2): hai điều khách hay hỏi mà bot từng tự bịa — hàng cam kết thế nào
   * ("chính hãng?") và có cửa hàng / giờ mở cửa không. Chưa khai = bot không khẳng định, gọi người.
   */
  camKetHang: string;
  cuaHang: string;
  /**
   * 25/09/2026: câu chào "em là trợ lý AI…" landing gửi MỘT LẦN cho mỗi khách, trước câu trả lời
   * đầu tiên. Rỗng = landing dùng câu mặc định của nó. Không vào lời dặn agent (landing chèn, bot không tự chào).
   */
  cauChaoAi: string;
  /**
   * 25/09/2026: tên người phụ trách ("anh Dũng", "chị Lan") để bot nói "để em báo anh Dũng" thay tên
   * cứng — điền vào chỗ trống `{tenNguoiPhuTrach}` của cổng soát và kịch bản. Rỗng = "người phụ trách".
   */
  tenNguoiPhuTrach: string;
  /** Field path → who set it. Absent = chua khai. */
  nguon: Record<string, "shop" | "nganh">;
  khoiNganh: Record<string, ShopProfileBlock>;
}

/** An empty profile: every field "chua khai". */
export function emptyShopProfile(): ShopProfile {
  return {
    phienBan: 0,
    capNhatLuc: "",
    xungHo: { khach: "", shop: "" },
    giong: { emoji: "", doDai: "", ghiChu: "" },
    cauCam: [],
    hangCoBan: [],
    hangKhongBan: [],
    monTheThao: [],
    banHang: { coHangOrder: "", thoiGianOrder: "", tiLeCoc: null, codHangSan: "", doiTraHangOrder: "", doiSizeDonDaDat: "", macCa: { kieu: "", chiTiet: "" }, khiChot: "", cauKhongCo: "" },
    chuyenNguoi: { chuDe: [], mucChot: "", gioTruc: "" },
    camKetHang: "",
    cuaHang: "",
    cauChaoAi: "",
    tenNguoiPhuTrach: "",
    nguon: {},
    khoiNganh: {}
  };
}

/**
 * The profile field paths a screen or a template may address, with the label a person sees. Kept
 * here so OMI, the landing and the industry template all name the same fields.
 */
export const SHOP_PROFILE_FIELDS: readonly { path: string; nhan: string }[] = [
  { path: "xungHo.khach", nhan: "Gọi khách là" },
  { path: "xungHo.shop", nhan: "Shop xưng là" },
  { path: "tenNguoiPhuTrach", nhan: "Tên người phụ trách" },
  { path: "giong.emoji", nhan: "Dùng biểu tượng cảm xúc" },
  { path: "giong.doDai", nhan: "Độ dài tin nhắn" },
  { path: "giong.ghiChu", nhan: "Giọng nói" },
  { path: "cauCam", nhan: "Câu cấm riêng của shop" },
  { path: "hangCoBan", nhan: "Hãng có bán" },
  { path: "hangKhongBan", nhan: "Hãng không bán" },
  { path: "monTheThao", nhan: "Môn / nhóm hàng có bán" },
  { path: "banHang.coHangOrder", nhan: "Có hàng order" },
  { path: "banHang.thoiGianOrder", nhan: "Thời gian hàng order" },
  { path: "banHang.tiLeCoc", nhan: "Cọc tối thiểu hàng order (%)" },
  { path: "banHang.codHangSan", nhan: "COD hàng sẵn" },
  { path: "banHang.doiTraHangOrder", nhan: "Đổi trả hàng order" },
  { path: "banHang.doiSizeDonDaDat", nhan: "Đổi size đơn đã đặt" },
  { path: "banHang.macCa", nhan: "Mặc cả" },
  { path: "banHang.khiChot", nhan: "Khách chốt thì" },
  { path: "banHang.cauKhongCo", nhan: "Câu khi không có mẫu / hãng" },
  { path: "chuyenNguoi.chuDe", nhan: "Chủ đề cần người thật" },
  { path: "chuyenNguoi.mucChot", nhan: "Mức chủ động mời chốt" },
  { path: "chuyenNguoi.gioTruc", nhan: "Giờ có người trực" },
  { path: "camKetHang", nhan: "Cam kết về hàng (chính hãng…)" },
  { path: "cuaHang", nhan: "Cửa hàng, giờ mở cửa" },
  { path: "cauChaoAi", nhan: "Câu chào trợ lý AI (gửi một lần cho mỗi khách)" }
];

/** Reads a field by path ("banHang.tiLeCoc"). */
export function profileField(profile: ShopProfile, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), profile);
}

/** Whether a field holds a value the bot may use: set by the shop, or accepted as the industry default. */
export function profileFieldSet(profile: ShopProfile, path: string): boolean {
  const v = profileField(profile, path);
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some((x) => x !== "" && x !== null);
  return true;
}
