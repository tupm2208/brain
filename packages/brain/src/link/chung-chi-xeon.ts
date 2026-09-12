// CHUNG CHI TLS CUA XEON — nam trong hai tep, tu sinh lan dau, tu gia han cung khoa.
//
// Vi sao hai tep chu khong phai mot: tep chung chi la thu co the dua cho nguoi khac xem
// (khong co gi bi mat), tep khoa rieng thi khong bao gio. Hai quyen khac nhau, hai tep.
//
// Ba luat:
//  1. MAT CHUNG CHI, CON KHOA -> sinh lai cung khoa. Ghim khong doi, khong OMI nao biet.
//  2. MAT KHOA, CON CHUNG CHI -> MO THAT BAI. Lang le sinh khoa moi la doi ghim, va moi OMI
//     ngoai kia bi khoa ngoai cung luc ma khong ai biet vi sao. Viec do phai la mot nguoi
//     quyet dinh (phuc hoi khoa tu ban sao luu, hoac xoa ca hai tep va cap nhat ghim moi OMI).
//  3. SAP HET HAN (duoi `GIA_HAN_TRUOC_NGAY`) hay da het -> gia han cung khoa luc mo. OMI
//     khong kiem han (xem `contract/chung-chi.ts`), nen viec nay chi la ve sinh — nhung la ve
//     sinh tu dong, de khong bao gio phai nho.
//
// Ghi tep nguyen tu nhu kho khoa: tep tam, fsync, doi ten. Khoa rieng ghi voi quyen 0600
// (Windows bo qua). Tep chung chi ma mang "PRIVATE KEY" la mo that bai: ai do da chep nham.
//
// KHOA DU PHONG (A5, RFC 7469 doi co ghim du phong): khoi tao sinh CA khoa du phong, in ca hai
// ghim cho OMI. Khoa chinh bi lo thi `xoayKhoaXeon`: du phong len chinh (OMI DA co ghim nay), sinh
// du phong moi, roi day danh sach ghim moi xuong OMI (`mayChu.dayGhim`). Xoay la ba buoc tren dia
// (chung chi moi -> doi khoa -> du phong moi); ngat giua chung thi lan mo sau nhan ra va hoan tat.
// Thu muc tu A3 (chua co du phong) mo lai thi sinh du phong — ghim chinh khong doi, khong ai bi
// khoa ngoai. Tep du phong HONG thi mo that bai: ghim du phong da in cho OMI, lang le thay la
// mot ghim OMI tin khong con khoa nao dung.

import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, X509Certificate, type KeyObject } from "node:crypto";
import type { Server as TcpServer } from "node:net";
import type { Server as TlsServer, TlsOptions } from "node:tls";
import { TIEN_TO_GHIM, ghimCuaChungChi, sinhChungChiTuKy } from "@sp/contract";

export const TEP_KHOA_XEON = "xeon.key.pem";
export const TEP_CHUNG_CHI_XEON = "xeon.cert.pem";
export const TEP_KHOA_DU_PHONG_XEON = "xeon.du-phong.key.pem";
/** Dau "du phong vua sinh, chua OMI nao co ghim": nam tren dia, chi mat khi xoay (epXoay) tieu no. */
export const TEP_DAU_DU_PHONG_MOI = "xeon.du-phong.moi";
/** Con it hon bay nhieu ngay thi gia han luc mo. */
export const GIA_HAN_TRUOC_NGAY = 30;

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

