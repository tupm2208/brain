// CHUAN HOA CHU TIENG VIET — nam trong ban giao keo vi CA BA KHOI phai lam GIONG HET.
//
// Vi sao khong de rieng o Bo nao: OMI ghi cot chu da chuan hoa de tim kiem, Bo nao
// chuan hoa cau khach go de so khop. Hai ben lech nhau mot ly la nhan kho khong bao
// gio gap duoc cau khach — dung kieu loi "bao het hang trong khi kho con hang".
//
// Bai hoc that tu he TopRun: kho tin nhan co khoang 0,6% ban ghi luu o dang NFD
// (chu va dau tach roi). Ham chuan hoa cu chi chon MOT trong hai dang nen 1.224 tin
// that kieu "doi nay con 42 ko" lot het qua cong nhan dien.

/** Bo dau, ha chu thuong, gom khoang trang. Dung de SO KHOP, khong dung de hien thi. */
export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    // Giu dau phay: "3,19 trieu" bi cat thanh "3" va "19 trieu" thi cong so doc ra
    // mot con so hoan toan khac, roi chan nham cau viet dung.
    .replace(/[^a-z0-9\s.,/+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ha chu thuong nhung GIU DAU. Dung cho cac cong soi CAU CUA BOT.
 *
 * Ly do phai co ham nay ben canh `normalize`: bo dau xong thi "đôi" (don vi dem giay)
 * va "đổi" (doi tra) thanh mot chu. Cau ban hang binh thuong "còn 7 đôi size 42"
 * se bi cong chinh sach doc thanh loi hua doi tra va chan mat.
 */
export function soft(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Chi bo DAU, giu nguyen moi ky tu khac (ke ca ky tu regex).
 * Dung de doi chieu mot mau regex viet co dau voi cau viet khong dau.
 */
export function stripDiacritics(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC").normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Ep phang: chi giu chu va so, GIU DAU. Dung de doi chieu cum bi cam khi cau bot
 * co dau cau chen vao giua — "rẻ nhất - thị trường" van phai bi bat.
 */
export function squash(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Tach thanh tu, bo tu qua ngan. */
export function tokens(value: unknown): string[] {
  return normalize(value).split(" ").filter((t) => t.length > 1);
}

/** Bo khoang trang han toan — de "NewBalance" khop "new balance". */
export function tight(value: unknown): string {
  return normalize(value).replace(/[\s.-]/g, "");
}

export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chuoi co chua tu nay khong, tinh ca ranh gioi tu. */
export function hasWord(haystack: string, word: string): boolean {
  const h = normalize(haystack);
  const w = normalize(word);
  if (w === "") return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`).test(h);
}

/** Do trung tu giua hai chuoi, 0..1. Chia cho ben dai hon. */
export function overlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = tokens(b);
  if (left.size === 0 || right.length === 0) return 0;
  let hit = 0;
  for (const t of right) if (left.has(t)) hit += 1;
  return hit / Math.max(left.size, right.length);
}

/**
 * Cau khach go co phu duoc bao nhieu phan TEN SAN PHAM, 0..1.
 *
 * Khac `overlap` o cho khong chia cho do dai cau khach. Ly do: `overlap` phat nguoi
 * noi dai — "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi" ra diem
 * thap hon "boston 13 con 42 khong", trong khi ca hai cung chi dung mot mon.
 */
export function coverage(query: string, target: string): number {
  const q = new Set(tokens(query));
  const t = tokens(target);
  if (q.size === 0 || t.length === 0) return 0;
  let hit = 0;
  for (const w of t) if (q.has(w)) hit += 1;
  return hit / t.length;
}

/**
 * Chuoi co nhac ten hang nay khong.
 *
 * Phai xet ranh gioi tu chu khong duoc dung "chuoi con": hang "On" dai hai chu cai,
 * neu so kieu chuoi con thi "con hang khong" cung bi coi la nhac hang On.
 */
export function mentionsBrand(text: string, brand: string): boolean {
  const b = normalize(brand);
  if (b === "") return false;
  if (hasWord(text, b)) return true;
  if (b.replace(/\s/g, "").length >= 5) return tight(text).includes(tight(b));
  return false;
}
