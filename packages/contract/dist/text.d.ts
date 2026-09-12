/** Bo dau, ha chu thuong, gom khoang trang. Dung de SO KHOP, khong dung de hien thi. */
export declare function normalize(value: unknown): string;
/**
 * Ha chu thuong nhung GIU DAU. Dung cho cac cong soi CAU CUA BOT.
 *
 * Ly do phai co ham nay ben canh `normalize`: bo dau xong thi "đôi" (don vi dem giay)
 * va "đổi" (doi tra) thanh mot chu. Cau ban hang binh thuong "còn 7 đôi size 42"
 * se bi cong chinh sach doc thanh loi hua doi tra va chan mat.
 */
export declare function soft(value: unknown): string;
/**
 * Chi bo DAU, giu nguyen moi ky tu khac (ke ca ky tu regex).
 * Dung de doi chieu mot mau regex viet co dau voi cau viet khong dau.
 */
export declare function stripDiacritics(value: unknown): string;
/**
 * Ep phang: chi giu chu va so, GIU DAU. Dung de doi chieu cum bi cam khi cau bot
 * co dau cau chen vao giua — "rẻ nhất - thị trường" van phai bi bat.
 */
export declare function squash(value: unknown): string;
/** Tach thanh tu, bo tu qua ngan. */
export declare function tokens(value: unknown): string[];
/** Bo khoang trang han toan — de "NewBalance" khop "new balance". */
export declare function tight(value: unknown): string;
export declare function escapeRe(value: string): string;
/** Chuoi co chua tu nay khong, tinh ca ranh gioi tu. */
export declare function hasWord(haystack: string, word: string): boolean;
/** Do trung tu giua hai chuoi, 0..1. Chia cho ben dai hon. */
export declare function overlap(a: string, b: string): number;
/**
 * Cau khach go co phu duoc bao nhieu phan TEN SAN PHAM, 0..1.
 *
 * Khac `overlap` o cho khong chia cho do dai cau khach. Ly do: `overlap` phat nguoi
 * noi dai — "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi" ra diem
 * thap hon "boston 13 con 42 khong", trong khi ca hai cung chi dung mot mon.
 */
export declare function coverage(query: string, target: string): number;
/**
 * Chuoi co nhac ten hang nay khong.
 *
 * Phai xet ranh gioi tu chu khong duoc dung "chuoi con": hang "On" dai hai chu cai,
 * neu so kieu chuoi con thi "con hang khong" cung bi coi la nhac hang On.
 */
export declare function mentionsBrand(text: string, brand: string): boolean;
//# sourceMappingURL=text.d.ts.map