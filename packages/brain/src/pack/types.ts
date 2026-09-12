// BO LUAT NGANH — phan thay duoc cua nen tang.
//
// Bo may KHONG biet gi ve giay, ve thuoc, ve spa. Toan bo kien thuc nganh nam trong
// mot bo ho so kieu nay. Ban cho nganh moi = viet mot bo luat moi, khong dung vao bo may.
//
// Ban 2 (sau phan bien 09/09): mo rong bon cho tung dong cung, vi nganh khac hinh dang
// giay la phai sua ma — dung cai lo thung trong loi hua ban hang:
//   - MOT truc bien the  ->  nhieu truc (spa can thoi luong + khung gio)
//   - o thay the dong cung -> ho so tu khai them
//   - luat cong dong cung  -> them `forbidden_patterns` de nganh duoc khai luat rieng
//   - o thong tin dong cung -> ho so tu dat ten o

import type { ToolName } from "@sp/contract";

// ----------------------------------------------------------------- 1. Danh tinh
export interface PackIdentity {
  /** Xung ho voi khach: "bac", "anh chi", "quy khach". */
  customerPronoun: string;
  /** Shop tu xung: "em", "shop", "ben minh". */
  selfPronoun: string;
  /** Vai cau ta giong dieu, dua vao loi nhac cua mo hinh khi bat cua dien dat. */
  tone: string[];
  /** Cum tuyet doi khong duoc noi. Cong `forbidden_phrases` doc danh sach nay. */
  neverSay: string[];
}

// ----------------------------------------------------------------- 2. Tu dien
export interface PackLexicon {
  /** Hang shop co kinh doanh. */
  brands: string[];
  /** Hang co that tren thi truong nhung shop khong ban — de noi thang thay vi xin anh. */
  knownBrandsNotCarried: string[];
  /** Nhom hang: "giay chay", "ao gio"... Khach hoi ca nhom thi khong phai hoi lai mon cu the. */
  categories: string[];
  /** Cach khach hay go sai -> dang chuan. Khoa viet dang da chuan hoa, khong dau, lien nhau. */
  aliases: Record<string, string>;
  /** Tu chung chung, mot minh no khong du de nhan ra mon hang. */
  genericTerms: string[];
  /**
   * Tu DEM cua cau hoi tiep: "size 43 THI SAO", "con loai khac nua khong". Khong bao gio
   * la mot phan ten mon O NGANH NAY. Ho so phai tu khai vi cung mot chu co the la ten mon
   * o nganh khac ("cam", "vang", "day", "moi") — dat vao bo may la mon do khong bao gio
   * ban duoc.
   */
  fillerWords?: string[];
}

// ------------------------------------------------------- 3. Hinh dang mon hang
export interface PackAxisCanonical {
  /** Regex chay tren nhan da chuan hoa. */
  pattern: string;
  /** Chuoi thay the, dung `$1` de lay nhom. */
  replace: string;
}

/**
 * Mot truc bien the. Nganh ban le co mot truc (size); nganh dich vu thuong hai truc
 * (thoi luong + khung gio); nha thuoc cung hai (ham luong + quy cach).
 */
export interface PackAxis {
  /** Ma o thong tin, dung luon lam ten o trong `requiredSlots` va o thay the trong mau cau. */
  id: string;
  /** Nhan hien cho nguoi doc: "size", "ham luong", "thoi luong". */
  label: string;
  /** Bat gia tri trong cau khach go. Chay tren van ban DA CHUAN HOA. Nhom 1 la gia tri. */
  pattern: string;
  /**
   * Quy ve dang chuan de SO KHOP voi nhan kho.
   * Vi du "41 ruoi" -> "41.5": khach va kho viet khac nhau ma van phai gap duoc nhau.
   * Day la cho tung gay ra loi nang nhat: khop hut bi doc thanh "het hang".
   */
  canonical: PackAxisCanonical[];
  /** Vi du de nguoi viet ho so tu kiem. Bo may chay thu luc nap. */
  examples: { text: string; expect: string | null }[];
  /** Chua biet gia tri truc nay thi co duoc tra loi ton kho khong. */
  requiredForStock: boolean;
}

export interface PackItemShape {
  /** It nhat mot truc. Truc dau tien la truc chinh (dung cho cau hoi lai mac dinh). */
  axes: PackAxis[];
}

// ------------------------------------------------------------- 4. Y dinh khach
/** O thong tin. Hai o co san cua bo may, con lai do ho so tu dat ten theo truc bien the. */
export type SlotName = "item" | "phone" | (string & {});

