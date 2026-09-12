// MUC LUC HANG HOA — ban rut gon ma Bo nao tren Xeon duoc phep giu.
//
// QUYET DINH 3 (ban dac ta): may khach giu ban goc, Xeon chi giu muc luc.
// Muc luc = thu von da cong khai tren web ban hang: ten, ma, hang, thuoc tinh, gia ban.
// TUYET DOI khong luu: so dien thoai, dia chi, lich su mua cua khach, va gia von.
//
// CONG CHAN: ban dau viet theo kieu "danh sach ten truong cam" (regex tren ten khoa).
// Agent phan bien 09/09 dap thung dung hai dau:
//   - Thung: `attributes.note = "Chi Lan 0968411655, 12 Hoai Duc"` LOT sach, vi cong
//     chi doc TEN khoa ma khong bao gio doc GIA TRI. Ma `attributes` lai la truong tu do —
//     dung cho du lieu ban hay chui vao nhat.
//   - Chan nham: `/tel\b/` chan luon `hotel`; `/ward/` chan `awards`, `rewardPoints`;
//     `province` chan ca tinh cua KHO va xuat xu san pham. Nen tang da nganh ma chan kieu do
//     thi nguoi ta se noi long cong — va cong bi noi long la cong chet.
//
// Ban nay doi sang DANH SACH TRANG THEO HINH DANG: muc luc co so truong dong, khoa la
// bi tu choi thay vi phai doan khoa nao xau. Cong them mot lan quet GIA TRI de bat
// so dien thoai va email lot vao o tu do.

import type { ItemId, TenantId, VariantId, WarehouseId } from "./ids";
import type { Money } from "./money";

export interface CatalogVariant {
  id: VariantId;
  /** Nhan hien cho khach: "42", "500mg x 30 vien", "60 phut". Pack nganh quyet dinh cach doc. */
  label: string;
  /** Gia BAN cho khach. Khong bao gio la gia von. */
  price: Money;
  /** Thu tu sap xep tu nhien (size 41 dung truoc 42) — de bot liet ke cho dung. */
  sort: number;
}

export interface CatalogItem {
  /** Bo nao phuc vu nhieu nha ban hang, nen moi dong muc luc phai biet minh cua ai. */
  tenant: TenantId;
  id: ItemId;
  /** Ma san pham shop dung hang ngay. */
  code: string;
  name: string;
  brand?: string | undefined;
  category?: string | undefined;
  /** Ten truc bien the theo nganh: "size", "ham luong", "thoi luong"... */
  variantAxis: string;
  variants: CatalogVariant[];
  /**
   * Thuoc tinh tu do do pack nganh dinh nghia: mau sac, gioi tinh, hoat chat...
   * Khoa tu do NHUNG gia tri bi quet — xem `findCatalogIssues`.
   */
  attributes: Record<string, string>;
  images: string[];
  /** Duong dan tren gian hang, de bot gui link dung mon. */
  url?: string | undefined;
  /** Moc cap nhat, dang ISO. Bo nap dung de dong bo tang dan thay vi nap lai ca kho. */
  updatedAt: string;
}

/** Ban gon dung cho ket qua tim kiem — bot khong can ca goi anh. */
export interface CatalogItemLite {
  id: ItemId;
  code: string;
  name: string;
  brand?: string | undefined;
  priceFrom: Money;
  variantCount: number;
  url?: string | undefined;
}

/**
 * Mot dong ton kho that, lay truc tiep tu OMI moi luot.
 * KHONG luu tren Xeon, va khong mang `tenant` vi luot goi da di tren duong noi cua dung
 * mot nha ban hang — them truong nua chi tao co hoi cho hai nguon su that lech nhau.
 */
export interface StockRow {
  itemId: ItemId;
  variantId: VariantId;
  variantLabel: string;
  warehouseId: WarehouseId;
  warehouseName: string;
  qty: number;
  price: Money;
}

// ---------------------------------------------------------------------------
// Cong chan
// ---------------------------------------------------------------------------

const ITEM_KEYS = new Set<string>([
  "tenant", "id", "code", "name", "brand", "category",
  "variantAxis", "variants", "attributes", "images", "url", "updatedAt"
]);
const VARIANT_KEYS = new Set<string>(["id", "label", "price", "sort"]);

/** So dien thoai Viet Nam trong mot chuoi tu do. */
const VN_PHONE_RE = /(?:\+?84|0)(?:\d[ .-]?){8,10}\d/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** Chuoi so dai lien tuc: the ngan hang, can cuoc, ma van don ca nhan... */
const LONG_DIGITS_RE = /\d{11,}/;

