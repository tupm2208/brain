export declare const ERROR_CODES: readonly ["omi_offline", "module_disabled", "tool_unknown", "bad_input", "forbidden", "not_found", "license_invalid", "version_too_old", "rate_limited", "internal"];
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface LinkError {
    code: ErrorCode;
    /** Cau doc duoc cho nguoi van hanh. KHONG dua thang cho khach hang cuoi. */
    message: string;
    /** Du lieu phu de dua vao nhat ky. Khong duoc chua thong tin ca nhan cua khach. */
    detail?: Record<string, string | number | boolean>;
}
export declare function linkError(code: ErrorCode, message: string, detail?: Record<string, string | number | boolean>): LinkError;
export declare function isErrorCode(v: unknown): v is ErrorCode;
//# sourceMappingURL=errors.d.ts.map