export interface PackIntent {
  id: string;
  name: string;
  /** Tu khoa (viet khong dau) — trung mot tu la tinh diem. */
  keywords: string[];
  /** Regex bo sung, chay tren van ban da chuan hoa. Diem cao hon tu khoa. */
  patterns?: string[];
  /** Tu khoa lam MAT diem — de tach hai y dinh de lan nhau. */
  negativeKeywords?: string[];
  /** Thieu mot trong cac o nay thi KHONG duoc tra loi khang dinh — phai hoi lai. */
  requiredSlots: SlotName[];
  /** Cong cu can goi. Phai nam trong `allowedTools`. */
  tools: ToolName[];
  /** Mau cau khi tra loi duoc. */
  template: string;
  /** Mau cau khi thieu o. */
  askBackTemplate: string;
  /** Vi du de tu kiem: cau nay phai ra dung y dinh nay. */
  examples?: string[];
  /**
   * Y dinh nay LUON chuyen nguoi that, khong bao gio bot tu tra loi.
   * Nha thuoc dung cho cau hoi lieu dung; phong kham dung cho cau hoi benh ly.
   */
  handoff?: boolean;
}

// --------------------------------------------------------------- 6. Cong an toan
export type GateRule =
  /** Khong duoc khang dinh chinh sach neu khong co ket qua `policy.get`. */
  | { kind: "require_source_for_claims"; topics: string[]; patterns?: string[] }
  /** Chua nhan ra mon hang thi khong duoc tra loi ton kho. */
  | { kind: "require_item_before_stock" }
  /** Da hoi lai mot lan trong cua so nay roi thi lan hai phai chuyen nguoi that. */
  | { kind: "ask_back_once"; windowMinutes: number; maxTimes?: number }
  /** Moi con so trong cau tra loi phai lay tu ket qua cong cu. */
  | { kind: "no_unsourced_numbers" }
  /** Chi dam noi "ben em khong kinh doanh hang X" khi muc luc du lon. */
  | { kind: "brand_not_carried_needs_catalog"; minItems: number }
  /** Cau chua cum bi cam thi khong duoc gui. */
  | { kind: "forbidden_phrases" }
  /**
   * Luat rieng cua nganh, viet bang regex. Nha thuoc dung de chan tu van lieu dung;
   * phong kham dung de chan hua ket qua dieu tri.
   */
  | { kind: "forbidden_patterns"; patterns: string[]; reason: string }
  /** Mat ket noi OMI thi khong duoc khang dinh so lieu. */
  | { kind: "no_facts_when_offline" };

// ---------------------------------------------------------------- 7. Mau cau
/** Mau cau bat buoc phai co. Ho so duoc them mau cau rieng ngoai danh sach nay. */
export const REQUIRED_TEMPLATES = [
  "greeting", "ask_item", "ask_slot", "handoff",
  "offline", "brand_not_carried", "out_of_stock", "in_stock"
] as const;
export type TemplateKey = (typeof REQUIRED_TEMPLATES)[number];

export interface IndustryPack {
  id: string;
  name: string;
  identity: PackIdentity;
  lexicon: PackLexicon;
  itemShape: PackItemShape;
  intents: PackIntent[];
  /**
   * Y dinh mac dinh khi khach CHI NEU TEN MON ma khong hoi gi cu the.
   *
   * Cau dau tien khach that go la "shop oi co Adizero Boston 13 khong" — khong co tu
   * khoa nao cua y dinh nao, nhung ai cung hieu la dang hoi hang. Khong co o nay thi bot
   * chi chao lai, va cau "42" tiep theo cung roi vao khoang khong. Ho so tu khai, vi
   * "neu ten mon nghia la gi" la kien thuc nganh (o nha thuoc, neu ten thuoc cung la hoi
   * con khong; o dich vu thi co the la hoi lich).
   */
  intentWhenItemNamed?: string;
  /** Cong cu bo luat nay cho phep goi. Giao voi giay phep moi ra danh sach that. */
  allowedTools: ToolName[];
  gates: GateRule[];
  /**
   * O thay the rieng cua ho so, KEM gia tri tinh.
   * Truoc day chi khai duoc TEN o ma khong co duong nao dien gia tri, nen dung no
   * la moi cau tra loi deu thanh chuyen nguoi that — mot cai bay, va thong bao loi
   * cua bo soi lai dan thang vao bay do.
   */
  extraValues?: Record<string, string>;
  templates: Record<string, string>;
}
