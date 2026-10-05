/**
 * @file THE SHOP PROFILE — tier 3 of the brain's three tiers (decided 24/09/2026).
 *
 * Tier 1 is the platform's own conduct (code + `loi-chung/`), tier 2 is an industry's know-how
 * (`nganh/<id>/`), and tier 3 is what is true of ONE shop only: how it addresses customers, how it sells (deposit, lead
 * time, COD, bargaining), when a person must take over, and its own questions / procedures. WHAT it
 * sells is not here: that is the shop's stock on its landing (02/10/2026, Dũng — "không cần khai"). Two
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
   * 05/10/2026: an order still open this many days after it was placed is an OLD order (the person on
   * duty forgot to close it). `null` = chua khai: an open order always counts as running — the bot is
   * careful not to sell the ordered item again, rather than guessing the order is over. The LANDING
   * applies it (order stage); the brain only reads the stage.
   */
  hanDonTreoNgay: number | null;
}

export interface ShopProfileHandoff {
  /** Topics the shop wants a person on, beyond the platform's own (complaints, money). */
  chuDe: string[];
  /** How forward the bot is about closing: never / only on a buying signal / after quoting. */
  mucChot: "khong" | "dau-hieu" | "sau-bao-gia" | "";
  gioTruc: string;
  /**
   * 05/10/2026 (phiếu Desk "nhường khi người thật đang trực"): minutes the bot keeps out of a conversation
   * after a person on duty wrote or typed in it; then, if the customer is still the last to speak, the
   * bot answers again. `null` = chua khai: the platform's default (`DEFAULT_HUMAN_YIELD_MINUTES`).
   */
  phutNhuong: number | null;
}

/** The yield window when the shop has not set `chuyenNguoi.phutNhuong` (Desk: 5 minutes). */
export const DEFAULT_HUMAN_YIELD_MINUTES = 5;
/** The longest yield window a shop may set: past it a waiting customer is a lost one. */
export const MAX_HUMAN_YIELD_MINUTES = 60;

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

/** A question customers often ask that no field above holds, and the shop's own answer (02/10/2026). */
export interface ShopProfileQuestion { cauHoi: string; traLoi: string }
/**
 * One procedure of the shop's own ("khi khách hỏi size thì hỏi chiều dài chân"). It comes AFTER the
 * platform's rules and the industry's blocks: it may add, it can never override. `khoi` = the industry
 * block it sits next to, when the analysis found one ("" otherwise).
 */
export interface ShopProfileProcedure { quyTac: string; khoi: string }

export interface ShopProfile {
  /** Bumped on every save; the turn dossier records which version answered. */
  phienBan: number;
  capNhatLuc: string;
  xungHo: { khach: string; shop: string };
  giong: { emoji: ProfileChoice; doDai: "ngan" | "vua" | ""; ghiChu: string };
  cauCam: string[];
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
  /** Câu hỏi riêng của shop (02/10/2026): khách hỏi đúng ý thì bot trả theo đúng nội dung này. */
  cauHoiRieng: ShopProfileQuestion[];
  /** Quy trình riêng của shop (02/10/2026): sau luật chung và khối ngành, chỉ thêm, không ghi đè. */
  quyTrinhRieng: ShopProfileProcedure[];
  /** Field path → who set it: the shop typed it, accepted the industry's suggestion, or the AI filled it from a document the shop loaded. Absent = chua khai. */
  nguon: Record<string, ProfileSource>;
  khoiNganh: Record<string, ShopProfileBlock>;
}

/** Who set a field (02/10/2026: "ai" = filled by the AI from a document the shop loaded). */
export type ProfileSource = "shop" | "nganh" | "ai";

