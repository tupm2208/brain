// PHEU DANG KY BANG LUAT — tu cau tra loi kin ra bo manh, giai thich duoc tung dong.
//
// Anh chot 09/09 (Phan 10): "Cau hoi kin quyet dinh module bang luat; AI chi duoc DE NGHI
// them". Cung mot bo cau tra loi LUON ra cung mot bo manh, va moi manh co mot cau "vi sao"
// de khach doc duoc. AI doc o mo ta tu do va de nghi them/bot — de nghi nam o danh sach RIENG,
// khong bao gio tu chui vao bo manh; khach tick thi moi vao (`chotManh`).
//
// Ham nay CHI nhan cau tra loi kin (`kiemCauTraLoi` tu choi moi truong la, ke ca o van ban
// tu do): luat khong doc van ban, nen khong co duong nao de mot cau ke chuyen doi duoc ket qua.
// Chuoi hien cho khach (cau hoi, vi sao, luu y) viet co dau — AGENTS.md.

import { CORE_MODULE_IDS, MODULES, MODULE_IDS, isModuleId, type ModuleId } from "./modules";

export const BAN_GI = ["co-san", "dat-ve", "ca-hai"] as const;
export const GIAO_HANG = ["tu-gui", "don-vi-van-chuyen", "khach-tu-lay"] as const;
export const THU_TIEN = ["truoc", "cod", "ca-hai"] as const;
export const KENH = ["facebook", "zalo", "tiktok", "san", "web"] as const;
export const NOI_DUNG = ["khong", "tu-lam", "thue"] as const;

export interface CauTraLoiPheu {
  banGi: (typeof BAN_GI)[number];
  khoRieng: boolean;
  muaHo: boolean;
  congTacVien: boolean;
  giaoHang: (typeof GIAO_HANG)[number];
  thuTien: (typeof THU_TIEN)[number];
  kenh: (typeof KENH)[number][];
  noiDung: (typeof NOI_DUNG)[number];
  video: boolean;
  botTraLoi: boolean;
  baoCaoNhuCau: boolean;
}

export interface CauHoiPheu {
  id: keyof CauTraLoiPheu;
  /** Cau hoi hien cho khach — co dau. */
  hoi: string;
  kieu: "chon-mot" | "co-khong" | "chon-nhieu";
  luaChon?: readonly string[] | undefined;
}

/** Tam den muoi hai cau hoi kin (Phan 10). Them cau = them truong o `CauTraLoiPheu` + luat. */
export const CAU_HOI_PHEU: readonly CauHoiPheu[] = [
  { id: "banGi", hoi: "Anh bán hàng có sẵn, hay đặt về mới có?", kieu: "chon-mot", luaChon: BAN_GI },
  { id: "khoRieng", hoi: "Anh có kho riêng không?", kieu: "co-khong" },
  { id: "muaHo", hoi: "Có ai mua hộ / lấy hàng từ đối tác theo đơn không?", kieu: "co-khong" },
  { id: "congTacVien", hoi: "Anh có cộng tác viên bán hàng không?", kieu: "co-khong" },
  { id: "giaoHang", hoi: "Ai giao hàng cho khách?", kieu: "chon-mot", luaChon: GIAO_HANG },
  { id: "thuTien", hoi: "Thu tiền trước hay thu khi giao (COD)?", kieu: "chon-mot", luaChon: THU_TIEN },
  { id: "kenh", hoi: "Anh bán trên kênh nào?", kieu: "chon-nhieu", luaChon: KENH },
  { id: "noiDung", hoi: "Anh có làm nội dung (bài đăng) không?", kieu: "chon-mot", luaChon: NOI_DUNG },
  { id: "video", hoi: "Anh có quay video sản phẩm không?", kieu: "co-khong" },
  { id: "botTraLoi", hoi: "Anh muốn bot trả lời khách nhắn tin không?", kieu: "co-khong" },
  { id: "baoCaoNhuCau", hoi: "Anh muốn xem báo cáo khách hỏi gì mà chưa có không?", kieu: "co-khong" }
];

export interface ManhDeXuat {
  id: ModuleId;
  /** Vi sao manh nay co mat — hien cho khach, co dau. */
  viSao: string;
  nguon: "luat" | "ai";
}

