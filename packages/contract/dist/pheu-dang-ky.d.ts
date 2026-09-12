import { type ModuleId } from "./modules";
export declare const BAN_GI: readonly ["co-san", "dat-ve", "ca-hai"];
export declare const GIAO_HANG: readonly ["tu-gui", "don-vi-van-chuyen", "khach-tu-lay"];
export declare const THU_TIEN: readonly ["truoc", "cod", "ca-hai"];
export declare const KENH: readonly ["facebook", "zalo", "tiktok", "san", "web"];
export declare const NOI_DUNG: readonly ["khong", "tu-lam", "thue"];
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
export declare const CAU_HOI_PHEU: readonly CauHoiPheu[];
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
export type KetQuaKiemCauTraLoi = {
    ok: true;
    cauTraLoi: CauTraLoiPheu;
} | {
    ok: false;
    reason: string;
};
/** Chi nhan DUNG hinh dang. Truong la — ke ca "moTa" tu do — la tu choi: luat khong doc van ban. */
export declare function kiemCauTraLoi(v: unknown): KetQuaKiemCauTraLoi;
/** Tu cau tra loi kin ra bo manh. Tat dinh. Cau tra loi sai hinh dang thi NEM — khong doan. */
export declare function pheuDangKy(cauTraLoi: CauTraLoiPheu): KetQuaPheu;
export interface DeNghiAI {
    id: unknown;
    viSao: unknown;
}
/**
 * AI de nghi them manh. De nghi KHONG vao bo manh — chi vao `deNghi`. Id la, manh loi, manh da
 * co, hay vi sao khong phai chuoi: bo. Ket qua `manh` la CHINH bo manh cua luat, khong doi.
 */
export declare function gopDeNghi(manh: ManhDeXuat[], deNghi: DeNghiAI[]): {
    manh: ManhDeXuat[];
    deNghi: ManhDeXuat[];
};
/**
 * Khach chot: them/bot tren bo manh cua luat. Tra ve danh sach manh MUA THEM (khong co manh
 * loi — `enabledModules` luon them loi) theo thu tu bang manh, de dat vao `LicensePayload.modules`.
 * Manh loi khong bo duoc (bo la vo hieu). Id la thi NEM.
 */
export declare function chotManh(manh: ManhDeXuat[], chon: {
    them: readonly string[];
    bo: readonly string[];
}): ModuleId[];
//# sourceMappingURL=pheu-dang-ky.d.ts.map