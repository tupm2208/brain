/**
 * @file KHÔNG HỨA PHIẾU KHÔNG GỬI (05/10/2026, phiếu Desk "thẻ đặt hàng không đi khi khách chốt hoặc giục").
 *
 * Việc gửi phiếu đặt hàng do máy quyết (bộ gửi kèm + landing), câu chữ do mô hình viết — hai bên từng
 * lệch nhau: bot viết "em gửi phiếu bên dưới" mà phiếu không đi (khách chờ, đơn mất). Hàm này chạy SAU
 * khi landing đã trả lời lượt này (có link phiếu hay không), nên nó biết sự thật chứ không đoán:
 *   - phiếu đã đi → câu giữ nguyên;
 *   - phiếu không đi → câu HỨA phiếu bị cắt (mẫu `contact.formPromise`, tầng 1, ngành ghi đè được);
 *     lượt chốt cần người (phiếu bị chặn vì đơn đang chạy, shop chốt qua người, shop chưa khai cách chốt)
 *     → thêm câu báo người (`personNote`) và gọi người; chưa đủ món mà cắt xong không còn gì → hỏi món
 *     (`askItem`).
 * Hàm thuần: không đọc gì ngoài tham số. Không có từ khoá ngành nào ở đây.
 */

import type { ReplyGateContact } from "../pack/types";
import { fillText } from "./fill-text";
import { gateNormalize, hasLetters, splitSentences } from "./reply-rules/support";

export interface FormPromiseInput {
  /** The landing returned a form link for THIS turn and it rides with the reply. */
  formSent: boolean;
  /** The customer is closing and the order needs a person (form refused, the shop closes through a person, closing not declared). */
  personNeeded: boolean;
  /** `{khach}`, `{tenNguoiPhuTrach}`… for the notes. */
  vars: Readonly<Record<string, string>>;
}

export interface FormPromiseResult {
  reply: string;
  /** A promise of the form was cut. */
  cut: boolean;
  /** A person must be told (the customer wants to order and no form went). */
  callPerson: boolean;
}

function pattern(source: string): RegExp | null {
  if (source === "") return null;
  try { return new RegExp(source); } catch { return null; }
}

export function repairFormPromise(reply: string, cfg: Pick<ReplyGateContact, "formPromise" | "formNoteMarker" | "personNote" | "askItem">, input: FormPromiseInput): FormPromiseResult {
  if (input.formSent) return { reply, cut: false, callPerson: false };
  const promise = pattern(cfg.formPromise);
  const parts = splitSentences(reply);
  const kept = promise === null ? parts : parts.filter((part) => !promise.test(gateNormalize(part).toLowerCase()));
  if (kept.length === parts.length) return { reply, cut: false, callPerson: input.personNeeded };
  const marker = pattern(cfg.formNoteMarker);
  if (input.personNeeded) {
    const note = fillText(cfg.personNote, { ...input.vars });
    if (note !== "" && !kept.some((part) => marker?.test(gateNormalize(part).toLowerCase()) === true)) kept.push(note);
  } else if (!hasLetters(kept.join(" "))) {
    const ask = fillText(cfg.askItem, { ...input.vars });
    if (ask !== "") kept.push(ask);
  }
  return { reply: kept.join(" ").trim(), cut: true, callPerson: input.personNeeded };
}
