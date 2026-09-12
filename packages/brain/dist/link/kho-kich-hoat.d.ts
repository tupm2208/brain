import { type ErrorCode, type MachineId, type ModuleId, type SignedLicense, type TenantId, type ToolName } from "@sp/contract";
export declare const TEP_KHO_KICH_HOAT = "kich-hoat.json";
export declare const TEP_KHOA_KY_XEON = "xeon.ky.key.pem";
/** Ma kich hoat song bao nhieu gio ke tu luc cap. */
export declare const MA_SONG_GIO = 72;
export declare const GIAY_PHEP_NGAY_MAC_DINH = 365;
export interface DonCapMa {
    tenant: TenantId | string;
    tenantName: string;
    packId: string;
    modules: ModuleId[];
    seats?: number | undefined;
    /** Han giay phep, ngay. */
    hieuLucNgay?: number | undefined;
    /** Han cua chinh MA, gio. */
    maSongGio?: number | undefined;
    minContract?: string | undefined;
}
export interface DongKichHoat {
    licenseId: string;
    tenant: TenantId;
    capLuc: string;
    hetHanMa: string;
    daDungLuc?: string | undefined;
    dungOMay?: MachineId | undefined;
    /** Khoa may da nhan luc dung ma — thu hoi ma la thu hoi khoa nay. */
    keyId?: string | undefined;
    thuHoiLuc?: string | undefined;
    thuHoiViSao?: string | undefined;
    license: SignedLicense;
}
export type KetQuaKiemMa = {
    ok: true;
    license: SignedLicense;
} | {
    ok: false;
    code: ErrorCode;
    reason: string;
};
export interface ThuHoiMa {
    licenseId: string;
    tenant: TenantId;
    /** Khoa may da nhan bang ma nay (neu ma da dung). */
    keyId?: string | undefined;
    lyDo: string;
}
export interface KhoKichHoat {
    /** Ky va cap mot ma moi. Tra ve ma (dua cho khach) va licenseId. */
    capMa(don: DonCapMa): Promise<{
        ma: string;
        licenseId: string;
    }>;
    /** Kiem ma — chu ky, so ma, chua dung, chua thu hoi, chua het han. KHONG danh dau. */
    kiemMa(ma: string, now?: Date): Promise<KetQuaKiemMa>;
    /**
     * Danh dau da dung o `machine` (va khoa `keyId` neu da biet). NGUYEN TU: `false` neu da dung / thu hoi /
     * khong biet. `ghiDe: true` = chi GHI THEM keyId vao dong DA DUNG cung may (buoc hai cua kich hoat);
     * dong da thu hoi thi `false`.
     */
    dungMa(licenseId: string, machine: MachineId | string, keyId?: string, opts?: {
        ghiDe?: boolean | undefined;
    }): Promise<boolean>;
    /**
     * Go danh dau da dung — CHI cho duong kich hoat khi da danh dau ma khong bao duoc OMI (day dong
     * giua chung): ma khong duoc chay oan. `false` neu ma chua dung / da thu hoi.
     */
    traLaiMa(licenseId: string): Promise<boolean>;
    thuHoiMa(licenseId: string, lyDo: string): Promise<boolean>;
    /** Nghe moi lan thu hoi ma — may chu duong day dung de thu hoi KHOA da nhan bang ma do. */
    khiThuHoi(fn: (tin: ThuHoiMa) => void): () => void;
    /**
     * Ky danh sach ghim (khung `pins`) bang khoa ky giay phep, kem SO THU TU ben: cung danh sach voi lan
     * ky truoc thi cung so; danh sach DOI thi so tang va duoc ghi xuong dia truoc khi ky. OMI chi nhan
     * so lon hon so da luu — khung cu (danh sach truoc khi xoay) khong phat lai duoc, khong can dong ho.
     */
    kyGhim(ghim: readonly string[], reason: string): Promise<{
        seq: number;
        signature: string;
    }>;
    /** So thu tu ghim hien tai (0 = chua ky lan nao). */
    soGhim(): number;
    /** Giay phep dang dung cua shop: ma DUNG gan nhat, chua thu hoi. */
    giayPhepCua(tenant: TenantId | string): Promise<SignedLicense | null>;
    /** Cong cu bot theo giay phep dang dung; rong khi chua kich hoat / het han / thu hoi. */
    congCuCua(tenant: TenantId | string, now?: Date): Promise<ToolName[]>;
    lietKe(tenant: TenantId | string): Promise<DongKichHoat[]>;
    /** Khoa CONG KHAI dung de ky (PEM) — de in ra / dua vao bo cai neu muon OMI tu soi ma. */
    khoaCongKy(): string[];
}
/** Bo dem ghim ben: so hien tai va danh sach da ky voi so do. */
export interface BoDemGhim {
    seq: number;
    ghim: string[];
}
/** Ban trong bo nho — bai thu va may chu thu nghiem. Khoi dong lai la quen het (ke ca khoa ky). */
export declare function khoKichHoatTrongBoNho(now?: () => Date): KhoKichHoat;
export interface TuyChonKhoKichHoatTep {
    /** Cho phep SINH KHOA KY MOI khi thu muc chua co gi. Xem luat 4 o dau tep. */
    khoiTao?: boolean | undefined;
    now?: (() => Date) | undefined;
    /** Nhat ky: canh bao khi so ma co dong ky bang khoa KHAC khoa hien tai (phuc hoi tep lech). */
    ghi?: ((dong: string) => void) | undefined;
}
/**
 * Ban trong thu muc: `xeon.ky.key.pem` (khoa ky, 0600) + `kich-hoat.json` (so ma, khong co khoa).
 */
export declare function khoKichHoatTrongTep(thuMuc: string, opts?: TuyChonKhoKichHoatTep): Promise<KhoKichHoat>;
//# sourceMappingURL=kho-kich-hoat.d.ts.map