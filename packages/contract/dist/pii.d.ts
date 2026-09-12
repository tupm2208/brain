export declare const REDACTED = "[da che]";
/**
 * Che du lieu ca nhan trong MOT DOAN VAN BAN TU DO.
 *
 * Chi che duoc thu co hinh dang nhan ra duoc: so dien thoai va email.
 * KHONG che duoc dia chi hay ten nguoi — khong mau nao doc duoc chung dang tin,
 * nen thu do phai giai quyet bang cach khong luu (xem chu thich dau tep).
 *
 * CO Y khong che "day so dai bat ky": ma hang EAN-13, ma don, so tai khoan cua shop
 * deu la day so dai hop le, che chung di la lam hong du lieu that.
 */
export declare function redactPII(text: string): string;
export interface PIIFinding {
    index: number;
    kind: "phone" | "email";
}
/** Do du lieu ca nhan trong MOT DOAN VAN BAN TU DO. */
export declare function findPIIInText(text: string): PIIFinding[];
/**
 * Nem loi neu cac doan VAN BAN TU DO sap luu con du lieu ca nhan.
 *
 * Chi truyen van ban tu do — dung truyen ma hoi thoai, ma hang, ma khach thue.
 * Chu ky chi nhan `string[]` de goi nham thanh loi luc bien dich.
 */
export declare function assertNoStoredPII(texts: readonly string[]): void;
//# sourceMappingURL=pii.d.ts.map