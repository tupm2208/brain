import type { IndustryPack } from "./types";
/** O thay the bo may luon cap. Ho so them o rieng qua `extraVars`. */
export declare const ENGINE_VARS: string[];
/** Mau cau tuy chon bo may biet dung. Khai them ngoai danh sach nay cung duoc. */
export declare const OPTIONAL_TEMPLATES: string[];
export declare function validatePack(pack: IndustryPack): string[];
export declare function assertPackValid(pack: IndustryPack): void;
/**
 * Tu dem cua ho so KHONG duoc trung voi bat ky tu nao trong ten/ma mon cua shop.
 *
 * `specificTokens` la cua duy nhat dan toi muc luc; mot tu bi nuot o day la mon do khong
 * bao gio ban duoc — va "giay moi" (giay luoi) suyt bien mat vi "moi" nam trong tu dem
 * cua chinh nganh giay. `validatePack` khong biet muc luc cua shop nao, nen viec nay
 * phai lam LUC NAP MUC LUC. Tra ve danh sach tu dem pham loi; rong la sach.
 */
export declare function kiemTuDemVoiMucLuc(pack: IndustryPack, items: readonly {
    code: string;
    name: string;
}[]): string[];
//# sourceMappingURL=validate.d.ts.map