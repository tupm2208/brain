// KHO KHOA MAY — dau Xeon giu khoa CONG KHAI cua tung may shop, theo `keyId`.
//
// Vi sao can mot kho chu khong phai mot ham: truoc moc nay `traKhoaMay` la ham do bai thu tu
// cap; may that khong co cho nao giu khoa, nen khong cap duoc, khong thu hoi duoc, va khoi
// dong lai la quen het. Ba luat cua kho:
//  1. CHI KHOA CONG KHAI. Khoa rieng sinh ra o day (Xeon cap luc kich hoat) nhung chi duoc
//     TRA VE mot lan cho OMI mang di — kho khong bao gio ghi no xuong. Tep kho co "PRIVATE KEY"
//     la tu choi mo: ai do da chep nham thu quy vao may chu.
//  2. MOT MAY, MOT KHOA SONG. Cap khoa moi cho cung (tenant, machine) la khoa cu bi thu hoi
//     ngay — shop kich hoat lai vi may bi mat thi ban OMI bi lay trom chet cung luc.
//  3. THU HOI la SU KIEN, khong chi la mot dong trong kho. May chu duong day nghe su kien do
//     de CAT phien dang song bang khoa vua bi thu hoi; khong thi ban bi lay trom van noi cho
//     toi luc dut day — co the la nhieu ngay.
//
// Ban trong tep: JSON mot tep, ghi nguyen tu (ghi tep tam, fsync, roi doi ten) de mat dien
// giua chung khong de lai tep nua chung. Tep hong thi MO THAT BAI — mo "thanh cong" voi kho
// rong la moi OMI bi khoa ngoai ma khong ai biet vi sao. Moi thay doi la GHI TEP TRUOC, doi
// bo nho SAU: ghi hong thi kho khong doi, khong co trang thai "bo nho mot dang, tep mot neo".
//
// Tep thuoc ve MOT tien trinh Xeon. Cap/thu hoi khoa phai di qua tien trinh dang giu tep
// (API quan tri cua Xeon), khong duoc mo tep bang mot CLI rieng: hai tien trinh cung mo la
// ban trong bo nho cua ben nay ghi de mat khoa ben kia vua cap. Khoa chong hai tien trinh
// la mon no ghi o SPEC.

import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createPublicKey, randomBytes } from "node:crypto";
import { sinhKhoaMay, type CapKhoaMay, type MachineId, type TenantId } from "@sp/contract";

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
  nhan(tenant: TenantId, machine: MachineId, publicKeyPem: string, opts?: { giuKhoaCu?: boolean | undefined }): Promise<{ keyId: string }>;
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

const LY_DO_THAY_KHOA = "thay khoa: may nay duoc cap khoa moi";

/** Khoa cong khai Ed25519 dang PEM SPKI, hoac NEM. Kiem TRUOC khi dong vao hang doi cua kho. */
function chotKhoaCong(pem: string): string {
  if (typeof pem !== "string" || /PRIVATE KEY/.test(pem)) throw new Error("Kho khoa chi nhan khoa CONG KHAI; day la khoa rieng (hay khong phai chuoi).");
  let k;
  try { k = createPublicKey(pem); } catch (e) { throw new Error(`Khoa cong khai khong doc duoc: ${String((e as Error)?.message ?? e)}`); }
  if (k.asymmetricKeyType !== "ed25519") throw new Error(`Khoa may phai la Ed25519, day la ${String(k.asymmetricKeyType)}.`);
  if (k.type !== "public") throw new Error("Kho khoa chi nhan khoa CONG KHAI.");
  return k.export({ type: "spki", format: "pem" }) as string;
}

interface GhiXuong { (dong: DongKhoKhoa[]): Promise<void> }

