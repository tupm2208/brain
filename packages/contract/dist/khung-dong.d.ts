export declare const MAX_FRAME_BYTES_MAC_DINH: number;
export declare class VuotTranKhung extends Error {
    readonly bytes: number;
    readonly tran: number;
    constructor(bytes: number, tran: number);
}
/** Dong goi mot khung de gui. */
export declare function dongKhung(frame: unknown): Buffer;
/**
 * Bo tach khung: dua byte vao, lay ra tung khung da parse.
 * KHONG kiem hinh dang khung — do la viec cua `parseLinkFrame` o tang tren. O day chi tach
 * dong va parse JSON; dong khong phai JSON thi tra ve `{ loi }` de tang tren quyet dinh.
 */
export declare class BoTachKhung {
    private readonly tran;
    private dem;
    private daCo;
    constructor(tran?: number);
    /** Tra ve cac khung hoan chinh trong mau nay. Nem `VuotTranKhung` khi mot dong qua dai. */
    nap(mau: Buffer): ({
        khung: unknown;
    } | {
        loi: string;
    })[];
}
//# sourceMappingURL=khung-dong.d.ts.map