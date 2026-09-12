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
export type CatalogIssueKind = "not_object" | "unknown_key" | "wrong_type" | "phone_in_value" | "email_in_value" | "long_digits_in_value";
export interface CatalogCleanIssue {
    kind: CatalogIssueKind;
    path: string;
    /** Cau giai thich cho nguoi van hanh. Khong kem gia tri that de nhat ky khong dinh PII. */
    hint: string;
}
/** Quet mot mon hang (hoac mang mon hang). Rong = sach. */
export declare function findCatalogIssues(value: unknown, path?: string): CatalogCleanIssue[];
/** Nem loi neu muc luc chua sach. Bo nap PHAI goi truoc khi day len Xeon. */
export declare function assertCatalogClean(value: unknown): void;
//# sourceMappingURL=catalog.d.ts.map