/** Bo may chung cho ca hai ban: bo nho la `ghiXuong` khong lam gi. */
function dungKho(banDau: DongKhoKhoa[], ghiXuong: GhiXuong, now: () => Date): KhoKhoaMay {
  // `dong` chi duoc GAN LAI sau khi ban moi da nam tren dia (copy-on-write).
  let dong: DongKhoKhoa[] = [...banDau];
  const nguoiNghe = new Set<(tin: ThuHoiKhoa) => void>();
  // Moi thay doi xep hang: hai lan `cap` cung luc khong duoc ghi de lan nhau tren tep.
  let hang: Promise<unknown> = Promise.resolve();
  const xepHang = <T>(viec: () => Promise<T>): Promise<T> => {
    const p = hang.then(viec, viec);
    hang = p.catch(() => undefined);
    return p;
  };
  const baoThuHoi = (d: DongKhoKhoa, lyDo: string): void => {
    for (const fn of nguoiNghe) {
      // Khoa DA thu hoi va DA nam tren dia; nguoi nghe nem khong duoc bien viec do thanh
      // that bai — nguoi goi se cap lai, thu hoi lai, mai.
      try { fn({ keyId: d.keyId, tenant: d.tenant, machine: d.machine, lyDo }); } catch { /* xem tren */ }
    }
  };
  const thuHoiTrenBan = (d: DongKhoKhoa, lyDo: string): DongKhoKhoa =>
    ({ ...d, thuHoiLuc: now().toISOString(), thuHoiViSao: lyDo });

  // Dung chung cho `cap` (Xeon sinh khoa) va `nhan` (OMI sinh khoa): ghi dong moi, thu hoi khoa
  // cu cua cung may, ghi tep TRUOC, bao thu hoi SAU.
  // `giuKhoaCu`: duong kich hoat — khoa cu chi bi thu hoi SAU khi kich hoat chac chan xong (`thuHoiKhac`);
  // thu hoi som la mot lan kich hoat bo do (han chao no) giet khoa dang song cua may.
  const themKhoa = (tenant: TenantId, machine: MachineId, keyId: string, publicKeyPem: string, giuKhoaCu = false): Promise<void> => xepHang(async () => {
    const cu: DongKhoKhoa[] = [];
    const ban = dong.map((d) => {
      if (giuKhoaCu || d.tenant !== tenant || d.machine !== machine || d.thuHoiLuc !== undefined) return d;
      const t = thuHoiTrenBan(d, LY_DO_THAY_KHOA);
      cu.push(t);
      return t;
    });
    ban.push({ keyId, tenant, machine, publicKeyPem, capLuc: now().toISOString() });
    await ghiXuong(ban);
    dong = ban;
    // Bao SAU khi da ghi xuong: ghi hong thi kho khong doi, va khong ai bi cat oan.
    for (const d of cu) baoThuHoi(d, LY_DO_THAY_KHOA);
  });

  return {
    async cap(tenant, machine) {
      const moi = sinhKhoaMay();
      await themKhoa(tenant, machine, moi.keyId, moi.publicKeyPem);
      return moi;
    },
    async nhan(tenant, machine, publicKeyPem, opts) {
      const pem = chotKhoaCong(publicKeyPem);
      const keyId = `k-${randomBytes(8).toString("hex")}`;
      await themKhoa(tenant, machine, keyId, pem, opts?.giuKhoaCu === true);
      return { keyId };
    },
    async tra(keyId) {
      const d = dong.find((x) => x.keyId === keyId && x.thuHoiLuc === undefined);
      return d === undefined ? null : { publicKeyPem: d.publicKeyPem, tenant: d.tenant, machine: d.machine };
    },
    thuHoi: (keyId, lyDo) => xepHang(async () => {
      const i = dong.findIndex((x) => x.keyId === keyId && x.thuHoiLuc === undefined);
      if (i < 0) return false;
      const t = thuHoiTrenBan(dong[i] as DongKhoKhoa, lyDo);
      const ban = dong.map((d, k) => (k === i ? t : d));
      await ghiXuong(ban);
      dong = ban;
      baoThuHoi(t, lyDo);
      return true;
    }),
    thuHoiKhac: (tenant, keyIdGiu, lyDo) => xepHang(async () => {
      const cu: DongKhoKhoa[] = [];
      const ban = dong.map((d) => {
        if (d.tenant !== tenant || d.keyId === keyIdGiu || d.thuHoiLuc !== undefined) return d;
        const t = thuHoiTrenBan(d, lyDo);
        cu.push(t);
        return t;
      });
      if (cu.length === 0) return [];
      await ghiXuong(ban);
      dong = ban;
      for (const d of cu) baoThuHoi(d, lyDo);
      return cu.map((d) => d.keyId);
    }),
    async lietKe(tenant) {
      return dong.filter((d) => d.tenant === tenant).map((d) => ({ ...d }));
    },
    khiThuHoi(fn) {
      nguoiNghe.add(fn);
      return () => { nguoiNghe.delete(fn); };
    }
  };
}