/** An empty profile: every field "chua khai". */
export function emptyShopProfile(): ShopProfile {
  return {
    phienBan: 0,
    capNhatLuc: "",
    xungHo: { khach: "", shop: "" },
    giong: { emoji: "", doDai: "", ghiChu: "" },
    cauCam: [],
    banHang: { coHangOrder: "", thoiGianOrder: "", tiLeCoc: null, codHangSan: "", doiTraHangOrder: "", doiSizeDonDaDat: "", macCa: { kieu: "", chiTiet: "" }, khiChot: "", hanDonTreoNgay: null },
    chuyenNguoi: { chuDe: [], mucChot: "", gioTruc: "", phutNhuong: null },
    camKetHang: "",
    cuaHang: "",
    cauChaoAi: "",
    tenNguoiPhuTrach: "",
    cauHoiRieng: [],
    quyTrinhRieng: [],
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
  { path: "banHang.coHangOrder", nhan: "Có hàng order" },
  { path: "banHang.thoiGianOrder", nhan: "Thời gian hàng order" },
  { path: "banHang.tiLeCoc", nhan: "Cọc tối thiểu hàng order (%)" },
  { path: "banHang.codHangSan", nhan: "COD hàng sẵn" },
  { path: "banHang.doiTraHangOrder", nhan: "Đổi trả hàng order" },
  { path: "banHang.doiSizeDonDaDat", nhan: "Đổi size đơn đã đặt" },
  { path: "banHang.macCa", nhan: "Mặc cả" },
  { path: "banHang.khiChot", nhan: "Khách chốt thì" },
  { path: "banHang.hanDonTreoNgay", nhan: "Đơn chưa đóng quá bao nhiêu ngày thì coi là đơn cũ" },
  { path: "chuyenNguoi.chuDe", nhan: "Chủ đề cần người thật" },
  { path: "chuyenNguoi.mucChot", nhan: "Mức chủ động mời chốt" },
  { path: "chuyenNguoi.gioTruc", nhan: "Giờ có người trực" },
  { path: "chuyenNguoi.phutNhuong", nhan: "Người trực vừa nhắn thì bot chờ bao nhiêu phút" },
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

// ------------------------------------------------------------------ reading a profile off the wire

const asText = (v: unknown, max: number): string => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");
const asList = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v : []).map((x) => asText(x, max)).filter(Boolean).slice(0, n);
const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Only a listed value counts; anything else — "undefined", "Có", a number — is "chua khai". */
const asChoice = <T extends string>(v: unknown, allowed: readonly T[]): T | "" => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : "");

/**
 * The profile as a landing SENT it, made safe (30/09/2026). The brain talks to landings of every
 * build and every vendor; one of them wrote the text "undefined" into unanswered choices, and the
 * bot read "undefined" as "khong": "the shop sells no made-to-order goods, no COD". So nothing from
 * the wire is trusted as-is: a choice outside its list, a wrong type or a missing key is "chua
 * khai" — which the brain treats as "do not speak of it", never as "no".
 */
