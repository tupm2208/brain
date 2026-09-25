/**
 * @file Instruction text of the three tiers, put together for one shop (24/09/2026).
 *
 * Pure text work, no disk, no model: which blocks apply (the industry's, minus the ones the shop
 * switched off, with the shop's own text where it wrote one), the placeholders filled from the
 * shop profile, the profile itself said in words, and a fingerprint per block so a screen can tell
 * a shop "the industry's version of this block changed since you edited it".
 */

import { emptyShopProfile, profileField, profileFieldSet, type ShopProfile } from "@sp/contract";
import type { AgentBlock } from "./types";

/** A short, stable fingerprint of a block's text (FNV-1a, hex). Not a secret, just "did it change". */
export function blockFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The values every placeholder may take for one shop and one turn. */
export interface FillValues {
  site: string;
  tenShop: string;
  hoSo: ShopProfile;
}

/** A conditional line: `[?banHang.tiLeCoc] Coc toi thieu {banHang.tiLeCoc}%` — kept only when the field is set. */
const CONDITIONAL_LINE = /^\s*\[\?([a-zA-Z0-9_.]+)\]\s?/;
const PLACEHOLDER = /\{([a-zA-Z0-9_.]+)\}/g;

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(valueText).filter(Boolean).join(" — ");
  return String(v);
}

/**
 * Who the bot names when it hands over (25/09/2026): the shop's `tenNguoiPhuTrach`, or the neutral
 * "người phụ trách". A profile from an older landing may not carry the field at all.
 */
export function personInCharge(hoSo: ShopProfile | null | undefined): string {
  return String(hoSo?.tenNguoiPhuTrach ?? "").trim() || "người phụ trách";
}

/**
 * Fills `{khach}`, `{shop}`, `{tenShop}`, `{site}`, `{tenNguoiPhuTrach}` and `{profile.path}` placeholders, and drops
 * `[?path]` lines whose field the shop never set. A placeholder of an unset field becomes
 * "(chưa khai)": the model then sees plainly that there is nothing to say.
 */
export function fillAgentText(text: string, values: FillValues): string {
  const p = values.hoSo;
  const fixed: Record<string, string> = {
    site: values.site,
    tenShop: values.tenShop,
    khach: p.xungHo.khach || "khách",
    shop: p.xungHo.shop || "shop",
    tenNguoiPhuTrach: personInCharge(p)
  };
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const cond = raw.match(CONDITIONAL_LINE);
    let line = raw;
    if (cond) {
      if (!profileFieldSet(p, cond[1]!)) continue;
      line = raw.slice(cond[0].length);
    }
    lines.push(line.replace(PLACEHOLDER, (_all, name: string) => {
      if (name in fixed) return fixed[name]!;
      return profileFieldSet(p, name) ? valueText(profileField(p, name)) : "(chưa khai)";
    }));
  }
  return lines.join("\n");
}

/**
 * The industry's blocks as THIS shop runs them: switched-off blocks dropped, rewritten blocks
 * replaced by the shop's text. Order is the industry's. Blocks the shop may not rewrite
 * (`shopSua: false`) keep the industry text whatever the profile says — the profile screen refuses
 * such an edit, and this refuses it again in case an old profile carries one.
 */
export function blocksForShop(industry: readonly AgentBlock[], hoSo: ShopProfile): AgentBlock[] {
  const out: AgentBlock[] = [];
  for (const block of industry) {
    const own = hoSo.khoiNganh[block.id];
    if (own === undefined || own.cheDo === "nganh") { out.push(block); continue; }
    if (own.cheDo === "tat") { if (block.shopSua) continue; out.push(block); continue; }
    out.push(block.shopSua && own.vanBan.trim() !== "" ? { ...block, loiDan: own.vanBan } : block);
  }
  return out;
}

/** Blocks joined into prompt text, each under its title, placeholders filled. */
export function renderBlocks(blocks: readonly AgentBlock[], values: FillValues): string {
  return blocks.map((b) => `## ${b.tieuDe}\n${fillAgentText(b.loiDan, values)}`).join("\n\n");
}

