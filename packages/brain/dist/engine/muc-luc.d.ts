import { type CatalogItem, type TenantId } from "@sp/contract";
import type { IndustryPack } from "../pack/types";
import type { CatalogPort } from "../ports/index";
export interface KetQuaNapMucLuc {
    soMon: number;
    /** Tu dem cua ho so nganh trung voi ten/ma mon cua shop nay. Rong la sach. */
    tuDemPham: string[];
}
export interface MucLucXeon extends CatalogPort {
    /**
     * Thay TOAN BO muc luc cua mot shop. Nguyen tu: qua het cong thi moi thay, khong thi
     * giu nguyen ban cu va nem. Mon cua shop khac lan vao la nem — Xeon phuc vu nhieu shop,
     * mot dong lech tenant la bot cua shop nay ban hang cua shop kia.
     */
    nap(tenant: TenantId, pack: IndustryPack, items: readonly CatalogItem[]): KetQuaNapMucLuc;
    /** Bo muc luc cua mot shop (shop nghi, hay thu hoi giay phep). */
    bo(tenant: TenantId): void;
    /** Tu dem pham loi cua lan nap gan nhat. Shop chua nap thi rong. */
    tuDemPham(tenant: TenantId): string[];
}
export declare function mucLucTrongBoNho(opts?: {
    ghi?: ((dong: string) => void) | undefined;
}): MucLucXeon;
//# sourceMappingURL=muc-luc.d.ts.map