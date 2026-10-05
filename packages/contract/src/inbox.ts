/**
 * @file The SEND body of the landing's inbox (`POST /api/hop-thu/gui`) — what the brain may ask the
 * landing to send a customer. Field names are wire (Vietnamese): the landing reads them byte for byte.
 *
 * Giai đoạn 7 (25/09/2026), decided by the project owner: the LANDING sends everything that goes
 * WITH a reply (product cards, the order form, the foot-measuring guide, the AI greeting); Xeon only
 * DECIDES. Xeon therefore never composes a Messenger template itself: it names codes, passes the
 * `order.formLink` result through, sets two flags — and reads `ketQua.daGui` to learn what really went.
 *
 * Every field beyond `nguoi` + `chu` is optional; a body without them behaves exactly as before.
 */

/** One product card the brain asks for. `size` narrows the card to that size (price + "size 42"). */
export interface InboxCardRequest {
  ma: string;
  size?: string | undefined;
}

/** The order form attachment: the `order.formLink` output, passed through. */
export interface InboxOrderFormAttachment {
  url: string;
  loiMoi?: string | undefined;
  tieuDe?: string | undefined;
  phuDe?: string | undefined;
  anh?: string | undefined;
}

export interface InboxSendBody {
  /** Channel (`facebook` default, `facebook-binh-luan`, `zalo`, `fb-ca-nhan`). */
  kenh?: string | undefined;
  nguoi: string;
  chu: string;
  /** Comment channel: the comment the reply goes under. */
  traLoiTin?: string | undefined;
  /** `<kênh>:<người>` — so the landing finds the thread and its page directly. */
  maHoiThoai?: string | undefined;
  /** Messenger only: an image (public https) — the text goes first. */
  anhUrl?: string | undefined;
  /** Product cards: image + price ("từ …" when sizes differ) + size range + "Xem chi tiết". At most 2 per turn; a code sent within 6 h is skipped. */
  theSanPham?: InboxCardRequest[] | undefined;
  /** Filter link (https): sent INSTEAD of cards when >= 3 codes are asked and >= 3 of them are in stock. */
  linkLoc?: string | undefined;
  /** The order form card ("Đặt đơn ngay"), from `order.formLink`. */
  phieuDatHang?: InboxOrderFormAttachment | undefined;
  /** The foot-measuring guide picture the landing keeps; at most once per 20 h per conversation. */
  anhHuongDan?: "do-chan" | undefined;
  /** Prepend the AI greeting; the landing sends it once per conversation (`conversation.recent` -> `hoiThoai.daChaoAi`). */
  chaoAi?: boolean | undefined;
  /**
   * 05/10/2026: a person on duty pressed "bot trả lời tiếp" for this conversation. Without it the landing
   * DROPS a brain reply when a person wrote, or typed, after the customer's last message (`nhuongNguoi`).
   */
  tiepQuan?: boolean | undefined;
  /**
   * 05/10/2026 (phiếu Desk "chống gửi trùng", "tin khách đến trong lúc AI chạy"): the newest customer message
   * (`maTin`) the turn had seen when it started. The landing drops the reply when a customer message came after
   * it (`tinMoi`), or when that message was already answered (`daTraLoi`) and this is not the one correction.
   * Absent = not judged (older brains, public comments).
   */
  theoTin?: string | undefined;
  /** 05/10/2026 (phiếu Desk "lượt trước đã gửi câu gì"): what this reply rests on — the landing keeps it to allow one correction. */
  bangChung?: InboxReplyEvidence | undefined;
}

/** What a brain reply rests on. A WEAK reply (`yeu`) may be corrected once by a later turn with stronger evidence. */
export interface InboxReplyEvidence {
  /** The reply asks the customer back, or the customer's photo named no product. */
  yeu: boolean;
  /** Customer photos the turn really read. */
  soAnh: number;
  /** The turn had product facts (a lookup found the item). */
  suThat: boolean;
}

/** Why the landing dropped a card the brain asked for. */
export type InboxCardSkipReason = "da-gui-6h" | "khong-thay-ma" | "qua-so-the" | "trung-phieu" | "thay-bang-link";

/** `ketQua.daGui` in the reply of `/api/hop-thu/gui` — present only when the body asked for extras. */
export interface InboxSentExtras {
  /** Codes whose card went out this turn. */
  the: string[];
  boQua: { ma: string; lyDo: InboxCardSkipReason }[];
  linkLoc?: boolean | undefined;
  phieuDatHang?: boolean | undefined;
  anhHuongDan?: boolean | undefined;
  /** The greeting really went (false = already greeted before, or no greeting configured). */
  chaoAi?: boolean | undefined;
  /** Errors on extras (Meta refusals); the main text had already gone. */
  loi?: string[] | undefined;
}

/** The reply of `/api/hop-thu/gui`: sent now (Meta's fields spread in) or queued for the on-duty machine. */
export type InboxSendResult =
  | { guiNgay: true; daGui?: InboxSentExtras | undefined; chaoAi?: boolean | undefined; [meta: string]: unknown }
  | { guiNgay: false; xepHang: true; id: string; daGui?: InboxSentExtras | undefined; chaoAi?: boolean | undefined }
  /** 05/10/2026: a person took this conversation over while the bot was writing — nothing was sent. */
  | { guiNgay: false; nhuongNguoi: true }
  /** 05/10/2026: the customer wrote again after `theoTin` — nothing was sent; that message has its own turn. */
  | { guiNgay: false; tinMoi: true }
  /** 05/10/2026: `theoTin` was already answered and this reply is no correction — nothing was sent. */
  | { guiNgay: false; daTraLoi: true };
