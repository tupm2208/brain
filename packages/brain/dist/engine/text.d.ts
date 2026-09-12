export { normalize, soft, stripDiacritics, squash, tokens, tight, escapeRe, hasWord, overlap, coverage, mentionsBrand } from "@sp/contract";
/**
 * Cac tu co the la ten mon hang: du dai, khong phai tu chung chung, khong phai tu pho bien.
 *
 * `filler` la TU DEM do HO SO NGANH khai ("thi", "sao", "roi"...): "size 43 thi sao" ma
 * "thi"/"sao" bi coi la tu rieng thi tam diem bi xoa. Nhung day la thu ho so phai khai
 * chu bo may khong duoc tu quyet: "cam", "vang", "day", "moi" la tu dem o nganh nay va la
 * MOT PHAN TEN MON o nganh khac (nuoc cam, ruou vang, day chuyen, son moi) — ma
 * `specificTokens` la cua DUY NHAT dan toi muc luc, nen mot tu bi nuot o day la mon do
 * khong bao gio ban duoc.
 */
export declare function specificTokens(text: string, generic: string[], filler?: readonly string[]): string[];
//# sourceMappingURL=text.d.ts.map