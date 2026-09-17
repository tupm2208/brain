/**
 * @file What the shop taught the AI, turned into prompt text (Đ7).
 *
 * The landing answers `training.knowledge` with APPROVED items only (Q&A, rules, style examples,
 * fit notes, libraries, sample profiles) plus the external product settled on in this conversation.
 * This file only renders it. Three limits keep a shop with a big library from drowning the prompt:
 * items are capped per kind, each is cut short, and the whole block has a hard ceiling.
 *
 * The external-product block keeps Desk's wording (`external_product_kit.promptText`): the bot once
 * matched "Boston 12" typed by a customer who had settled on a hand-listed pair to a catalogue code
 * and sent the wrong price.
 */

import type { ToolOutput } from "@sp/contract";

export type TrainingKnowledge = ToolOutput<"training.knowledge">;

const MAX_CHARS = 9000;
const cut = (value: unknown, n: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);

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
  if (k.quyTac.length > 0) {
    parts.push(`QUY TAC SHOP DA DUYET (uu tien hon thoi quen cua mo hinh):\n${k.quyTac.slice(0, 20).map((r) => `- [${cut(r.loai, 20)}] ${cut(r.tieuDe, 80)}: ${cut(r.noiDung, 300)}`).join("\n")}`);
  }
  if (k.hoiDap.length > 0) {
    parts.push(`HOI DAP SHOP DA DUYET (dung y, dien lai gia/ton/size bang cong cu — KHONG chep so trong mau):\n${k.hoiDap.slice(0, 15).map((q) => `- (${cut(q.intent, 40)}) Khach: ${cut(q.cauHoi, 160)}\n  Shop: ${cut(q.traLoi, 300)}`).join("\n")}`);
  }
  if (k.cauMau.length > 0) {
    parts.push(`VI DU VAN PHONG SHOP (bat chuoc giong van, khong chep noi dung):\n${k.cauMau.slice(0, 6).map((e) => `- Khach: ${cut(e.cauKhach, 160)}\n  Shop: ${cut(e.traLoi, 300)}${e.lyDo ? `\n  Vi sao: ${cut(e.lyDo, 160)}` : ""}`).join("\n")}`);
  }
  if (k.kienThuc.length > 0) {
    parts.push(`GHI CHU FIT THEO MAU (kinh nghiem thuc te cua shop):\n${k.kienThuc.slice(0, 12).map((f) => `- ${cut(f.ma, 20)} ${cut(f.ten, 60)}: form ${cut(f.form, 60)}; hop ${cut(f.phuHop, 80)}; size ${cut(f.tuVanSize, 80)}${f.luuY ? `; luu y ${cut(f.luuY, 80)}` : ""}`).join("\n")}`);
  }
  if (k.thuVien.length > 0) {
    parts.push(`KIEN THUC LIEN QUAN:\n${k.thuVien.slice(0, 3).map((l) => `## ${cut(l.ten, 80)} (dung khi: ${l.dungKhi.slice(0, 6).map((w) => cut(w, 30)).join(", ")})\n${String(l.noiDung ?? "").slice(0, 2000)}`).join("\n\n")}`);
  }
  if (k.hoSoMau.length > 0) {
    parts.push(`HO SO KHACH MAU (de hieu kieu khach cua shop, KHONG phai khach dang chat):\n${k.hoSoMau.slice(0, 5).map((p) => `- ${cut(p.ten, 40)}: ${cut(p.tomTat, 200)}`).join("\n")}`);
  }
  const text = parts.join("\n\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n(…da cat bot)` : text;
}
