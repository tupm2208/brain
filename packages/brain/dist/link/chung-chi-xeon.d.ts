import type { Server as TcpServer } from "node:net";
import type { TlsOptions } from "node:tls";
export declare const TEP_KHOA_XEON = "xeon.key.pem";
export declare const TEP_CHUNG_CHI_XEON = "xeon.cert.pem";
export declare const TEP_KHOA_DU_PHONG_XEON = "xeon.du-phong.key.pem";
/** Dau "du phong vua sinh, chua OMI nao co ghim": nam tren dia, chi mat khi xoay (epXoay) tieu no. */
export declare const TEP_DAU_DU_PHONG_MOI = "xeon.du-phong.moi";
/** Con it hon bay nhieu ngay thi gia han luc mo. */
export declare const GIA_HAN_TRUOC_NGAY = 30;
export interface ChungChiXeon {
    certPem: string;
    privateKeyPem: string;
    /** In ra cho nguoi quan tri dua vao OMI. */
    ghim: string;
    /** Ghim cua khoa du phong — OMI giu san de xoay khoa khong can cap nhat tung may. */
    ghimDuPhong: string;
    /** `[ghim, ghimDuPhong]` — thu dua cho OMI (`activated.ghim`, `dayGhim`). */
    cacGhim: string[];
    /**
     * Khoa du phong VUA SINH o lan mo nay (thu muc A3, hay tep du phong bi mat / sao luu thieu): chua
     * OMI nao co ghim nay — `xoayKhoaXeon` tu choi cho toi khi OMI da nhan (`pins` sau welcome).
     */
    duPhongVuaSinh: boolean;
    hetHan: string;
    /** Ten trong chung chi (CN). */
    ten: string;
    /**
     * `moi` = vua sinh ca khoa; `gia-han` = khoa cu, chung chi moi; `giu` = doc tu tep;
     * `xoay` = du phong vua len chinh (do `xoayKhoaXeon`, hay hoan tat mot lan xoay bi ngat).
     */
    trangThai: "moi" | "gia-han" | "giu" | "xoay";
}
export interface TuyChonChungChiXeon {
    /** Ten may chu — chi dung khi SINH; da co chung chi thi giu ten trong chung chi. */
    ten: string;
    /**
     * Cho phep SINH KHOA MOI khi thu muc chua co gi. Mac dinh KHONG: mot Xeon da tung chay ma
     * thay thu muc trong (container quen mount volume, doi may quen chep) thi lang le sinh khoa
     * moi la doi ghim, moi OMI ngoai kia bi khoa ngoai cung luc ma khong ai biet vi sao. Lan dau
     * dung Xeon la mot viec CO CHU Y — nguoi dung phai noi ro.
     */
    khoiTao?: boolean | undefined;
    hieuLucNgay?: number | undefined;
    now?: (() => Date) | undefined;
}
/**
 * Mo (hoac tao) chung chi cua Xeon trong `thuMuc`. Tra ve chung chi + khoa + ghim.
 * Xem ba luat o dau tep.
 */
export declare function chungChiTrongTep(thuMuc: string, opts: TuyChonChungChiXeon): Promise<ChungChiXeon>;
/**
 * XOAY KHOA: du phong len chinh (ghim OMI DA co), sinh du phong moi. Ba buoc tren dia, theo thu tu
 * ma `chungChiTrongTep` hoan tat duoc neu ngat giua chung: (1) ghi chung chi cua khoa du phong vao
 * cho chinh; (2) doi ten tep du phong thanh tep khoa chinh; (3) sinh du phong moi.
 * Sau do: `capNhatChungChiTls(server, tuyChonTlsXeon(cc))` cho may chu dang chay, va
 * `mayChu.dayGhim(cc.cacGhim, ...)` SAU KHI moi OMI da noi lai qua khoa moi (OMI tu choi danh
 * sach khong chua ghim dang noi).
 */
export declare function xoayKhoaXeon(thuMuc: string, opts?: Omit<TuyChonChungChiXeon, "khoiTao" | "ten"> & {
    ten?: string | undefined;
    epXoay?: boolean | undefined;
}): Promise<ChungChiXeon>;
/**
 * Nguoi quan tri xac nhan ghim du phong VUA SINH da toi moi OMI (`pins` sau welcome, kiem `dayGhim` ra du so
 * phien): go dau `xeon.du-phong.moi` de `xoayKhoaXeon` khong con tu choi. Khong co dau thi khong lam gi, `false`.
 */
export declare function xacNhanDuPhongDaPhat(thuMuc: string): Promise<boolean>;
/** Doi chung chi cua may chu TLS DANG CHAY (sau xoay / gia han): ket noi moi dung bo moi, ket noi cu giu nguyen. */
export declare function capNhatChungChiTls(server: TcpServer, opts: TlsOptions): void;
/**
 * Tuy chon cho `mayChuTls`: chung chi + khoa cua Xeon, chi TLS 1.3, va han bat tay TLS bang
 * han bat tay cua duong day — mot khach mo TCP roi im lang khong duoc giu socket mai.
 */
export declare function tuyChonTlsXeon(cc: Pick<ChungChiXeon, "certPem" | "privateKeyPem">, opts?: {
    hanBatTayMs?: number | undefined;
}): TlsOptions;
//# sourceMappingURL=chung-chi-xeon.d.ts.map