export type CatalogIssueKind =
  | "not_object"
  | "unknown_key"
  | "wrong_type"
  | "phone_in_value"
  | "email_in_value"
  | "long_digits_in_value";

export interface CatalogCleanIssue {
  kind: CatalogIssueKind;
  path: string;
  /** Cau giai thich cho nguoi van hanh. Khong kem gia tri that de nhat ky khong dinh PII. */
  hint: string;
}

function scanText(text: string, path: string, out: CatalogCleanIssue[]): void {
  if (VN_PHONE_RE.test(text)) {
    out.push({ kind: "phone_in_value", path, hint: "Chuoi chua thu giong so dien thoai." });
  } else if (EMAIL_RE.test(text)) {
    out.push({ kind: "email_in_value", path, hint: "Chuoi chua thu giong dia chi email." });
  } else if (LONG_DIGITS_RE.test(text)) {
    out.push({ kind: "long_digits_in_value", path, hint: "Chuoi so dai bat thuong (the, can cuoc?)." });
  }
}

function checkVariant(v: unknown, path: string, out: CatalogCleanIssue[]): void {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    out.push({ kind: "not_object", path, hint: "Bien the phai la mot doi tuong." });
    return;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!VARIANT_KEYS.has(k)) {
      out.push({ kind: "unknown_key", path: `${path}.${k}`, hint: "Bien the chi duoc co id, label, price, sort." });
      continue;
    }
    if (typeof val === "string") scanText(val, `${path}.${k}`, out);
  }
}

/** Quet mot mon hang (hoac mang mon hang). Rong = sach. */
export function findCatalogIssues(value: unknown, path = "$"): CatalogCleanIssue[] {
  const out: CatalogCleanIssue[] = [];

  if (Array.isArray(value)) {
    value.forEach((child, i) => out.push(...findCatalogIssues(child, `${path}[${i}]`)));
    return out;
  }
  if (value === null || typeof value !== "object") {
    out.push({
      kind: "not_object",
      path,
      hint: "Muc luc phai la doi tuong hoac mang doi tuong. Chuoi JSON khong duoc coi la sach."
    });
    return out;
  }

  for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${k}`;
    if (!ITEM_KEYS.has(k)) {
      out.push({
        kind: "unknown_key",
        path: at,
        hint: "Truong la khong thuoc muc luc. Muon them thi phai them vao CatalogItem truoc."
      });
      continue;
    }
    if (k === "variants") {
      if (!Array.isArray(val)) {
        out.push({ kind: "wrong_type", path: at, hint: "variants phai la mang." });
      } else {
        val.forEach((child, i) => checkVariant(child, `${at}[${i}]`, out));
      }
      continue;
    }
    if (k === "attributes") {
      if (val === null || typeof val !== "object" || Array.isArray(val)) {
        out.push({ kind: "wrong_type", path: at, hint: "attributes phai la doi tuong chu-sang-chu." });
        continue;
      }
      // Khoa tu do (pack nganh dat ten), nhung GIA TRI thi quet — day la cho ro that.
      for (const [ak, av] of Object.entries(val as Record<string, unknown>)) {
        if (typeof av === "string") scanText(av, `${at}.${ak}`, out);
        else if (typeof av !== "number" && typeof av !== "boolean") {
          out.push({ kind: "wrong_type", path: `${at}.${ak}`, hint: "Thuoc tinh chi duoc la chu, so hoac dung/sai." });
        }
      }
      continue;
    }
    if (k === "images") {
      if (!Array.isArray(val)) {
        out.push({ kind: "wrong_type", path: at, hint: "images phai la mang chuoi." });
      } else {
        val.forEach((child, i) => { if (typeof child === "string") scanText(child, `${at}[${i}]`, out); });
      }
      continue;
    }
    if (typeof val === "string") scanText(val, at, out);
  }

  return out;
}

/** Nem loi neu muc luc chua sach. Bo nap PHAI goi truoc khi day len Xeon. */
export function assertCatalogClean(value: unknown): void {
  const issues = findCatalogIssues(value);
  if (issues.length > 0) {
    const where = issues.slice(0, 8).map((i) => `${i.path} (${i.kind})`).join(", ");
    throw new Error(
      `Muc luc gui len Xeon chua dat (${issues.length} cho): ${where}. ` +
        `Xem QUYET DINH 3 trong ban dac ta — Xeon khong duoc giu du lieu khach hay gia von.`
    );
  }
}
