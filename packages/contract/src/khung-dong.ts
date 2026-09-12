// DONG KHUNG TREN DAY — moi khung la MOT DONG JSON, ket thuc bang `\n`.
//
// Vi sao khong phai WebSocket: Node khong co may chu WebSocket san, ma luat cua du an la
// khong them thu vien cho thu co the lam bang thu co san. TCP/TLS thuan + JSON tung dong
// la du: de doc bang mat trong nhat ky, de thu bang `nc`, va khong co gi de cau hinh sai.
//
// Hai dieu bat buoc:
//  1. TRAN kich thuoc mot khung. Khong co tran thi mot dau day hong (hoac ac y) gui mot
//     dong khong bao gio ket thuc la ben nhan phinh bo nho den chet. `WelcomeFrame`
//     khai `maxFrameBytes`; vuot thi DONG DUONG, khong co gi de thuong luong.
//  2. Chiu duoc byte den tung mau: mang khong biet "mot khung" la gi, mot khung co the
//     den trong ba goi, hoac ba khung den trong mot goi.

export const MAX_FRAME_BYTES_MAC_DINH = 256 * 1024;

export class VuotTranKhung extends Error {
  constructor(public readonly bytes: number, public readonly tran: number) {
    super(`Khung ${bytes} byte vuot tran ${tran} byte — dong duong.`);
    this.name = "VuotTranKhung";
  }
}

/** Dong goi mot khung de gui. */
export function dongKhung(frame: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(frame)}\n`, "utf8");
}

/**
 * Bo tach khung: dua byte vao, lay ra tung khung da parse.
 * KHONG kiem hinh dang khung — do la viec cua `parseLinkFrame` o tang tren. O day chi tach
 * dong va parse JSON; dong khong phai JSON thi tra ve `{ loi }` de tang tren quyet dinh.
 */
export class BoTachKhung {
  private dem: Buffer[] = [];
  private daCo = 0;

  constructor(private readonly tran: number = MAX_FRAME_BYTES_MAC_DINH) {}

  /** Tra ve cac khung hoan chinh trong mau nay. Nem `VuotTranKhung` khi mot dong qua dai. */
  nap(mau: Buffer): ({ khung: unknown } | { loi: string })[] {
    const ra: ({ khung: unknown } | { loi: string })[] = [];
    let batDau = 0;
    for (let i = 0; i < mau.length; i += 1) {
      if (mau[i] !== 0x0a) continue;
      const phan = mau.subarray(batDau, i);
      const tong = this.daCo + phan.length;
      if (tong > this.tran) throw new VuotTranKhung(tong, this.tran);
      const dong = Buffer.concat([...this.dem, phan]);
      this.dem = [];
      this.daCo = 0;
      batDau = i + 1;
      const chu = dong.toString("utf8").trim();
      if (chu === "") continue;
      try {
        ra.push({ khung: JSON.parse(chu) as unknown });
      } catch {
        ra.push({ loi: "Dong khong phai JSON." });
      }
    }
    if (batDau < mau.length) {
      const du = mau.subarray(batDau);
      this.daCo += du.length;
      if (this.daCo > this.tran) throw new VuotTranKhung(this.daCo, this.tran);
      this.dem.push(Buffer.from(du));
    }
    return ra;
  }
}
