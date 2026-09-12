import type { MachineId, TenantId } from "./ids";
import { type ModuleId } from "./modules";
import { type ToolName } from "./tools";
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
export declare function canonicalLicenseJSON(p: LicensePayload): string;
export interface LicenseIssue {
    kind: "unknown_module" | "expired" | "not_yet_valid" | "bad_date";
    detail: string;
}
/**
 * Soi giay phep truoc khi dung. Truoc day cac id manh la bi NUOT im lang:
 * khach tra tien manh Van chuyen, go sai mot chu trong giay phep, bot lang le
 * khong co cong cu tra van don va khong ai biet vi sao.
 */
export declare function licenseIssues(license: LicensePayload, now?: Date): LicenseIssue[];
export declare function isExpired(license: LicensePayload, now?: Date): boolean;
/** Danh sach manh thuc su bat: nhung gi khai trong giay phep, cong ba manh loi. */
export declare function enabledModules(license: LicensePayload): ModuleId[];
export declare function isModuleEnabled(license: LicensePayload, id: ModuleId): boolean;
/**
 * Cong cu BOT duoc phep goi voi giay phep nay. Bo nao dung ham nay de dung
 * danh sach cong cu gui trong khung `welcome`.
 *
 * Hai luat cung nam o day:
 *  - Manh tat thi cong cu KHONG TON TAI voi bot (cai bay so 3 trong ban dac ta).
 *  - Giay phep het han thi tra ve RONG — "Bo nao tu choi phuc vu neu het han thue".
 *    Truoc day ham nay khong xem han dung, giay phep het tu 2020 van duoc du cong cu.
 */
export declare function enabledTools(license: LicensePayload, now?: Date): ToolName[];
//# sourceMappingURL=license.d.ts.map