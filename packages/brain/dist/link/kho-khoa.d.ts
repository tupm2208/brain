import { type CapKhoaMay, type MachineId, type TenantId } from "@sp/contract";
/** Nhung gi Xeon can biet ve mot khoa khi OMI chao. */
export interface KhoaMayDaBiet {
    publicKeyPem: string;
    tenant: TenantId;
    machine: MachineId;
}
/** Mot dong trong kho — de liet ke cho nguoi quan tri. Khong co khoa rieng. */
export interface DongKhoKhoa {
    keyId: string;
    tenant: TenantId;
    machine: MachineId;
    publicKeyPem: string;
    capLuc: string;
    thuHoiLuc?: string | undefined;
    thuHoiViSao?: string | undefined;
}
export interface ThuHoiKhoa {
    keyId: string;
    tenant: TenantId;
    machine: MachineId;
    lyDo: string;
}
export interface KhoKhoaMay {
    /**
     * Cap mot cap khoa moi cho may nay. Khoa cu cua CUNG may (neu con song) bi thu hoi.
     * Tra ve ca khoa rieng — nguoi goi dua cho OMI roi quen di; kho khong giu.
     */
    cap(tenant: TenantId, machine: MachineId): Promise<CapKhoaMay>;
    /**
     * NHAN khoa cong khai do OMI sinh tren may shop (duong kich hoat, A5): kho chi thay khoa cong
     * khai, khoa rieng chua bao gio roi khoi may shop. Cung luat voi `cap`: khoa cu cua CUNG may
     * bi thu hoi. PEM khong phai khoa cong khai Ed25519 (khoa rieng, RSA, rac) thi NEM, khong doi kho.
     */
    nhan(tenant: TenantId, machine: MachineId, publicKeyPem: string, opts?: {
        giuKhoaCu?: boolean | undefined;
    }): Promise<{
        keyId: string;
    }>;
    /** Khoa con song theo `keyId`; khong biet hoac da thu hoi thi `null`. */
    tra(keyId: string): Promise<KhoaMayDaBiet | null>;
    /** Thu hoi. Tra `false` neu khong co khoa nao dang song mang `keyId` do. */
    thuHoi(keyId: string, lyDo: string): Promise<boolean>;
    /**
     * Thu hoi MOI khoa dang song cua shop TRU `keyIdGiu` (kich hoat bang ma moi: may bi mat mang ten
     * khac cung chet). Nguyen tu, mot lan ghi. Tra ve cac keyId da thu hoi.
     */
    thuHoiKhac(tenant: TenantId, keyIdGiu: string, lyDo: string): Promise<string[]>;
    lietKe(tenant: TenantId): Promise<DongKhoKhoa[]>;
    /** Nghe moi lan thu hoi (ke ca thu hoi do thay khoa). Tra ve ham go dang ky. */
    khiThuHoi(fn: (tin: ThuHoiKhoa) => void): () => void;
}
/** Ban trong bo nho — cho bai thu va cho may chu thu nghiem. Khoi dong lai la quen het. */
export declare function khoKhoaTrongBoNho(now?: () => Date): KhoKhoaMay;
/**
 * Ban trong tep JSON. Mo la doc het vao bo nho; moi thay doi ghi ca tep, nguyen tu.
 * Tep chua co thi bat dau rong (va tao thu muc cha). Tep co ma hong thi NEM.
 */
export declare function khoKhoaTrongTep(tep: string, now?: () => Date): Promise<KhoKhoaMay>;
//# sourceMappingURL=kho-khoa.d.ts.map