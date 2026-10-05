/**
 * @file KHÁCH ĐANG CÓ ĐƠN (05/10/2026, phiếu Desk "khách đã có đơn bot bán lại").
 *
 * Nguyên tắc chung: khi hội thoại đã gắn chắc với một đơn còn chạy, mọi tầng trả lời phải biết đơn đó
 * và không bán lại món đã nằm trong đơn; đơn đã kết thúc chỉ là thông tin, không khoá việc bán.
 *
 * Bộ não KHÔNG tự suy giai đoạn đơn: landing tính từ trạng thái đơn + vận đơn + hạn đơn treo shop khai
 * (`order-stage.ts` bên landing) và gửi qua `conversation.recent` → `hoiThoai.donCuaHoiThoai`. Ở đây chỉ:
 *   - tách đơn đang chạy / đã kết thúc;
 *   - dựng khối "ĐƠN ĐANG CHẠY" cho mọi mô hình (LLM#1, agent, LLM#3) bằng câu chữ của
 *     `ghi-chu-he-thong.json` (khối `DON_DANG_CHAY`, `DON_CU`, nhãn `GIAI_DOAN.*`);
 *   - mã món đã đặt, để phần gửi kèm và cổng soát so theo MÃ (không theo tên: nhiều mã khác màu
 *     trùng tên).
 * Hàm thuần, không mô hình, không mạng.
 */

import type { LinkedOrderBrief } from "@sp/contract";
import { fillText } from "./fill-text";

/** Mã món để so: chữ hoa, bỏ mọi ký tự không phải chữ / số ("JQ-7704" = "jq7704"). */
export function itemKey(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Đơn còn chạy (landing nói chưa kết thúc). */
export function runningOrders(orders: readonly LinkedOrderBrief[] | undefined): LinkedOrderBrief[] {
  return (orders ?? []).filter((o) => o && o.giaiDoan !== "da_ket_thuc");
}

/** Đơn đã kết thúc (giao xong, huỷ, hoàn, quá hạn shop khai). */
export function finishedOrders(orders: readonly LinkedOrderBrief[] | undefined): LinkedOrderBrief[] {
  return (orders ?? []).filter((o) => o && o.giaiDoan === "da_ket_thuc");
}

/** Mã (đã chuẩn hoá) của mọi món trong các đơn đang chạy. */
export function orderedItemKeys(orders: readonly LinkedOrderBrief[] | undefined): Set<string> {
  return new Set(runningOrders(orders).flatMap((o) => o.mon.map((m) => itemKey(m.ma))).filter((k) => k !== ""));
}

/** Một đơn đang chạy có món này (so theo mã). */
export function isOrderedItem(orders: readonly LinkedOrderBrief[] | undefined, code: string): boolean {
  const key = itemKey(code);
  return key !== "" && orderedItemKeys(orders).has(key);
}

const money = (n: number): string => `${Math.round(Number(n) || 0).toLocaleString("vi-VN")}đ`;

/**
 * Khối ghi chú về đơn của hội thoại, "" khi không có đơn nào. `blocks` = khối của `ghi-chu-he-thong`
 * (đã ghép tầng 1 + ngành). Thiếu mẫu câu thì không có khối — không viết câu thay ở đây.
 */
export function renderOrderNote(orders: readonly LinkedOrderBrief[] | undefined, blocks: Readonly<Record<string, string>>): string {
  const label = (stage: string): string => blocks[`GIAI_DOAN.${stage}`] ?? stage;
  const items = (o: LinkedOrderBrief): string => o.mon.map((m) => fillText(blocks["DON_DANG_CHAY.mon"] ?? "{ten} ({ma}) size {size}", { ten: m.ten, ma: m.ma, size: m.size, sl: m.sl })).join("; ");
  const parts: string[] = [];
  const running = runningOrders(orders);
  const head = blocks["DON_DANG_CHAY"];
  if (running.length > 0 && head !== undefined && head !== "") {
    const lines = running.map((o) => fillText(blocks["DON_DANG_CHAY.dong"] ?? "", {
      maDon: o.maDon, giaiDoan: label(o.giaiDoan), mon: items(o),
      tong: money(o.tien.tong), daTra: money(o.tien.daTra), conLai: money(o.tien.conLai),
      vanDon: o.vanDonDong ? blocks["DON_DANG_CHAY.vanDonDong"] ?? ""
        : o.vanDon?.link ? fillText(blocks["DON_DANG_CHAY.vanDon"] ?? "", { ma: o.vanDon.ma, link: o.vanDon.link }) : ""
    }));
    const many = running.length > 1 ? fillText(blocks["DON_DANG_CHAY.nhieuDon"] ?? "", { so: running.length }) : "";
    parts.push(fillText(head, { danhSach: lines.join("\n"), nhieuDon: many }).trim());
  }
  const finished = finishedOrders(orders);
  const old = blocks["DON_CU"];
  if (finished.length > 0 && old !== undefined && old !== "") {
    const lines = finished.map((o) => fillText(blocks["DON_CU.dong"] ?? "", { maDon: o.maDon, mon: items(o), ketThuc: blocks[`KET_THUC.${o.ketThuc ?? ""}`] ?? o.ketThuc ?? "" }));
    parts.push(fillText(old, { danhSach: lines.join("\n") }).trim());
  }
  return parts.join("\n\n");
}
