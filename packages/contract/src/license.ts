// MA KICH HOAT.
//
// Anh chot 09/09: MOT ban cai duy nhat chua tat ca manh; ma kich hoat quyet dinh manh nao bat.
// Cai "dong goi rieng" ma khach cam nhan nam o ma, khong nam o tep cai.
//
// Luat quan trong (Phan 17): kiem giay phep o MAY CHU, khong o may khach. Moi doan ma
// kiem ban quyen nam trong app deu bi vo hieu trong mot gio. File nay mo ta hinh dang
// giay phep VA cung cap cac ham ma Bo nao dung de quyet dinh — noi quyet dinh that su
// la Bo nao, khong phai OMI.

import type { MachineId, TenantId } from "./ids";
import { MODULES, CORE_MODULE_IDS, type ModuleId, isModuleId } from "./modules";
import { TOOLS, TOOL_NAMES, type ToolName } from "./tools";

export interface LicensePayload {
  tenant: TenantId;
  /** Ten nha ban hang, de hien trong app. */
  tenantName: string;
  machine: MachineId;
  /** Bo luat nganh khach nay dung. Ban theo nganh thi giay phep phai noi ro nganh nao. */
  packId: string;
  /** Manh duoc bat. Ba manh loi luon duoc them vao du co khai hay khong. */
  modules: ModuleId[];
  /** So tai khoan nhan vien toi da. 0 = khong gioi han. */
  seats: number;
  /** Han dung, dang ISO. Het han thi Bo nao ngung phuc vu. */
  expiresAt: string;
  /** Ban giao keo toi thieu ma OMI phai dat — de tu choi ban qua cu. */
  minContract: string;
  issuedAt: string;
}

/** Giay phep da ky. Chu ky do Xeon cap; may khach chi mang di, khong tu tao duoc. */
export interface SignedLicense {
  payload: LicensePayload;
  /**
   * Chu ky so cua payload (base64).
   * QUY UOC KY: tuan tu hoa payload bang JSON voi KHOA SAP XEP TANG DAN va khong khoang trang
   * (`canonicalLicenseJSON`), roi ky chuoi UTF-8 do. Hai ben khong dung chung quy uoc nay
   * thi chu ky dung van bi coi la sai.
   */
  signature: string;
  /** Khoa nao da ky — de xoay khoa ma khong lam hong giay phep cu. */
  keyId: string;
  /** Ma giay phep, de thu hoi tung cai ma khong phai xoay khoa. */
  licenseId: string;
}

/** Tuan tu hoa chuan de ky va de xac minh. Dung DUNG ham nay o ca hai phia. */
export function canonicalLicenseJSON(p: LicensePayload): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(p).sort()) {
    ordered[key] = (p as unknown as Record<string, unknown>)[key];
  }
  // `modules` la mang: sap xep de thu tu khai khong lam doi chu ky.
  if (Array.isArray(ordered["modules"])) {
    ordered["modules"] = [...(ordered["modules"] as string[])].sort();
  }
  return JSON.stringify(ordered);
}

export interface LicenseIssue {
  kind: "unknown_module" | "expired" | "not_yet_valid" | "bad_date";
  detail: string;
}

/**
 * Soi giay phep truoc khi dung. Truoc day cac id manh la bi NUOT im lang:
 * khach tra tien manh Van chuyen, go sai mot chu trong giay phep, bot lang le
 * khong co cong cu tra van don va khong ai biet vi sao.
 */
export function licenseIssues(license: LicensePayload, now: Date = new Date()): LicenseIssue[] {
  const out: LicenseIssue[] = [];
  for (const id of license.modules) {
    if (!isModuleId(id)) out.push({ kind: "unknown_module", detail: String(id) });
  }
  const exp = Date.parse(license.expiresAt);
  const iss = Date.parse(license.issuedAt);
  if (!Number.isFinite(exp)) out.push({ kind: "bad_date", detail: `expiresAt="${license.expiresAt}"` });
  else if (exp <= now.getTime()) out.push({ kind: "expired", detail: license.expiresAt });
  if (!Number.isFinite(iss)) out.push({ kind: "bad_date", detail: `issuedAt="${license.issuedAt}"` });
  else if (iss > now.getTime()) out.push({ kind: "not_yet_valid", detail: license.issuedAt });
  return out;
}

export function isExpired(license: LicensePayload, now: Date = new Date()): boolean {
  const t = Date.parse(license.expiresAt);
  return !Number.isFinite(t) || t <= now.getTime();
}

/** Danh sach manh thuc su bat: nhung gi khai trong giay phep, cong ba manh loi. */
export function enabledModules(license: LicensePayload): ModuleId[] {
  const set = new Set<ModuleId>(CORE_MODULE_IDS);
  for (const id of license.modules) {
    if (isModuleId(id)) set.add(id);
  }
  return [...set];
}

export function isModuleEnabled(license: LicensePayload, id: ModuleId): boolean {
  return MODULES[id].core || license.modules.includes(id);
}

/**
 * Cong cu BOT duoc phep goi voi giay phep nay. Bo nao dung ham nay de dung
 * danh sach cong cu gui trong khung `welcome`.
 *
 * Hai luat cung nam o day:
 *  - Manh tat thi cong cu KHONG TON TAI voi bot (cai bay so 3 trong ban dac ta).
 *  - Giay phep het han thi tra ve RONG — "Bo nao tu choi phuc vu neu het han thue".
 *    Truoc day ham nay khong xem han dung, giay phep het tu 2020 van duoc du cong cu.
 */
export function enabledTools(license: LicensePayload, now: Date = new Date()): ToolName[] {
  if (isExpired(license, now)) return [];
  const on = new Set<ModuleId>(enabledModules(license));
  return TOOL_NAMES.filter((name) => TOOLS[name].audience === "bot" && on.has(TOOLS[name].module));
}
