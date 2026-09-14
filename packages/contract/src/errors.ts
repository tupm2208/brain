/**
 * @file Shared error codes.
 *
 * Callers branch on `code` and NEVER on the text of `message`. That rule is a lesson from the
 * legacy fallback gate, which matched error strings and broke whenever a message was reworded.
 */

export const ERROR_CODES = [
  /** The link to the merchant server is down (machine off, network dropped). */
  "omi_offline",
  /** The module is not enabled by the licence. */
  "module_disabled",
  /** The tool does not exist, or belongs to a module that is switched off. */
  "tool_unknown",
  /** The input has the wrong shape. */
  "bad_input",
  /** The caller (staff, or the bot itself) lacks the right. */
  "forbidden",
  /** The record was not found. */
  "not_found",
  /** The licence expired or was revoked. */
  "license_invalid",
  /** The client build is too old for the brain; refusing is safer than answering wrongly. */
  "version_too_old",
  /** Too many calls within the window. */
  "rate_limited",
  /** Unexpected failure. */
  "internal"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Error shape carried across the wire between the brain and the merchant server. */
export interface LinkError {
  code: ErrorCode;
  /** Readable for operators. Never forwarded verbatim to end customers. */
  message: string;
  /** Extra data for logs. Must not contain customer personal data. */
  detail?: Record<string, string | number | boolean>;
}

export function linkError(
  code: ErrorCode,
  message: string,
  detail?: Record<string, string | number | boolean>
): LinkError {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
