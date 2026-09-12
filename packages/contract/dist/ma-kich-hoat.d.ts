import type { MachineId } from "./ids";
import { type LicensePayload, type SignedLicense } from "./license";
/** `payload.machine` cua giay phep cap truoc khi cai: gan may luc kich hoat. */
export declare const MAY_CHUA_GAN: MachineId;
export declare const TIEN_TO_MA_KICH_HOAT = "SPK1.";
/** Ky giay phep bang khoa ky cua Xeon (Ed25519, PEM PKCS#8). */
export declare function kyGiayPhep(payload: LicensePayload, khoaKyRiengPem: string, keyId: string, licenseId: string): SignedLicense;
/** Kiem chu ky giay phep bang khoa CONG KHAI cua Xeon. Khoa hong hay chu ky hong deu la SAI. */
export declare function kiemChuKyGiayPhep(sl: SignedLicense, khoaKyCongPem: string): boolean;
export declare function maHoaMaKichHoat(sl: SignedLicense): string;
export type KetQuaGiaiMa = {
    ok: true;
    license: SignedLicense;
} | {
    ok: false;
    reason: string;
};
/**
 * Giai ma + kiem HINH DANG (khong kiem chu ky — viec do can khoa cong khai cua Xeon, xem
 * `kiemChuKyGiayPhep`). Du lieu tu tay khach dan vao luon la du lieu la.
 */
export declare function giaiMaMaKichHoat(ma: unknown): KetQuaGiaiMa;
/**
 * Chuoi OMI ky trong khung `activate` bang khoa may VUA SINH: co nonce (chong phat lai), ma giay
 * phep, may, ban giao keo. Nhan "kich-hoat" de khong trung `chuoiDeKy` cua `hello`.
 */
export declare function chuoiDeKyKichHoat(args: {
    nonce: string;
    licenseId: string;
    machine: MachineId | string;
    contract: string;
}): string;
/**
 * Chuoi Xeon KY trong khung `pins` bang khoa ky giay phep (khong phai khoa TLS): ke co khoa TLS cu
 * bi lo van khong day duoc danh sach ghim moi xuong OMI. JSON de `reason` mang ky tu gi cung duoc.
 */
export declare function chuoiDeKyGhim(args: {
    ghim: readonly string[];
    reason: string;
    seq: number;
}): string;
/** Ma nhan dien khoa ky cua Xeon: `ky-` + 16 ky tu base64url cua SHA-256(SPKI). Bam KHOA nen on dinh. */
export declare function keyIdCuaKhoaCong(khoaCongPem: string): string;
//# sourceMappingURL=ma-kich-hoat.d.ts.map