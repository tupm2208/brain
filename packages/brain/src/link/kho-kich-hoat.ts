// KHO KICH HOAT — dau Xeon: khoa KY giay phep, so ma da cap, ma nao da dung o may nao.
//
// Day la cho "kiem giay phep o may chu" (Phan 17) that su nam: ma kich hoat la giay phep ky so,
// nhung ky so chi chan SUA; chan DUNG LAI can mot cai so. Bon luat:
//  1. MA DUNG MOT LAN, gan may luc dung. Ma da dung thi may nao — ke ca CUNG may — cung khong dung
//     lai duoc: ke co ma cu + biet ten may (ten may khong bi mat) ma dung lai duoc la cat duoc
//     OMI that. Mat khung `activated` giua duong thi ma da chay; cap ma moi la viec cua nguoi
//     (khoa mo coi bi thu hoi khi may do kich hoat lai — mot may mot khoa song).
//  2. GIAY PHEP DANG DUNG cua shop = ma DUNG GAN NHAT chua thu hoi. `congCuCua(tenant)` doc tu
//     day: giay phep het han hay bi thu hoi la bot mat het cong cu (`enabledTools`).
//  3. Ma song co han (`MA_SONG_GIO`, 72 gio): ma nam trong hop thu mail ca thang khong dung
//     duoc nua; giay phep ben trong co han rieng (`hieuLucNgay`).
//  4. KHOA KY nam RIENG (tep 0600), khong nam trong so ma. So ma mang "PRIVATE KEY" la mo that
//     bai. Mat khoa ky ma con so ma: mo that bai — lang le sinh khoa moi la moi ma da cap thanh rac
//     ma khong ai biet vi sao. Thu muc trong PHAI `khoiTao: true` (nhu chung chi TLS).
//
// Ghi tep nguyen tu, ghi TRUOC doi bo nho SAU, xep hang — cung khuon voi `kho-khoa.ts`.

import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import {
  MAY_CHUA_GAN, chuoiDeKyGhim, enabledTools, giaiMaMaKichHoat, keyIdCuaKhoaCong, kiemChuKyGiayPhep, kyChuoi, kyGiayPhep,
  licenseIssues, maHoaMaKichHoat, sinhKhoaMay,
  type ErrorCode, type LicensePayload, type MachineId, type ModuleId, type SignedLicense, type TenantId, type ToolName
} from "@sp/contract";

export const TEP_KHO_KICH_HOAT = "kich-hoat.json";
export const TEP_KHOA_KY_XEON = "xeon.ky.key.pem";
/** Ma kich hoat song bao nhieu gio ke tu luc cap. */
export const MA_SONG_GIO = 72;
export const GIAY_PHEP_NGAY_MAC_DINH = 365;

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

export type KetQuaKiemMa = { ok: true; license: SignedLicense } | { ok: false; code: ErrorCode; reason: string };

export interface ThuHoiMa {
  licenseId: string;
  tenant: TenantId;
  /** Khoa may da nhan bang ma nay (neu ma da dung). */
  keyId?: string | undefined;
  lyDo: string;
}

