import type { MachineId, TenantId } from "./ids";
export interface CapKhoaMay {
    keyId: string;
    /** PEM PKCS#8 — chi luu tren may shop. */
    privateKeyPem: string;
    /** PEM SPKI — Xeon luu theo keyId. */
    publicKeyPem: string;
}
/** Sinh mot cap khoa may moi. Goi luc kich hoat, MOT lan cho moi may. */
export declare function sinhKhoaMay(): CapKhoaMay;
/**
 * Chuoi duoc ky trong khung `hello`. Ghi o MOT cho de hai dau day khong troi khoi nhau:
 * `${nonce}.${tenant}.${machine}.${contract}` — dung nhu chu thich trong `link.ts`.
 */
export declare function chuoiDeKy(args: {
    nonce: string;
    tenant: TenantId;
    machine: MachineId;
    contract: string;
}): string;
/** Ky bang khoa rieng, tra ve base64. */
export declare function kyChuoi(privateKeyPem: string, chuoi: string): string;
/** Kiem chu ky bang khoa cong khai. Khoa hong hay chu ky hong deu la SAI, khong nem. */
export declare function kiemChuKy(publicKeyPem: string, chuoi: string, chuKyB64: string): boolean;
/** Nonce cho khung `challenge`: 32 byte ngau nhien, hex. */
export declare function sinhNonce(): string;
//# sourceMappingURL=khoa-may.d.ts.map