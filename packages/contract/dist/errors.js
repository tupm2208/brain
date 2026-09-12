"use strict";
// Ma loi dung chung. Nhanh theo `code`, KHONG bao gio so khop chuoi `message` —
// day la bai hoc tu ai_fallback_gate ben he cu.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CODES = void 0;
exports.linkError = linkError;
exports.isErrorCode = isErrorCode;
exports.ERROR_CODES = [
    /** Duong noi OMI toi day chua san sang (may shop tat, rot mang). */
    "omi_offline",
    /** Mang le hoac may khong duoc bat trong ma kich hoat. */
    "module_disabled",
    /** Cong cu khong ton tai, hoac khong thuoc mang le dang bat. */
    "tool_unknown",
    /** Du lieu vao sai hinh dang. */
    "bad_input",
    /** Nguoi goi khong du quyen (nhan vien, hoac chinh con bot). */
    "forbidden",
    /** Khong tim thay ban ghi. */
    "not_found",
    /** Ma kich hoat het han hoac bi thu hoi. */
    "license_invalid",
    /** Ban OMI qua cu so voi Bo nao — tu choi phuc vu con hon tra loi sai. */
    "version_too_old",
    /** Vuot han muc goi trong mot khoang thoi gian. */
    "rate_limited",
    /** Loi khong doan truoc duoc. */
    "internal"
];
function linkError(code, message, detail) {
    return detail === undefined ? { code, message } : { code, message, detail };
}
function isErrorCode(v) {
    return typeof v === "string" && exports.ERROR_CODES.includes(v);
}
//# sourceMappingURL=errors.js.map