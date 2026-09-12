// DU LIEU CA NHAN CUA KHACH — cai gi duoc luu o dau.
//
// QUYET DINH 3: may khach giu ban goc, Xeon chi giu muc luc hang hoa.
// `assertCatalogClean` canh muc luc. Cac ham o day canh phan VAN BAN TU DO —
// tin nhan, cau tra loi — truoc khi ghi xuong Xeon.
//
// BA DIEU HOC DUOC KHI VA (phan bien 09/09):
//
// 1. CHI nhan VAN BAN TU DO. Ban dau ham nhan ca doi tuong bat ky, nen ma hoi thoai
//    Messenger (16 chu so), ma hang EAN-13, ma khach thue dang so deu bi coi la
//    du lieu ca nhan roi nem loi — moi luot cua hoi thoai do chet han. Nay chu ky ham
//    chi nhan chuoi, nen goi nham la loi luc bien dich chu khong phai luc chay.
//
// 2. CHE va DO phai la HAI mau khac nhau. Truoc day dung chung mot regex, nen thu gi
//    ben che bo sot thi ben do cung bo sot y het — cong chan tro thanh cai chot
//    khong bao gio no duoc.
//
// 3. Cach chac chan nhat khong phai la che cho gioi, ma la KHONG LUU. Bo nao khong
//    doc lai noi dung tin cua khach, nen tin cua khach duoc luu voi noi dung rong.
//    Dia chi va ten nguoi nhan — hai thu khong mau nao doc duoc dang tin — nho vay
//    cung khong con cho de ro.

export const REDACTED = "[da che]";

/**
 * Mau de CHE: rong tay, chap nhan che hoi thua trong van ban tu do.
 * Dau tach viet kieu gi cung bat: `.` `_` `,` `-` `|` `*` `x` khoang trang, ngoac.
 * KHONG nhan `/`: ngay thang la nguon che nham lon nhat ("hen 01/09/2026 - 3.190.000"
 * bi doc thanh mot so dien thoai, va bot doc cho khach mot cau hong). So dien thoai viet
 * bang gach cheo thi rat hiem.
 * `(?!\d)` o cuoi cung vay: khong co no thi mot ma lo 13 chu so bi cat doi
 * ("ma lo 0234567890123" -> "ma lo [da che]3").
 * `(?<![\p{L}\d])` la bat buoc: khong co no thi nhanh `[oO]` an ca chu "o" cuoi cua
 * tu dung truoc ("zalo 0968..." -> "zal[da che]"), va so "0" trong "40, 41" bi coi
 * la dau mot so dien thoai.
 *
 * DAU SO ngay sau so 0 cung la bat buoc, va day la bai hoc dat: khong co no thi mau nay
 * an ca SO TAI KHOAN NGAN HANG — Vietcombank `0011 0012 3456`, Sacombank `0600...` deu
 * la so 0 roi mot day chu so, va bot doc cho khach thanh "Chuyen khoan Vietcombank
 * [da che]" — shop mat duong nhan tien.
 *
 * Danh sach nay phu: di dong tu 2018 (`03 05 07 08 09`), di dong CU truoc 2018
 * (`012 016 018 019`) — nha mang doi dau so cho THUE BAO chu khong doi ban ghi cu
 * trong kho cua nguoi ban, nen lich su khach nhap tu he cu day nhung so nay — va so
 * co dinh (`02x`).
 *
 * CAI GI CHAN CHO NAY khoi che nham: `policy.get` va cac cong cu tra ve chu shop tu
 * viet ve chinh minh KHONG di qua duong soi (xem `CONG_CU_CUA_SHOP` trong `omi/tools.ts`).
 * Phan biet o cho dat cong, khong o mau chu — vi so tai khoan cua shop va so cua khach
 * co hinh dang giong het nhau khi shop dung MB Bank hay TPBank.
 */
const REDACT_PHONE_RE =
  /(?<![\p{L}\d])(?:\+?84|00?84|[0oO])[\s._,|*x()\-]{0,3}(?:3|5|7|8|9|1[2689]|2)(?:[\s._,|*x()\-]{0,3}\d){7,10}(?!\d)/gu;

/**
 * Mau de DO: chat hon, chi bao khi that su giong so dien thoai — de bao cao khong
 * ngap trong bao dong gia. Khong doi hoi trung khop voi mau che.
 */
const DETECT_PHONE_RE =
  /(?<![\p{L}\d])(?:\+?84|0)[\s._,|*x()\-]{0,3}(?:3|5|7|8|9|1[2689]|2)(?:[\s._,|*x()\-]{0,3}\d){7,9}(?![\d])/u;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Che du lieu ca nhan trong MOT DOAN VAN BAN TU DO.
 *
 * Chi che duoc thu co hinh dang nhan ra duoc: so dien thoai va email.
 * KHONG che duoc dia chi hay ten nguoi — khong mau nao doc duoc chung dang tin,
 * nen thu do phai giai quyet bang cach khong luu (xem chu thich dau tep).
 *
 * CO Y khong che "day so dai bat ky": ma hang EAN-13, ma don, so tai khoan cua shop
 * deu la day so dai hop le, che chung di la lam hong du lieu that.
 */
export function redactPII(text: string): string {
  return String(text ?? "")
    .replace(new RegExp(EMAIL_RE.source, "gi"), REDACTED)
    .replace(REDACT_PHONE_RE, REDACTED);
}

export interface PIIFinding {
  index: number;
  kind: "phone" | "email";
}

/** Do du lieu ca nhan trong MOT DOAN VAN BAN TU DO. */
export function findPIIInText(text: string): PIIFinding[] {
  const s = String(text ?? "");
  const out: PIIFinding[] = [];
  const email = new RegExp(EMAIL_RE.source, "i").exec(s);
  if (email !== null) out.push({ index: email.index, kind: "email" });
  const phone = new RegExp(DETECT_PHONE_RE.source, "u").exec(s);
  if (phone !== null) out.push({ index: phone.index, kind: "phone" });
  return out;
}

/**
 * Nem loi neu cac doan VAN BAN TU DO sap luu con du lieu ca nhan.
 *
 * Chi truyen van ban tu do — dung truyen ma hoi thoai, ma hang, ma khach thue.
 * Chu ky chi nhan `string[]` de goi nham thanh loi luc bien dich.
 */
export function assertNoStoredPII(texts: readonly string[]): void {
  const bad: string[] = [];
  texts.forEach((t, i) => {
    for (const f of findPIIInText(t)) bad.push(`[${i}] ${f.kind}`);
  });
  if (bad.length > 0) {
    throw new Error(
      `Van ban sap luu con du lieu ca nhan (${bad.length} cho): ${bad.slice(0, 6).join(", ")}. ` +
        `Xem QUYET DINH 3 — Xeon khong duoc luu so dien thoai hay email cua khach.`
    );
  }
}