export function readShopProfile(raw: unknown): ShopProfile {
  const o = asRecord(raw);
  const xungHo = asRecord(o["xungHo"]);
  const giong = asRecord(o["giong"]);
  const banHang = asRecord(o["banHang"]);
  const macCa = asRecord(banHang["macCa"]);
  const chuyenNguoi = asRecord(o["chuyenNguoi"]);
  const coc = banHang["tiLeCoc"];
  const han = banHang["hanDonTreoNgay"];
  const nhuong = chuyenNguoi["phutNhuong"];
  const nhuongNumber = typeof nhuong === "number" ? nhuong : typeof nhuong === "string" && nhuong.trim() !== "" ? Number(nhuong) : NaN;
  const hanNumber = typeof han === "number" ? han : typeof han === "string" && han.trim() !== "" ? Number(han) : NaN;
  const cocNumber = typeof coc === "number" ? coc : typeof coc === "string" && coc.trim() !== "" ? Number(coc) : NaN;
  const nguon: ShopProfile["nguon"] = {};
  for (const [k, v] of Object.entries(asRecord(o["nguon"]))) if (v === "shop" || v === "nganh" || v === "ai") nguon[k.slice(0, 60)] = v;
  const khoiNganh: ShopProfile["khoiNganh"] = {};
  for (const [id, v] of Object.entries(asRecord(o["khoiNganh"])).slice(0, 60)) {
    const b = asRecord(v);
    const cheDo = asChoice(b["cheDo"], ["nganh", "tat", "rieng"] as const);
    khoiNganh[id.slice(0, 40)] = { cheDo: cheDo === "" ? "nganh" : cheDo, vanBan: asText(b["vanBan"], 6000), phienBanNganh: asText(b["phienBanNganh"], 16) };
  }
  return {
    phienBan: Math.max(0, Math.trunc(Number(o["phienBan"]) || 0)),
    capNhatLuc: asText(o["capNhatLuc"], 40),
    xungHo: { khach: asText(xungHo["khach"], 20), shop: asText(xungHo["shop"], 20) },
    giong: { emoji: asChoice(giong["emoji"], ["co", "khong"] as const), doDai: asChoice(giong["doDai"], ["ngan", "vua"] as const), ghiChu: asText(giong["ghiChu"], 600) },
    cauCam: asList(o["cauCam"], 40, 120),
    banHang: {
      coHangOrder: asChoice(banHang["coHangOrder"], ["co", "khong"] as const),
      thoiGianOrder: asText(banHang["thoiGianOrder"], 200),
      tiLeCoc: Number.isFinite(cocNumber) && cocNumber >= 0 && cocNumber <= 100 ? Math.round(cocNumber) : null,
      codHangSan: asChoice(banHang["codHangSan"], ["co", "khong"] as const),
      doiTraHangOrder: asText(banHang["doiTraHangOrder"], 600),
      doiSizeDonDaDat: asText(banHang["doiSizeDonDaDat"], 600),
      macCa: { kieu: asChoice(macCa["kieu"], ["khong-giam", "giam-toi-da", "qua-tang"] as const), chiTiet: asText(macCa["chiTiet"], 400) },
      // "link-web" was the first name of "phieu" (24/09/2026); an old landing may still send it.
      khiChot: banHang["khiChot"] === "link-web" ? "phieu" : asChoice(banHang["khiChot"], ["phieu", "goi-nguoi"] as const),
      hanDonTreoNgay: Number.isFinite(hanNumber) && hanNumber >= 1 && hanNumber <= 365 ? Math.round(hanNumber) : null
    },
    chuyenNguoi: {
      chuDe: asList(chuyenNguoi["chuDe"], 40, 80), mucChot: asChoice(chuyenNguoi["mucChot"], ["khong", "dau-hieu", "sau-bao-gia"] as const), gioTruc: asText(chuyenNguoi["gioTruc"], 80),
      phutNhuong: Number.isFinite(nhuongNumber) && nhuongNumber >= 1 && nhuongNumber <= MAX_HUMAN_YIELD_MINUTES ? Math.round(nhuongNumber) : null
    },
    camKetHang: asText(o["camKetHang"], 300),
    cuaHang: asText(o["cuaHang"], 300),
    cauChaoAi: asText(o["cauChaoAi"], 500),
    tenNguoiPhuTrach: asText(o["tenNguoiPhuTrach"], 60),
    // Old landings still send hangCoBan / hangKhongBan / monTheThao / banHang.cauKhongCo: ignored on purpose.
    cauHoiRieng: (Array.isArray(o["cauHoiRieng"]) ? o["cauHoiRieng"] : []).map(asRecord)
      .map((x) => ({ cauHoi: asText(x["cauHoi"], 300), traLoi: asText(x["traLoi"], 1000) })).filter((x) => x.cauHoi !== "" && x.traLoi !== "").slice(0, 80),
    quyTrinhRieng: (Array.isArray(o["quyTrinhRieng"]) ? o["quyTrinhRieng"] : []).map(asRecord)
      .map((x) => ({ quyTac: asText(x["quyTac"], 600), khoi: asText(x["khoi"], 40) })).filter((x) => x.quyTac !== "").slice(0, 60),
    nguon,
    khoiNganh
  };
}