export interface KhoKichHoat {
  /** Ky va cap mot ma moi. Tra ve ma (dua cho khach) va licenseId. */
  capMa(don: DonCapMa): Promise<{ ma: string; licenseId: string }>;
  /** Kiem ma — chu ky, so ma, chua dung, chua thu hoi, chua het han. KHONG danh dau. */
  kiemMa(ma: string, now?: Date): Promise<KetQuaKiemMa>;
  /**
   * Danh dau da dung o `machine` (va khoa `keyId` neu da biet). NGUYEN TU: `false` neu da dung / thu hoi /
   * khong biet. `ghiDe: true` = chi GHI THEM keyId vao dong DA DUNG cung may (buoc hai cua kich hoat);
   * dong da thu hoi thi `false`.
   */
  dungMa(licenseId: string, machine: MachineId | string, keyId?: string, opts?: { ghiDe?: boolean | undefined }): Promise<boolean>;
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
  kyGhim(ghim: readonly string[], reason: string): Promise<{ seq: number; signature: string }>;
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

interface KhoaKy { keyId: string; privateKeyPem: string; publicKeyPem: string }
/** Bo dem ghim ben: so hien tai va danh sach da ky voi so do. */
export interface BoDemGhim { seq: number; ghim: string[] }
interface GhiXuong { (dong: DongKichHoat[], ghimBen: BoDemGhim): Promise<void> }

function dungKho(khoaKy: KhoaKy, banDau: DongKichHoat[], ghimBanDau: BoDemGhim, ghiXuong: GhiXuong, now: () => Date): KhoKichHoat {
  let dong: DongKichHoat[] = [...banDau];
  let ghimBen: BoDemGhim = { seq: ghimBanDau.seq, ghim: [...ghimBanDau.ghim] };
  const nguoiNghe = new Set<(tin: ThuHoiMa) => void>();
  let hang: Promise<unknown> = Promise.resolve();
  const xepHang = <T>(viec: () => Promise<T>): Promise<T> => {
    const p = hang.then(viec, viec);
    hang = p.catch(() => undefined);
    return p;
  };
  // Giay phep dang dung = ma DUNG GAN NHAT. Ma do bi thu hoi thi KHONG lui ve ma cu hon: khach
  // ha goi roi bi thu hoi ma lai duoc goi cu (to hon) quay ve la mot lo hong.
  const dangDung = (tenant: string): DongKichHoat | undefined => {
    let tot: DongKichHoat | undefined;
    for (const d of dong) {
      if (d.tenant !== tenant || d.daDungLuc === undefined) continue;
      // Cung mot giay (hai ma dung trong cung giay) thi dong SAU trong so thang.
      if (tot === undefined || d.daDungLuc >= (tot.daDungLuc ?? "")) tot = d;
    }
    return tot === undefined || tot.thuHoiLuc !== undefined ? undefined : tot;
  };

  return {
    capMa: (don) => xepHang(async () => {
      if (typeof don.tenant !== "string" || don.tenant === "") throw new Error("capMa: thieu tenant.");
      if (!Array.isArray(don.modules)) throw new Error("capMa: modules phai la mang.");
      const luc = now();
      const hieuLuc = don.hieuLucNgay ?? GIAY_PHEP_NGAY_MAC_DINH;
      const maSong = don.maSongGio ?? MA_SONG_GIO;
      if (!(hieuLuc > 0) || !(maSong > 0)) throw new Error("capMa: hieuLucNgay va maSongGio phai duong.");
      const payload: LicensePayload = {
        tenant: don.tenant as TenantId, tenantName: don.tenantName, machine: MAY_CHUA_GAN, packId: don.packId,
        modules: [...don.modules], seats: don.seats ?? 0,
        expiresAt: new Date(luc.getTime() + hieuLuc * 86_400_000).toISOString(),
        minContract: don.minContract ?? "0.1.0", issuedAt: luc.toISOString()
      };
      const licenseId = `lic-${randomBytes(8).toString("hex")}`;
      const license = kyGiayPhep(payload, khoaKy.privateKeyPem, khoaKy.keyId, licenseId);
      const ban = [...dong, {
        licenseId, tenant: payload.tenant, capLuc: luc.toISOString(),
        hetHanMa: new Date(luc.getTime() + maSong * 3_600_000).toISOString(), license
      }];
      await ghiXuong(ban, ghimBen);
      dong = ban;
      return { ma: maHoaMaKichHoat(license), licenseId };
    }),
    async kiemMa(ma, now2 = now()) {
      const giai = giaiMaMaKichHoat(ma);
      if (!giai.ok) return { ok: false, code: "bad_input", reason: giai.reason };
      const sl = giai.license;
      if (sl.keyId !== khoaKy.keyId || !kiemChuKyGiayPhep(sl, khoaKy.publicKeyPem)) {
        return { ok: false, code: "forbidden", reason: "Chu ky cua ma kich hoat khong phai cua Xeon nay." };
      }
      const d = dong.find((x) => x.licenseId === sl.licenseId);
      if (d === undefined) return { ok: false, code: "forbidden", reason: "Ma kich hoat khong co trong so cap." };
      // So sanh voi ban da ky trong so: chu ky dung tren MOT payload ma so ghi payload khac la
      // hai ma cung licenseId — khong the xay ra neu so khong bi sua tay; van soi.
      if (d.license.signature !== sl.signature) return { ok: false, code: "forbidden", reason: "Ma kich hoat khong khop so cap." };
      if (d.thuHoiLuc !== undefined) return { ok: false, code: "license_invalid", reason: "Ma kich hoat da bi thu hoi." };
      if (d.daDungLuc !== undefined) return { ok: false, code: "forbidden", reason: "Ma kich hoat da dung roi. Can ma moi." };
      if (Date.parse(d.hetHanMa) <= now2.getTime()) return { ok: false, code: "license_invalid", reason: "Ma kich hoat da het han. Can ma moi." };
      const loi = licenseIssues(sl.payload, now2);
      if (loi.length > 0) return { ok: false, code: "license_invalid", reason: `Giay phep trong ma: ${loi.map((l) => `${l.kind} ${l.detail}`).join("; ")}` };
      return { ok: true, license: sl };
    },
    dungMa: (licenseId, machine, keyId, opts) => xepHang(async () => {
      const ghiDe = opts?.ghiDe === true;
      const i = dong.findIndex((x) => x.licenseId === licenseId && x.thuHoiLuc === undefined
        && (ghiDe ? x.daDungLuc !== undefined && x.dungOMay === machine : x.daDungLuc === undefined));
      if (i < 0) return false;
      const t = { ...(dong[i] as DongKichHoat), daDungLuc: ghiDe ? (dong[i] as DongKichHoat).daDungLuc : now().toISOString(), dungOMay: machine as MachineId, keyId };
      const ban = dong.map((d, k) => (k === i ? t : d));
      await ghiXuong(ban, ghimBen);
      dong = ban;
      return true;
    }),
    traLaiMa: (licenseId) => xepHang(async () => {
      const i = dong.findIndex((x) => x.licenseId === licenseId && x.daDungLuc !== undefined && x.thuHoiLuc === undefined);
      if (i < 0) return false;
      const t: DongKichHoat = { ...(dong[i] as DongKichHoat), daDungLuc: undefined, dungOMay: undefined, keyId: undefined };
      const ban = dong.map((d, k) => (k === i ? t : d));
      await ghiXuong(ban, ghimBen);
      dong = ban;
      return true;
    }),
    thuHoiMa: (licenseId, lyDo) => xepHang(async () => {
      const i = dong.findIndex((x) => x.licenseId === licenseId && x.thuHoiLuc === undefined);
      if (i < 0) return false;
      const t = { ...(dong[i] as DongKichHoat), thuHoiLuc: now().toISOString(), thuHoiViSao: lyDo };
      const ban = dong.map((d, k) => (k === i ? t : d));
      await ghiXuong(ban, ghimBen);
      dong = ban;
      // Bao SAU khi da ghi; nguoi nghe nem khong duoc lam viec thu hoi that bai.
      for (const fn of nguoiNghe) {
        try { fn({ licenseId, tenant: t.tenant, keyId: t.keyId, lyDo }); } catch { /* xem tren */ }
      }
      return true;
    }),
    khiThuHoi(fn) {
      nguoiNghe.add(fn);
      return () => { nguoiNghe.delete(fn); };
    },
    kyGhim: (ghim, reason) => xepHang(async () => {
      const giong = ghimBen.ghim.length === ghim.length && ghimBen.ghim.every((g, i) => g === ghim[i]);
      if (!giong) {
        const moi: BoDemGhim = { seq: ghimBen.seq + 1, ghim: [...ghim] };
        await ghiXuong(dong, moi);   // so len dia TRUOC khi ky: khoi dong lai khong cap lai so cu
        ghimBen = moi;
      }
      return { seq: ghimBen.seq, signature: kyChuoi(khoaKy.privateKeyPem, chuoiDeKyGhim({ ghim, reason, seq: ghimBen.seq })) };
    }),
    soGhim: () => ghimBen.seq,
    async giayPhepCua(tenant) {
      const d = dangDung(tenant);
      return d === undefined ? null : { ...d.license, payload: { ...d.license.payload, modules: [...d.license.payload.modules] } };
    },
    async congCuCua(tenant, now2 = now()) {
      const d = dangDung(tenant);
      return d === undefined ? [] : enabledTools(d.license.payload, now2);
    },
    async lietKe(tenant) {
      return dong.filter((d) => d.tenant === tenant).map((d) => ({ ...d, license: { ...d.license, payload: { ...d.license.payload } } }));
    },
    khoaCongKy: () => [khoaKy.publicKeyPem]
  };
}

function sinhKhoaKy(): KhoaKy {
  const k = sinhKhoaMay();
  return { keyId: keyIdCuaKhoaCong(k.publicKeyPem), privateKeyPem: k.privateKeyPem, publicKeyPem: k.publicKeyPem };
}

/** Ban trong bo nho — bai thu va may chu thu nghiem. Khoi dong lai la quen het (ke ca khoa ky). */
export function khoKichHoatTrongBoNho(now: () => Date = () => new Date()): KhoKichHoat {
  return dungKho(sinhKhoaKy(), [], { seq: 0, ghim: [] }, async () => undefined, now);
}

const BAN_TEP = 1;

function docBoDemGhim(value: unknown, tep: string): BoDemGhim {
  const o = value as { ghimBen?: unknown };
  if (o.ghimBen === undefined) return { seq: 0, ghim: [] };
  const g = o.ghimBen as { seq?: unknown; ghim?: unknown };
  if (typeof g.seq !== "number" || !Number.isSafeInteger(g.seq) || g.seq < 0 || !Array.isArray(g.ghim) || !g.ghim.every((x) => typeof x === "string")) {
    throw new Error(`So ma kich hoat "${tep}" hong: 'ghimBen' sai hinh dang.`);
  }
  return { seq: g.seq, ghim: [...(g.ghim as string[])] };
}

function docDong(value: unknown, tep: string): DongKichHoat[] {
  const loi = (vi: string): Error => new Error(`So ma kich hoat "${tep}" hong: ${vi}`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw loi("khong phai mot doi tuong.");
  const o = value as { v?: unknown; ma?: unknown };
  if (o.v !== BAN_TEP) throw loi(`ban tep ${String(o.v)}, ben nay doc ban ${BAN_TEP}.`);
  if (!Array.isArray(o.ma)) throw loi("'ma' phai la mot mang.");
  const ra: DongKichHoat[] = [];
  const daThay = new Set<string>();
  for (const d of o.ma as unknown[]) {
    if (d === null || typeof d !== "object") throw loi("mot dong khong phai doi tuong.");
    const r = d as Record<string, unknown>;
    for (const f of ["licenseId", "tenant", "capLuc", "hetHanMa"]) {
      if (typeof r[f] !== "string" || r[f] === "") throw loi(`dong thieu '${f}'.`);
    }
    const licenseId = r["licenseId"] as string;
    if (daThay.has(licenseId)) throw loi(`licenseId "${licenseId}" xuat hien hai lan.`);
    daThay.add(licenseId);
    // Soi giay phep bang chinh bo giai ma cua ban giao keo (chan ca "PRIVATE KEY").
    const giai = giaiMaMaKichHoat(`SPK1.${Buffer.from(JSON.stringify(r["license"] ?? null), "utf8").toString("base64url")}`);
    if (!giai.ok) throw loi(`dong "${licenseId}": ${giai.reason}`);
    if (giai.license.licenseId !== licenseId || giai.license.payload.tenant !== r["tenant"]) throw loi(`dong "${licenseId}" khong khop giay phep ben trong.`);
    const chuoiTuyChon = (f: string): string | undefined => (typeof r[f] === "string" ? (r[f] as string) : undefined);
    ra.push({
      licenseId, tenant: r["tenant"] as TenantId, capLuc: r["capLuc"] as string, hetHanMa: r["hetHanMa"] as string,
      daDungLuc: chuoiTuyChon("daDungLuc"), dungOMay: chuoiTuyChon("dungOMay") as MachineId | undefined,
      keyId: chuoiTuyChon("keyId"),
      thuHoiLuc: chuoiTuyChon("thuHoiLuc"), thuHoiViSao: chuoiTuyChon("thuHoiViSao"), license: giai.license
    });
  }
  return ra;
}

async function docTep(tep: string): Promise<string | null> {
  try { return await readFile(tep, "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
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
export async function khoKichHoatTrongTep(thuMuc: string, opts: TuyChonKhoKichHoatTep = {}): Promise<KhoKichHoat> {
  const now = opts.now ?? (() => new Date());
  const tepKhoa = join(thuMuc, TEP_KHOA_KY_XEON);
  const tepSo = join(thuMuc, TEP_KHO_KICH_HOAT);
  const khoaPem = await docTep(tepKhoa);
  const soChu = await docTep(tepSo);
  if (khoaPem === null && soChu !== null) {
    throw new Error(
      `Xeon co so ma "${tepSo}" nhung MAT KHOA KY "${tepKhoa}". Khong tu sinh khoa moi: moi ma da cap se thanh rac ` +
      "ma khong ai biet vi sao. Phuc hoi khoa tu ban sao luu, hoac xoa ca hai tep de bat dau lai VA cap lai ma cho khach."
    );
  }
  let khoaKy: KhoaKy;
  if (khoaPem === null) {
    if (opts.khoiTao !== true) {
      throw new Error(`Chua co khoa ky nao trong "${thuMuc}". Lan DAU dung Xeon thi goi voi khoiTao: true; Xeon da tung chay ma toi day la thu muc bi mat / chua mount.`);
    }
    khoaKy = sinhKhoaKy();
    await mkdir(thuMuc, { recursive: true });
    await ghiNguyenTu(tepKhoa, khoaKy.privateKeyPem, 0o600);
    // So ma RONG ghi ngay: tu day "co so ma ma mat khoa ky" la phat hien duoc, ke ca khi chua cap ma nao.
    await ghiNguyenTu(tepSo, JSON.stringify({ v: BAN_TEP, ma: [], ghimBen: { seq: 0, ghim: [] } }, null, 2), 0o600);
  } else {
    if (!/BEGIN PRIVATE KEY/.test(khoaPem)) throw new Error(`Tep khoa ky "${tepKhoa}" hong: khong phai khoa rieng PEM.`);
    let cong: string;
    try { cong = sinhKhoaMayTu(khoaPem); } catch (e) { throw new Error(`Tep khoa ky "${tepKhoa}" hong: ${String((e as Error)?.message ?? e)}`); }
    khoaKy = { keyId: keyIdCuaKhoaCong(cong), privateKeyPem: khoaPem, publicKeyPem: cong };
  }
  let banDau: DongKichHoat[] = [];
  let ghimBanDau: BoDemGhim = { seq: 0, ghim: [] };
  if (soChu !== null) {
    if (/PRIVATE KEY/.test(soChu)) throw new Error(`So ma kich hoat "${tepSo}" hong: mang KHOA RIENG — ai do da chep nham.`);
    let value: unknown;
    try { value = JSON.parse(soChu); } catch { throw new Error(`So ma kich hoat "${tepSo}" hong: khong phai JSON.`); }
    banDau = docDong(value, tepSo);
    ghimBanDau = docBoDemGhim(value, tepSo);
  }
  // So ma la MA CHUA DUNG (moi ma = mot token kich hoat trong 72 gio): 0600 nhu khoa ky.
  const ghiXuong: GhiXuong = async (dong, ghimBen) => {
    await ghiNguyenTu(tepSo, JSON.stringify({ v: BAN_TEP, ma: dong, ghimBen }, null, 2), 0o600);
  };
  const lech = banDau.filter((d) => d.license.keyId !== khoaKy.keyId);
  if (lech.length > 0) {
    (opts.ghi ?? (() => undefined))(`[kich-hoat] CANH BAO: ${lech.length} ma trong "${tepSo}" ky bang khoa KHAC khoa ky hien tai (${khoaKy.keyId}) — tep khoa ky hay so ma phuc hoi tu ban lech nhau; nhung ma nay se bi tu choi "chu ky khong phai cua Xeon nay".`);
  }
  return dungKho(khoaKy, banDau, ghimBanDau, ghiXuong, now);
}

/** Khoa cong khai (PEM SPKI) tu khoa rieng PEM. Tach ham de thong bao loi ro tep nao. */
function sinhKhoaMayTu(privateKeyPem: string): string {
  // `createPublicKey` doc duoc khoa rieng PKCS#8 va tra ve phan cong khai.
  const k = createPrivateKey(privateKeyPem);
  if (k.asymmetricKeyType !== "ed25519") throw new Error(`khoa ky phai la Ed25519, day la ${String(k.asymmetricKeyType)}.`);
  return createPublicKey(k).export({ type: "spki", format: "pem" }) as string;
}
