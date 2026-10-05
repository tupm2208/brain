/**
 * @file The shop's context for this conversation, turned into prompt text (Đ7, cut 02/10/2026).
 *
 * The landing answers `training.knowledge` with the external product settled on in this conversation
 * and whether partner goods are paused. The Training AI lists the tool used to carry (Q&A, rules,
 * style examples, fit notes, libraries, sample customers) are no longer read: they were empty on every
 * landing, they reached the prompt as raw text whatever their "kind", and a style example reached it
 * without approval. What the shop wants the bot to know lives in the profile now (`cauHoiRieng`,
 * `quyTrinhRieng` — rendered by `renderProfile`).
 *
 * The external-product block keeps Desk's wording (`external_product_kit.promptText`): the bot once
 * matched "Boston 12" typed by a customer who had settled on a hand-listed pair to a catalogue code
 * and sent the wrong price.
 */

import type { ToolOutput } from "@sp/contract";

export type TrainingKnowledge = ToolOutput<"training.knowledge">;

export function renderKnowledge(k: TrainingKnowledge | null): string {
  if (k === null) return "";
  const parts: string[] = [];
  if (k.spNgoai) {
    const p = k.spNgoai;
    parts.push([
      `SAN PHAM NGOAI HE THONG — KHACH DA CHOT (shop tu nhap tay, KHONG co trong kho web): ${[p.ma, p.ten].filter(Boolean).join(" ")}${p.size ? ` — size ${p.size}` : ""}${p.gia ? ` — gia ${p.gia.toLocaleString("vi-VN")}d` : ""}.`,
      "LUAT BAT BUOC cho mon nay: (1) khach nhac ten gan giong thi hieu la CHINH MON NAY, KHONG doi sang ma catalog trung ten, KHONG bao gia/ton cua ma khac; (2) gia chi co MOT: gia da ghi o tren; (3) KHONG gui phieu dat hang cho mon nay — chi xin ten/SDT/dia chi va huong dan CK/COD.",
      "Khach van duoc tu van mau KHAC binh thuong neu CHINH KHACH neu mau/nhu cau moi."
    ].join("\n"));
  }
  if (k.cauHinh.tatHangDoiTac) parts.push("SHOP DANG TAM DUNG HANG DOI TAC: chi tu van hang co san trong kho cua shop; hang order/doi tac thi noi se kiem tra roi bao lai.");
  return parts.join("\n\n");
}
