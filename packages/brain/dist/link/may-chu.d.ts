import { type Server as TcpServer } from "node:net";
import { type TlsOptions } from "node:tls";
import type { Duplex } from "node:stream";
import { type EventEnvelope, type MachineId, type RefreshFrame, type TenantId, type ToolName } from "@sp/contract";
import type { Kenh } from "./goi-qua-day";
import type { KhoKhoaMay, KhoaMayDaBiet } from "./kho-khoa";
import type { KhoKichHoat } from "./kho-kich-hoat";
export type { KhoaMayDaBiet } from "./kho-khoa";
/** Sau `end()` bay nhieu ms ma ben kia chua dong thi `destroy()`. */
export declare const HAN_DONG_MS = 2000;
export interface MayChuDayConfig {
    /**
     * Kho khoa may cua Xeon (`khoKhoaTrongTep` tren may that). May chu tra khoa qua no VA nghe
     * su kien thu hoi de CAT phien dang song bang khoa vua bi thu hoi. Dung mot trong hai:
     * `khoKhoa` (may that) hoac `traKhoaMay` (bai thu cap khoa bang tay, khong co thu hoi).
     */
    khoKhoa?: KhoKhoaMay | undefined;
    /** Tra khoa cong khai da cap cho `keyId`, kem tenant/may ma khoa do thuoc ve. */
    traKhoaMay?: ((keyId: string) => Promise<KhoaMayDaBiet | null>) | undefined;
    /**
     * Kho kich hoat (A5): nhan khung `activate` — kiem ma ky so, NHAN khoa cong khai OMI sinh vao
     * `khoKhoa`, danh dau ma da dung. Khong co (hay khong co `khoKhoa`) thi Xeon nay khong kich hoat.
     */
    khoKichHoat?: KhoKichHoat | undefined;
    /**
     * Ghim TLS cua chinh Xeon, [chinh, du phong] — dua cho OMI trong `activated`, va de `dayGhim`
     * tu choi danh sach khong chua ghim DANG DUNG (lenh sai khong duoc khoa OMI ngoai).
     */
    cacGhim?: (() => readonly string[]) | undefined;
    /**
     * Cong cu bot duoc phep voi giay phep hien tai cua shop. Rong = het han. Bo trong khi co
     * `khoKichHoat`: dung `khoKichHoat.congCuCua` (giay phep da kich hoat) — day la cho kiem giay phep
     * o may chu; dua ham rieng la tu chiu trach nhiem kiem.
     */
    congCuCua?: ((tenant: TenantId) => Promise<ToolName[]>) | undefined;
    /** Su kien cuoi Xeon da nhan cua shop — de bao OMI gui tiep tu day. */
    seqCuoi(tenant: TenantId): Promise<number>;
    /** Xeon nhan mot su kien tu OMI (da qua kiem thu tu). */
    nhanSuKien(tenant: TenantId, seq: number, event: EventEnvelope): Promise<void>;
    /** Phien ban ban giao keo toi thieu OMI phai co. */
    minContract: string;
    heartbeatSec?: number | undefined;
    maxFrameBytes?: number | undefined;
    /** Han cho `hello` sau khi phat thu thach, va han song cua thu thach. */
    hanBatTayMs?: number | undefined;
    now?: (() => Date) | undefined;
    /** Duoc goi khi mot phien da bat tay xong — de gan `taoToolPort` vao `kenh`. */
    onPhien?: ((phien: PhienOmi) => void) | undefined;
    /** Nhat ky may chu. */
    ghi?: ((dong: string) => void) | undefined;
}
/** Ban giao keo tu do OMI hieu khung `pins` / `activated`. OMI cu hon nhan `pins` la mat day. */
export declare const CONTRACT_CO_PINS = "0.3.0";
export interface PhienOmi {
    tenant: TenantId;
    machine: MachineId;
    /** Khoa may da chao — de cat phien nay khi khoa bi thu hoi. */
    keyId: string;
    /** Ban giao keo OMI khai trong `hello` — de khong gui khung OMI cu khong hieu. */
    contract: string;
    sessionId: string;
    /** Duong ong cua phien nay — dua vao `taoToolPort`. */
    kenh: Kenh;
    dong(lyDo: string): void;
    /** Con song khong. Heartbeat khong ve la sai. */
    song(): boolean;
}
export interface MayChuDay {
    /** Gan mot socket vua nhan duoc (TCP hay TLS). */
    ganSocket(socket: Duplex): void;
    phienCua(tenant: TenantId): PhienOmi | undefined;
    /**
     * Bao OMI cua shop phai lay lai thu gi (`refresh`). Goi sau khi doi goi / thu hoi giay phep:
     * OMI se noi lai va `welcome` moi mang danh sach cong cu moi. Tra `false` khi shop khong
     * dang noi — luc do khong can bao, lan chao ke tiep tu khac lay ban moi.
     */
    lamMoi(tenant: TenantId, what: RefreshFrame["what"], reason: string): boolean;
    /**
     * Day CA danh sach ghim xuong MOI OMI dang noi (khung `pins`). Tra ve so phien da GUI (khong phai da
     * nhan). Danh sach phai hop le, khong rong, va chua ghim dang dung cua Xeon (khi co `cacGhim`) — sai
     * thi NEM. Thu tu xoay khoa: xoay -> OMI noi lai qua khoa moi -> `dayGhim(cacGhim moi)`.
     */
    dayGhim(ghim: readonly string[], reason: string): Promise<number>;
    /** Cat MOI phien dang song (buoc 3 khi xoay khoa: OMI noi lai qua khoa moi). Tra ve so phien da cat. */
    catMoiPhien(lyDo: string): number;
    /** Xeon TLS co kho kich hoat ma khong co `cacGhim`: OMI kich hoat xong chi co MOT ghim, xoay khoa la khoa ngoai. `mayChuTls` nem. */
    readonly thieuCacGhim: boolean;
    dong(): void;
}
export declare function taoMayChuDay(cfg: MayChuDayConfig): MayChuDay;
/** May chu TCP thuan — cho bai kiem tra va cho mang noi bo tin cay. */
export declare function mayChuTcp(mayChu: MayChuDay): TcpServer;
/**
 * May chu TLS — cho Internet. `opts` lay tu `tuyChonTlsXeon(chungChi)`. Ket noi hong truoc
 * khi bat tay TLS xong (khach im lang qua han, gui rac, TLS qua cu) khong bao gio toi
 * `ganSocket`: ghi nhat ky va cat, de socket khong nam lai.
 */
export declare function mayChuTls(mayChu: MayChuDay, opts: TlsOptions, ghi?: (dong: string) => void): TcpServer;
//# sourceMappingURL=may-chu.d.ts.map