async function docTep(tep: string): Promise<string | null> {
  try {
    return await readFile(tep, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function xoaTep(tep: string): Promise<void> {
  try { await unlink(tep); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

async function ghiNguyenTu(tep: string, noiDung: string, mode: number): Promise<void> {
  const tam = `${tep}.tmp`;
  const fh = await open(tam, "w", mode);
  try {
    await fh.writeFile(noiDung, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tam, tep);
}

function docKhoa(pem: string, tep: string): KeyObject {
  let k: KeyObject;
  try { k = createPrivateKey(pem); } catch (e) {
    throw new Error(`Tep khoa "${tep}" hong: khong doc duoc khoa rieng (${String((e as Error)?.message ?? e)}).`);
  }
  if (k.asymmetricKeyType !== "ed25519") throw new Error(`Tep khoa "${tep}": khoa phai la Ed25519, day la ${String(k.asymmetricKeyType)}.`);
  return k;
}

function tenTrong(x: X509Certificate): string {
  const m = /^CN=(.+)$/m.exec(x.subject);
  return m?.[1] ?? "";
}

/** Ghim (RFC 7469) cua khoa rieng: bam SPKI cua phan cong khai — cung so voi ghim cua chung chi sinh tu khoa do. */
function ghimCuaKhoa(khoa: KeyObject): string {
  const spki = createPublicKey(khoa).export({ type: "spki", format: "der" });
  return `${TIEN_TO_GHIM}${createHash("sha256").update(spki).digest("base64")}`;
}

function sinhKhoaDuPhong(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
}

/**
 * Doc (hoac sinh) khoa du phong. Khong co thi sinh — ghim chinh khong doi nen an toan; co ma hong
 * thi NEM (ghim du phong da in cho OMI).
 */
async function khoaDuPhong(thuMuc: string, danhDauMoi: boolean): Promise<{ pem: string; khoa: KeyObject; vuaSinh: boolean }> {
  const tep = join(thuMuc, TEP_KHOA_DU_PHONG_XEON);
  const tepDau = join(thuMuc, TEP_DAU_DU_PHONG_MOI);
  let pem = await docTep(tep);
  if (pem === null) {
    pem = sinhKhoaDuPhong();
    await ghiNguyenTu(tep, pem, 0o600);
    // Dau nam TREN DIA: lan mo sau (hay tien trinh xoay khoa) van biet du phong nay chua toi OMI nao.
    if (danhDauMoi) await ghiNguyenTu(tepDau, JSON.stringify({ sinhLuc: new Date().toISOString() }), 0o644);
  }
  let khoa: KeyObject;
  try { khoa = docKhoa(pem, tep); } catch (e) {
    throw new Error(`Khoa du phong "${tep}" hong (${String((e as Error)?.message ?? e)}). Ghim du phong da in cho OMI — khong tu thay; phuc hoi tu sao luu hoac xoa tep de sinh cai moi VA bao OMI.`);
  }
  return { pem, khoa, vuaSinh: (await docTep(tepDau)) !== null };
}

/**
 * Mo (hoac tao) chung chi cua Xeon trong `thuMuc`. Tra ve chung chi + khoa + ghim.
 * Xem ba luat o dau tep.
 */
export async function chungChiTrongTep(thuMuc: string, opts: TuyChonChungChiXeon): Promise<ChungChiXeon> {
  const now = opts.now ?? (() => new Date());
  // Han ngan hon nguong gia han thi MOI lan mo la mot lan gia han — cau hinh vo nghia.
  if (opts.hieuLucNgay !== undefined && !(opts.hieuLucNgay > GIA_HAN_TRUOC_NGAY)) {
    throw new Error(`chungChiTrongTep: hieuLucNgay ${String(opts.hieuLucNgay)} phai lon hon nguong gia han ${GIA_HAN_TRUOC_NGAY} ngay.`);
  }
  const tepKhoa = join(thuMuc, TEP_KHOA_XEON);
  const tepCert = join(thuMuc, TEP_CHUNG_CHI_XEON);
  const khoaPem = await docTep(tepKhoa);
  const certPem = await docTep(tepCert);

  if (khoaPem === null && certPem !== null) {
    throw new Error(
      `Xeon co chung chi "${tepCert}" nhung MAT KHOA RIENG "${tepKhoa}". Khong tu sinh khoa moi: ghim se doi va ` +
      "moi OMI dang noi se bi khoa ngoai. Phuc hoi khoa tu ban sao luu, hoac xoa ca hai tep de sinh bo moi VA cap nhat ghim cho tung OMI."
    );
  }

  if (khoaPem === null) {
    if (opts.khoiTao !== true) {
      throw new Error(
        `Chua co khoa TLS nao trong "${thuMuc}". Lan DAU dung Xeon thi goi voi khoiTao: true. Xeon da tung chay ma toi ` +
        "day la thu muc bi mat / chua mount — KHONG sinh khoa moi: ghim doi thi moi OMI dang noi bi khoa ngoai."
      );
    }
    // Luat: sinh MOI. Sinh truoc (ten sai thi nem, chua tao thu muc nao), roi khoa truoc, chung
    // chi sau, du phong cuoi — mat dien o giua thi lan mo sau roi vao "mat chung chi, con khoa"
    // (tu gia han) hay "chua co du phong" (tu sinh), khong doi ghim chinh.
    const cc = sinhChungChiTuKy({ ten: opts.ten, tuLuc: now(), hieuLucNgay: opts.hieuLucNgay });
    await mkdir(thuMuc, { recursive: true });
    await ghiNguyenTu(tepKhoa, cc.privateKeyPem, 0o600);
    await ghiNguyenTu(tepCert, cc.certPem, 0o644);
    // Vua khoi tao: chua OMI nao ca, du phong "vua sinh" khong phai chuyen dang lo — khong danh dau.
    const dp = await khoaDuPhong(thuMuc, false);
    const ghimDuPhong = ghimCuaKhoa(dp.khoa);
    return { ...cc, ghimDuPhong, cacGhim: [cc.ghim, ghimDuPhong], duPhongVuaSinh: false, ten: opts.ten, trangThai: "moi" };
  }

  const khoa = docKhoa(khoaPem, tepKhoa);
  const kemDuPhong = async (cc: Omit<ChungChiXeon, "ghimDuPhong" | "cacGhim" | "duPhongVuaSinh">, danhDauMoi = true): Promise<ChungChiXeon> => {
    const dp = await khoaDuPhong(thuMuc, danhDauMoi);
    const ghimDuPhong = ghimCuaKhoa(dp.khoa);
    return { ...cc, ghimDuPhong, cacGhim: [cc.ghim, ghimDuPhong], duPhongVuaSinh: dp.vuaSinh };
  };
  const giaHan = async (ten: string, khoaRieng: string, trangThai: "gia-han" | "xoay"): Promise<ChungChiXeon> => {
    const cc = sinhChungChiTuKy({ ten, privateKeyPem: khoaRieng, tuLuc: now(), hieuLucNgay: opts.hieuLucNgay });
    await ghiNguyenTu(tepCert, cc.certPem, 0o644);
    return kemDuPhong({ ...cc, ten, trangThai });
  };

  if (certPem === null) return giaHan(opts.ten, khoaPem, "gia-han");
  if (/PRIVATE KEY/.test(certPem)) throw new Error(`Tep chung chi "${tepCert}" mang KHOA RIENG — ai do da chep nham. Khong mo.`);
  let x: X509Certificate;
  try { x = new X509Certificate(certPem); } catch (e) {
    throw new Error(`Tep chung chi "${tepCert}" hong: ${String((e as Error)?.message ?? e)}`);
  }
  const ten = tenTrong(x) || opts.ten;
  if (!x.checkPrivateKey(khoa)) {
    // Xoay khoa bi ngat sau buoc 1 (chung chi cua du phong da nam o cho chinh) va truoc buoc 2
    // (doi khoa): chung chi khop khoa DU PHONG. Hoan tat: du phong len chinh, sinh du phong moi.
    const tepDp = join(thuMuc, TEP_KHOA_DU_PHONG_XEON);
    const dpPem = await docTep(tepDp);
    if (dpPem !== null && x.checkPrivateKey(docKhoa(dpPem, tepDp))) {
      await rename(tepDp, tepKhoa);
      // Xoay vua hoan tat: du phong moi sinh la dieu binh thuong cua xoay, khong phai "vua sinh" dang lo.
      await xoaTep(join(thuMuc, TEP_DAU_DU_PHONG_MOI));
      return kemDuPhong({ certPem, privateKeyPem: dpPem, ghim: ghimCuaChungChi(certPem), hetHan: x.validToDate.toISOString(), ten, trangThai: "xoay" }, false);
    }
    throw new Error(`Chung chi "${tepCert}" KHONG KHOP khoa rieng "${tepKhoa}".`);
  }
  const conLai = x.validToDate.getTime() - now().getTime();
  if (conLai < GIA_HAN_TRUOC_NGAY * 86_400_000) return giaHan(ten, khoaPem, "gia-han");
  return kemDuPhong({
    certPem, privateKeyPem: khoaPem, ghim: ghimCuaChungChi(certPem),
    hetHan: x.validToDate.toISOString(), ten, trangThai: "giu"
  });
}

/**
 * XOAY KHOA: du phong len chinh (ghim OMI DA co), sinh du phong moi. Ba buoc tren dia, theo thu tu
 * ma `chungChiTrongTep` hoan tat duoc neu ngat giua chung: (1) ghi chung chi cua khoa du phong vao
 * cho chinh; (2) doi ten tep du phong thanh tep khoa chinh; (3) sinh du phong moi.
 * Sau do: `capNhatChungChiTls(server, tuyChonTlsXeon(cc))` cho may chu dang chay, va
 * `mayChu.dayGhim(cc.cacGhim, ...)` SAU KHI moi OMI da noi lai qua khoa moi (OMI tu choi danh
 * sach khong chua ghim dang noi).
 */
export async function xoayKhoaXeon(thuMuc: string, opts: Omit<TuyChonChungChiXeon, "khoiTao" | "ten"> & { ten?: string | undefined; epXoay?: boolean | undefined } = {}): Promise<ChungChiXeon> {
  const now = opts.now ?? (() => new Date());
  // Mo binh thuong truoc: bao dam co du phong, hoan tat lan xoay do dang neu co.
  const hienTai = await chungChiTrongTep(thuMuc, { ten: opts.ten ?? "xeon", now, hieuLucNgay: opts.hieuLucNgay });
  if (hienTai.duPhongVuaSinh && opts.epXoay !== true) {
    throw new Error(
      "xoayKhoaXeon: khoa du phong VUA SINH o lan mo nay (tep du phong bi mat / sao luu thieu) — chua OMI nao co ghim " +
      `${hienTai.ghimDuPhong}. Xoay ngay la khoa ngoai MOI OMI. Chay Xeon de OMI nhan ghim moi (pins sau welcome) roi moi xoay; ep bang epXoay: true.`
    );
  }
  const tepKhoa = join(thuMuc, TEP_KHOA_XEON);
  const tepCert = join(thuMuc, TEP_CHUNG_CHI_XEON);
  const tepDp = join(thuMuc, TEP_KHOA_DU_PHONG_XEON);
  const dpPem = await docTep(tepDp);
  if (dpPem === null) throw new Error(`xoayKhoaXeon: khong thay khoa du phong "${tepDp}".`);
  const cc = sinhChungChiTuKy({ ten: hienTai.ten, privateKeyPem: dpPem, tuLuc: now(), hieuLucNgay: opts.hieuLucNgay });
  await ghiNguyenTu(tepCert, cc.certPem, 0o644);      // (1)
  await rename(tepDp, tepKhoa);                         // (2)
  await xoaTep(join(thuMuc, TEP_DAU_DU_PHONG_MOI));     // du phong (co the vua sinh) da len chinh: dau het nghia
  const dp = await khoaDuPhong(thuMuc, false);          // (3)
  const ghimDuPhong = ghimCuaKhoa(dp.khoa);
  return { ...cc, ghimDuPhong, cacGhim: [cc.ghim, ghimDuPhong], duPhongVuaSinh: false, ten: hienTai.ten, trangThai: "xoay" };
}

/**
 * Nguoi quan tri xac nhan ghim du phong VUA SINH da toi moi OMI (`pins` sau welcome, kiem `dayGhim` ra du so
 * phien): go dau `xeon.du-phong.moi` de `xoayKhoaXeon` khong con tu choi. Khong co dau thi khong lam gi, `false`.
 */
export async function xacNhanDuPhongDaPhat(thuMuc: string): Promise<boolean> {
  const tep = join(thuMuc, TEP_DAU_DU_PHONG_MOI);
  if ((await docTep(tep)) === null) return false;
  await xoaTep(tep);
  return true;
}

/** Doi chung chi cua may chu TLS DANG CHAY (sau xoay / gia han): ket noi moi dung bo moi, ket noi cu giu nguyen. */
export function capNhatChungChiTls(server: TcpServer, opts: TlsOptions): void {
  const s = server as TlsServer;
  if (typeof s.setSecureContext !== "function") throw new Error("capNhatChungChiTls: day khong phai may chu TLS.");
  s.setSecureContext(opts);
}

/**
 * Tuy chon cho `mayChuTls`: chung chi + khoa cua Xeon, chi TLS 1.3, va han bat tay TLS bang
 * han bat tay cua duong day — mot khach mo TCP roi im lang khong duoc giu socket mai.
 */
export function tuyChonTlsXeon(cc: Pick<ChungChiXeon, "certPem" | "privateKeyPem">, opts: { hanBatTayMs?: number | undefined } = {}): TlsOptions {
  const han = opts.hanBatTayMs ?? 10_000;
  // Node chi dat han khi > 0: `hanBatTayMs: 0` la TAT han bat tay, khong phai "ngay lap tuc".
  if (!Number.isInteger(han) || han <= 0 || han > 2_147_483_647) throw new Error(`tuyChonTlsXeon: hanBatTayMs ${String(han)} phai la so nguyen duong (ms).`);
  return {
    key: cc.privateKeyPem,
    cert: cc.certPem,
    minVersion: "TLSv1.3",
    handshakeTimeout: han
  };
}