const MAC_CA: Record<string, string> = { "khong-giam": "KHONG giam gia, ban dung gia niem yet", "giam-toi-da": "duoc giam, toi da theo muc shop khai", "qua-tang": "khong giam gia, co the tang kem" };
const KHI_CHOT: Record<string, string> = { "link-web": "gui LINK trang san pham (tu tra_kho) de khach dat tren web", phieu: "moi khach dien phieu dat hang", "goi-nguoi": "goi nguoi phu trach vao len don" };
const MUC_CHOT: Record<string, string> = { khong: "KHONG BAO GIO moi chot; tra loi dung thong tin roi dung", "dau-hieu": "chi moi chot khi khach TU co dau hieu mua (lay/dat/mua/ship/coc/cho dia chi-SDT)", "sau-bao-gia": "sau khi bao gia co the moi khach chot mot cau ngan" };

/**
 * The shop profile said in words for the model — tier 3's section of the prompt. Only fields the
 * shop set (or accepted from the industry) are spoken; the rest are listed as "chưa khai" with the
 * order to hand over, so the model never fills the gap from another shop's habits.
 */
export function renderProfile(hoSo: ShopProfile | null | undefined, chinhSach?: { doiTra: string; ship: string; baoHanh: string } | undefined): string {
  const p = hoSo ?? emptyShopProfile();
  const set = (path: string) => profileFieldSet(p, path);
  const lines: string[] = ["## HO SO SHOP (tang 3 — dieu chi dung voi shop nay; uu tien hon thoi quen cua mo hinh)"];
  const missing: string[] = [];
  const say = (path: string, text: string, label: string) => { if (set(path)) lines.push(`- ${text}`); else missing.push(label); };

  say("xungHo.khach", `XUNG HO: goi khach la "${p.xungHo.khach}", shop xung "${p.xungHo.shop || "em"}". Chi doi khi NGUOI TRUC trong hoi thoai da goi khach khac di.`, "xưng hô");
  // `cauChaoAi` is deliberately NOT here: the landing sends the greeting once per customer; the bot never greets itself.
  say("tenNguoiPhuTrach", `NGUOI PHU TRACH: "${p.tenNguoiPhuTrach}" — khi can chuyen nguoi thi noi "de em bao ${p.tenNguoiPhuTrach}", KHONG bia ten khac.`, "tên người phụ trách");
  if (set("giong.ghiChu")) lines.push(`- GIONG: ${p.giong.ghiChu}`);
  if (set("giong.emoji")) lines.push(`- Bieu tuong cam xuc: ${p.giong.emoji === "co" ? "duoc dung khi hop (vd :D)" : "KHONG dung"}.`);
  if (set("giong.doDai")) lines.push(`- Do dai tin: ${p.giong.doDai === "ngan" ? "ngan nhu nguoi that nhan tin (khoang 7-15 tu), moi luot MOT tin" : "vua phai, toi da 3-4 cau, moi luot MOT tin"}.`);
  if (set("hangCoBan")) lines.push(`- HANG CO BAN: ${p.hangCoBan.join(", ")}.`);
  if (set("hangKhongBan")) lines.push(`- HANG KHONG BAN: ${p.hangKhongBan.join(", ")}. Khach hoi hang nay thi noi thang, khong tra kho.`);
  if (set("monTheThao")) lines.push(`- MON / NHOM HANG CO BAN: ${p.monTheThao.join(", ")}. Khach hoi mon trong danh sach nay thi tra_kho theo mon, CAM noi "ben em khong ban".`);
  if (set("banHang.cauKhongCo")) lines.push(`- KHI KHONG CO MAU / HANG KHACH HOI: noi dung cau "${p.banHang.cauKhongCo}" (KHONG noi "het hang", KHONG noi "chua kinh doanh"), roi goi y 2-3 mau tuong tu con hang neu tra duoc.`);
  say("banHang.coHangOrder", p.banHang.coHangOrder === "co"
    ? `HANG ORDER: shop CO ban hang order. Noi "dang dat duoc", KHONG noi "co san"; CAM noi "hang dang ve/sap ve".${set("banHang.thoiGianOrder") ? ` Thoi gian: ${p.banHang.thoiGianOrder}.` : ""}${p.banHang.tiLeCoc !== null ? ` Coc truoc toi thieu ${p.banHang.tiLeCoc}% de giu don, con lai tra khi nhan.` : ""}`
    : "HANG ORDER: shop KHONG ban hang order — chi tu van hang co san.", "hàng order");
  if (p.banHang.coHangOrder === "co" && p.banHang.tiLeCoc === null) missing.push("tỷ lệ cọc hàng order");
  if (p.banHang.coHangOrder === "co" && !set("banHang.thoiGianOrder")) missing.push("thời gian hàng order về");
  say("banHang.codHangSan", `HANG SAN: giao ngay${p.banHang.codHangSan === "co" ? ", COD duoc (nhan hang kiem tra roi tra tien)" : ", KHONG COD — thanh toan truoc"}.`, "COD hàng sẵn");
  if (set("banHang.doiTraHangOrder")) lines.push(`- DOI TRA HANG ORDER: ${p.banHang.doiTraHangOrder}`);
  if (set("banHang.doiSizeDonDaDat")) lines.push(`- DOI SIZE DON DA DAT: ${p.banHang.doiSizeDonDaDat}`);
  say("banHang.macCa", `MAC CA / XIN GIAM: ${MAC_CA[p.banHang.macCa.kieu] ?? ""}${p.banHang.macCa.chiTiet ? ` — ${p.banHang.macCa.chiTiet}` : ""}. KHONG hua bot ngoai muc nay, KHONG hoi khach muon gia bao nhieu.`, "mặc cả");
  say("banHang.khiChot", `KHACH CHOT DON (da co mau + size con hang): ${KHI_CHOT[p.banHang.khiChot] ?? ""}.`, "khách chốt thì làm gì");
  say("chuyenNguoi.mucChot", `MOI CHOT: ${MUC_CHOT[p.chuyenNguoi.mucChot] ?? ""}.`, "mức mời chốt");
  if (set("chuyenNguoi.chuDe")) lines.push(`- CHU DE PHAI GOI NGUOI PHU TRACH (ngoai khieu nai/tien): ${p.chuyenNguoi.chuDe.join(", ")}.`);
  if (set("chuyenNguoi.gioTruc")) lines.push(`- Gio co nguoi truc: ${p.chuyenNguoi.gioTruc}. Ngoai gio thi noi nguoi phu trach se tra loi trong gio truc.`);
  if (set("cauCam")) lines.push(`- CAU CAM RIENG CUA SHOP: ${p.cauCam.map((c) => `"${c}"`).join(", ")}.`);
  say("camKetHang", `CAM KET VE HANG (khach hoi chinh hang / that gia): "${p.camKetHang}". Chi noi dung cau nay, khong them.`, "cam kết về hàng (chính hãng?)");
  say("cuaHang", `CUA HANG / GIO MO CUA: ${p.cuaHang}`, "cửa hàng, giờ mở cửa");
  const policy = chinhSach ?? { doiTra: "", ship: "", baoHanh: "" };
  const policyMissing = (["doiTra", "ship", "baoHanh"] as const).filter((k) => policy[k].trim() === "");
  if (policyMissing.length < 3) lines.push(`- CHINH SACH ${(["doiTra", "ship", "baoHanh"] as const).filter((k) => policy[k].trim() !== "").map((k) => ({ doiTra: "doi tra", ship: "ship", baoHanh: "bao hanh" })[k]).join(", ")}: da khai, goi chinh_sach de doc nguyen van truoc khi noi.`);
  for (const k of policyMissing) missing.push({ doiTra: "chính sách đổi trả", ship: "chính sách ship", baoHanh: "chính sách bảo hành" }[k]);
  if (missing.length > 0) {
    lines.push(`- CHUA KHAI (shop chua dien): ${missing.join("; ")}. Khach hoi dung cac dieu nay thi KHONG doan, KHONG lay thoi quen cua shop khac: noi "Dạ phần này để em gọi ${personInCharge(p)} vào hỗ trợ ${p.xungHo.khach || "mình"} ngay ạ."`);
  }
  return lines.join("\n");
}