export interface KetQuaPheu {
  manh: ManhDeXuat[];
  /** Cau tra loi mau thuan hay chua co manh — noi ro, khong lang le. */
  luuY: string[];
}

export type KetQuaKiemCauTraLoi = { ok: true; cauTraLoi: CauTraLoiPheu } | { ok: false; reason: string };

/** Chi nhan DUNG hinh dang. Truong la — ke ca "moTa" tu do — la tu choi: luat khong doc van ban. */
export function kiemCauTraLoi(v: unknown): KetQuaKiemCauTraLoi {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, reason: "Câu trả lời phải là một đối tượng." };
  const o = v as Record<string, unknown>;
  const biet = new Set<string>(CAU_HOI_PHEU.map((c) => c.id));
  for (const k of Object.keys(o)) {
    if (!biet.has(k)) return { ok: false, reason: `Trường "${k}" không phải câu hỏi của phễu.` };
  }
  for (const c of CAU_HOI_PHEU) {
    const x = o[c.id];
    if (x === undefined) return { ok: false, reason: `Thiếu câu trả lời "${c.id}".` };
    if (c.kieu === "co-khong") {
      if (typeof x !== "boolean") return { ok: false, reason: `"${c.id}" phải là có/không.` };
    } else if (c.kieu === "chon-mot") {
      if (typeof x !== "string" || !(c.luaChon as readonly string[]).includes(x)) return { ok: false, reason: `"${c.id}" phải là một trong: ${(c.luaChon ?? []).join(", ")}.` };
    } else {
      if (!Array.isArray(x) || x.length === 0 || !x.every((y) => typeof y === "string" && (c.luaChon as readonly string[]).includes(y))) {
        return { ok: false, reason: `"${c.id}" phải là mảng không rỗng trong: ${(c.luaChon ?? []).join(", ")}.` };
      }
    }
  }
  return { ok: true, cauTraLoi: o as unknown as CauTraLoiPheu };
}

const TEN = (id: ModuleId): string => MODULES[id].name;

