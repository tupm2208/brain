export declare const TIEN_TO_GHIM = "sha256/";
/** Chung chi tu ky song bao nhieu ngay neu khong noi khac. Han chi la ve sinh (xem dau tep). */
export declare const HIEU_LUC_NGAY_MAC_DINH = 3650;
export interface ChungChiTuKy {
    /** PEM "CERTIFICATE" — dua cho `tls.createServer`. Khong co gi bi mat trong nay. */
    certPem: string;
    /** PEM PKCS#8 — chi nam tren Xeon. */
    privateKeyPem: string;
    /** `sha256/<base64 cua SHA-256(SPKI)>` — thu OMI ghim. */
    ghim: string;
    /** ISO 8601. */
    hetHan: string;
}
export interface TuyChonSinhChungChi {
    /** Ten may chu (hostname hoac IPv4) — vao CN va SAN. 1-64 ky tu `A-Za-z0-9.-`. */
    ten: string;
    /** Dung lai khoa cu (gia han): PEM PKCS#8 Ed25519. Bo trong = sinh khoa moi. */
    privateKeyPem?: string | undefined;
    tuLuc?: Date | undefined;
    hieuLucNgay?: number | undefined;
}
/**
 * Sinh chung chi X.509 v3 tu ky bang Ed25519. Khong can openssl.
 * Gia han = goi lai voi `privateKeyPem` cu: ghim giu nguyen, chi so se-ri va han doi.
 */
export declare function sinhChungChiTuKy(opts: TuyChonSinhChungChi): ChungChiTuKy;
/**
 * Ghim cua mot chung chi (PEM hoac DER): SHA-256 cua SubjectPublicKeyInfo, base64.
 * Cung so voi `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`.
 */
export declare function ghimCuaChungChi(chungChi: string | Buffer): string;
/** Dung dang `sha256/<base64 32 byte>`. Moi thu khac — ke ca chuoi rong — la sai. */
export declare function laGhimHopLe(ghim: unknown): ghim is string;
//# sourceMappingURL=chung-chi.d.ts.map