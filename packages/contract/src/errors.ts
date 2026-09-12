// Ma loi dung chung. Nhanh theo `code`, KHONG bao gio so khop chuoi `message` —
// day la bai hoc tu ai_fallback_gate ben he cu.

export const ERROR_CODES = [
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface LinkError {
  code: ErrorCode;
  /** Cau doc duoc cho nguoi van hanh. KHONG dua thang cho khach hang cuoi. */
  message: string;
  /** Du lieu phu de dua vao nhat ky. Khong duoc chua thong tin ca nhan cua khach. */
  detail?: Record<string, string | number | boolean>;
}

export function linkError(
  code: ErrorCode,
  message: string,
  detail?: Record<string, string | number | boolean>
): LinkError {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && (ERROR_CODES as readonly string[]).includes(v);
}