/** Ban trong bo nho — cho bai thu va cho may chu thu nghiem. Khoi dong lai la quen het. */
export function khoKhoaTrongBoNho(now: () => Date = () => new Date()): KhoKhoaMay {
  return dungKho([], async () => undefined, now);
}

const BAN_TEP = 1;

function docDong(value: unknown, tep: string): DongKhoKhoa[] {
  const loi = (vi: string): Error => new Error(`Kho khoa "${tep}" hong: ${vi}`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw loi("khong phai mot doi tuong.");
  const o = value as { v?: unknown; khoa?: unknown };
  if (o.v !== BAN_TEP) throw loi(`ban tep ${String(o.v)}, ben nay doc ban ${BAN_TEP}.`);
  if (!Array.isArray(o.khoa)) throw loi("'khoa' phai la mot mang.");
  const ra: DongKhoKhoa[] = [];
  const daThay = new Set<string>();
  const dangSong = new Set<string>();
  for (const d of o.khoa as unknown[]) {
    if (d === null || typeof d !== "object") throw loi("mot dong khong phai doi tuong.");
    const r = d as Record<string, unknown>;
    for (const f of ["keyId", "tenant", "machine", "publicKeyPem", "capLuc"]) {
      if (typeof r[f] !== "string" || r[f] === "") throw loi(`dong thieu '${f}'.`);
    }
    const pem = r["publicKeyPem"] as string;
    if (/PRIVATE KEY/.test(pem)) throw loi(`dong "${String(r["keyId"])}" mang KHOA RIENG — khoa rieng khong duoc nam tren Xeon.`);
    if (!/BEGIN PUBLIC KEY/.test(pem)) throw loi(`dong "${String(r["keyId"])}" khong mang khoa cong khai PEM.`);
    const keyId = r["keyId"] as string;
    if (daThay.has(keyId)) throw loi(`keyId "${keyId}" xuat hien hai lan.`);
    daThay.add(keyId);
    const thuHoiLuc = typeof r["thuHoiLuc"] === "string" ? r["thuHoiLuc"] : undefined;
    if (thuHoiLuc === undefined) {
      // Luat 2 (mot may mot khoa song) ap ca cho tep sua tay.
      const may = `${String(r["tenant"])}\u0000${String(r["machine"])}`;
      if (dangSong.has(may)) throw loi(`may ${String(r["tenant"])}/${String(r["machine"])} co HAI khoa cung song.`);
      dangSong.add(may);
    }
    ra.push({
      keyId, tenant: r["tenant"] as TenantId, machine: r["machine"] as MachineId,
      publicKeyPem: pem, capLuc: r["capLuc"] as string,
      thuHoiLuc,
      thuHoiViSao: typeof r["thuHoiViSao"] === "string" ? r["thuHoiViSao"] : undefined
    });
  }
  return ra;
}

/**
 * Ban trong tep JSON. Mo la doc het vao bo nho; moi thay doi ghi ca tep, nguyen tu.
 * Tep chua co thi bat dau rong (va tao thu muc cha). Tep co ma hong thi NEM.
 */
export async function khoKhoaTrongTep(tep: string, now: () => Date = () => new Date()): Promise<KhoKhoaMay> {
  let banDau: DongKhoKhoa[] = [];
  let chu: string | null = null;
  try {
    chu = await readFile(tep, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (chu !== null) {
    let value: unknown;
    try { value = JSON.parse(chu); } catch { throw new Error(`Kho khoa "${tep}" hong: khong phai JSON.`); }
    banDau = docDong(value, tep);
  } else {
    await mkdir(dirname(tep), { recursive: true });
  }
  const ghiXuong: GhiXuong = async (dong) => {
    const tam = `${tep}.tmp`;
    // fsync truoc khi doi ten: khong thi mat dien co the de lai tep 0 byte da mang ten that,
    // va Xeon khoi dong lai bi khoa ngoai toan bo shop cho toi khi co nguoi sua tay.
    const fh = await open(tam, "w");
    try {
      await fh.writeFile(JSON.stringify({ v: BAN_TEP, khoa: dong }, null, 2), "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tam, tep);
  };
  return dungKho(banDau, ghiXuong, now);
}