/** Tu cau tra loi kin ra bo manh. Tat dinh. Cau tra loi sai hinh dang thi NEM — khong doan. */
export function pheuDangKy(cauTraLoi: CauTraLoiPheu): KetQuaPheu {
  const kiem = kiemCauTraLoi(cauTraLoi);
  if (!kiem.ok) throw new Error(`pheuDangKy: ${kiem.reason}`);
  const t = kiem.cauTraLoi;
  const viSao = new Map<ModuleId, string>();
  const luuY: string[] = [];
  for (const id of CORE_MODULE_IDS) viSao.set(id, `${TEN(id)} là mảnh lõi, luôn bật.`);

  if (t.giaoHang === "tu-gui") viSao.set("van-chuyen", "Có Vận chuyển vì anh tự gửi hàng qua bưu cục: cần tạo và theo dõi vận đơn.");
  else if (t.giaoHang === "don-vi-van-chuyen") viSao.set("van-chuyen", "Có Vận chuyển vì anh giao qua đơn vị vận chuyển: cần tạo và theo dõi vận đơn.");

  if (t.thuTien !== "cod") viSao.set("tien", "Có Tiền & đối soát vì anh thu tiền chuyển khoản trước: cần đối soát tiền về.");
  else if (t.muaHo) viSao.set("tien", "Có Tiền & đối soát vì có mua hộ: đối tác hết hàng thì phải hoàn tiền cho khách.");

  if (t.muaHo) viSao.set("mua-ho", "Có Mua hộ vì có người lấy hàng từ đối tác theo đơn.");
  else if (t.banGi !== "co-san") {
    viSao.set("mua-ho", t.khoRieng
      ? "Có Mua hộ vì anh bán hàng đặt về: cần báo khách ngày hàng về và theo dõi đơn đặt."
      : "Có Mua hộ vì anh không có kho riêng, hàng đặt về theo đơn: cần theo dõi đơn đặt.");
  }

  if (t.kenh.includes("web")) viSao.set("gian-hang", "Có Gian hàng vì anh bán trên web riêng.");
  else if (t.congTacVien) viSao.set("gian-hang", "Có Gian hàng vì có cộng tác viên: họ cần đường link riêng để bán.");

  if (t.noiDung === "tu-lam") viSao.set("xuong-noi-dung", "Có Xưởng nội dung vì anh tự làm bài đăng.");
  if (t.noiDung === "thue") viSao.set("goi-noi-dung", "Có Gói nội dung theo tháng vì anh thuê làm bài đăng.");
  if (t.video) viSao.set("xuong-video", "Có Xưởng video vì anh quay video sản phẩm.");

  const kenhChat = t.kenh.filter((k) => k === "facebook" || k === "zalo" || k === "tiktok");
  if (kenhChat.length > 0) viSao.set("hop-thu", `Có Hộp thư đa kênh vì anh nhận tin khách qua ${kenhChat.join(", ")}.`);
  if (t.botTraLoi) {
    if (viSao.has("hop-thu")) viSao.set("chatbot-cskh", "Có Chatbot chăm sóc khách vì anh muốn bot trả lời tin nhắn.");
    else luuY.push("Anh muốn bot trả lời nhưng chưa chọn kênh chat nào (Facebook, Zalo, TikTok), nên chưa bật Chatbot.");
  }
  if (t.baoCaoNhuCau) {
    if (viSao.has("chatbot-cskh")) viSao.set("nhu-cau-cho", "Có Nhu cầu chờ & báo cáo vì anh muốn biết khách hỏi gì mà chưa có.");
    else luuY.push("Báo cáo nhu cầu chờ lấy từ hội thoại của bot, nên cần bật Chatbot trước; chưa bật.");
  }
  if (t.kenh.includes("san")) luuY.push("Sàn thương mại điện tử chưa có mảnh riêng ở đợt này; đơn từ sàn nhập tay vào Đơn hàng & khách.");

  // Thu tu theo bang manh, khong theo thu tu luat.
  const manh: ManhDeXuat[] = MODULE_IDS.filter((id) => viSao.has(id))
    .map((id) => ({ id, viSao: viSao.get(id) as string, nguon: "luat" as const }));
  return { manh, luuY };
}

export interface DeNghiAI {
  id: unknown;
  viSao: unknown;
}

/**
 * AI de nghi them manh. De nghi KHONG vao bo manh — chi vao `deNghi`. Id la, manh loi, manh da
 * co, hay vi sao khong phai chuoi: bo. Ket qua `manh` la CHINH bo manh cua luat, khong doi.
 */
export function gopDeNghi(manh: ManhDeXuat[], deNghi: DeNghiAI[]): { manh: ManhDeXuat[]; deNghi: ManhDeXuat[] } {
  const daCo = new Set<ModuleId>(manh.map((m) => m.id));
  const ra: ManhDeXuat[] = [];
  for (const d of deNghi) {
    if (!isModuleId(d.id) || MODULES[d.id].core || daCo.has(d.id) || typeof d.viSao !== "string" || d.viSao === "") continue;
    if (ra.some((r) => r.id === d.id)) continue;
    ra.push({ id: d.id, viSao: d.viSao, nguon: "ai" });
  }
  return { manh: manh.map((m) => ({ ...m })), deNghi: ra };
}

/**
 * Khach chot: them/bot tren bo manh cua luat. Tra ve danh sach manh MUA THEM (khong co manh
 * loi — `enabledModules` luon them loi) theo thu tu bang manh, de dat vao `LicensePayload.modules`.
 * Manh loi khong bo duoc (bo la vo hieu). Id la thi NEM.
 */
export function chotManh(manh: ManhDeXuat[], chon: { them: readonly string[]; bo: readonly string[] }): ModuleId[] {
  for (const id of [...chon.them, ...chon.bo]) {
    if (!isModuleId(id)) throw new Error(`chotManh: "${String(id)}" không phải một mảnh.`);
  }
  const bo = new Set<string>(chon.bo);
  const ra = new Set<ModuleId>(manh.map((m) => m.id).filter((id) => !bo.has(id)));
  for (const id of chon.them) ra.add(id as ModuleId);
  return MODULE_IDS.filter((id) => ra.has(id) && !MODULES[id].core);
}
