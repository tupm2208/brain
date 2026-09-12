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
/**
 * Chuan hoa tien cua mot don. Server phai goi ham nay TRUOC khi tra don ra ngoai;
 * client chi doc, cam tu suy dien tu trang thai thanh toan.
 */
export declare function moneyOnOrder(input: {
    total: unknown;
    paid?: unknown;
    isCod?: boolean;
}): MoneyOnOrder;
/** Da tra du chua. Dung ham nay thay vi so `paid === total` — tranh lech vi lam tron. */
export declare function isSettled(m: MoneyOnOrder): boolean;
/** Hien cho nguoi doc: "3.190.000 d". Khong dung cho tinh toan. */
export declare function formatMoney(v: Money): string;
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
export declare function dinhDangTien(v: Money): string;
//# sourceMappingURL=money.d.ts.map