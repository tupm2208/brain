// TIEN TREN DON — MOT GOC DUY NHAT.
//
// Ben he TopRun, cong thuc tien phai chep y het o BA repo va co han mot bai kiem tra
// so tung byte de canh chung. Day la vet seo dat nhat cua he cu.
// O nen tang nay tien chi co MOT hinh dang va MOT bo ham, nam trong ban giao keo.
// Moi noi khac (OMI, Brain, Storefront) doc ket qua, KHONG duoc tu suy dien lai.

/** Tien Viet, don vi dong, luon la so nguyen. Khong dung so thap phan cho tien. */
export type Money = number;

export interface MoneyOnOrder {
  /** Tong tien khach phai tra cho don. */
  total: Money;
  /** Da tra bao nhieu (chuyen khoan + coc). */
  paid: Money;
  /** Con phai tra. Luon = max(0, total - paid). Khong ai duoc tu tinh lai. */
  remaining: Money;
  /** Phan thu ho khi giao (COD). Bang remaining neu don giao COD, nguoc lai 0. */
  cod: Money;
}

function toInt(v: unknown): Money {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Chuan hoa tien cua mot don. Server phai goi ham nay TRUOC khi tra don ra ngoai;
 * client chi doc, cam tu suy dien tu trang thai thanh toan.
 */
export function moneyOnOrder(input: {
  total: unknown;
  paid?: unknown;
  isCod?: boolean;
}): MoneyOnOrder {
  const total = Math.max(0, toInt(input.total));
  const paid = Math.max(0, toInt(input.paid ?? 0));
  const remaining = Math.max(0, total - paid);
  return { total, paid, remaining, cod: input.isCod === true ? remaining : 0 };
}

/** Da tra du chua. Dung ham nay thay vi so `paid === total` — tranh lech vi lam tron. */
export function isSettled(m: MoneyOnOrder): boolean {
  return m.remaining <= 0;
}

/** Hien cho nguoi doc: "3.190.000 d". Khong dung cho tinh toan. */
export function formatMoney(v: Money): string {
  return `${Math.round(v).toLocaleString("vi-VN")} đ`;
}

/**
 * Tien viet cho KHACH DOC: `3190000` -> `"3.190.000đ"`.
 *
 * Mot goc duy nhat, y nhu `moneyOnOrder`: cho nao doc so tien cho khach cung phai di
 * qua day. Hai cho tu dinh dang lay la hai cach viet khac nhau trong cung mot cau.
 *
 * KHONG dung `Intl.NumberFormat`: no phu thuoc vao bo ngon ngu cai tren may khach, va
 * cung mot ban OMI se hien hai kieu tren hai may. Dau nghin la dau CHAM, dung tap quan
 * Viet Nam — va dung dang ma `scanNumbers` doc lai duoc thanh dung con so cu.
 */
export function dinhDangTien(v: Money): string {
  // Khong phai so thi tra ve RONG de cong "o rong" bat lai. In ra "NaNđ" la mot cau
  // khong co con so nao de cong chong bia so soi, ma o thay the lai khong rong.
  if (!Number.isFinite(v)) return "";
  const so = Math.trunc(Math.abs(v));
  const nhom = String(so).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "-" : ""}${nhom}đ`;
}
