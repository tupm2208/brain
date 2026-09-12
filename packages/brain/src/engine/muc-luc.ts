// MUC LUC TREN XEON — ban rut gon cua muc luc moi shop, giu trong bo nho cua Bo nao.
//
// QUYET DINH 3: may khach giu ban goc, Xeon chi giu muc luc (ten, ma, hang, gia ban).
// Truoc A4, muc luc tren Xeon chi ton tai trong bai kiem tra (moi bai tu viet mot ban
// `catalog` gia tu `exportCatalogIndex`), nen hai cai cong xay xong ma chua lap:
//   - `assertCatalogClean` chi chay o DAU OMI luc xuat. Xeon nhan gi cung giu — mot OMI
//     bi sua (hay mot ban OMI cu co lo) day so dien thoai khach len la Xeon giu luon.
//     Cong phai o CA HAI dau: dau gui de khong lo, dau nhan de khong tin.
//   - `kiemTuDemVoiMucLuc` (SPEC "CON NO": cong xay xong chua lap) — tu dem cua ho so
//     nganh nuot mat ten mon cua shop thi mon do khong bao gio duoc nhan ra.
//
// Day la noi DUY NHAT muc luc di vao Bo nao, nen hai cong do nam o day, trong `nap`.
//
// Tu dem pham loi la BAO, khong phai TU CHOI: loi nam o ho so nganh (viec cua nen tang),
// shop khong sua duoc ten mon cua minh de qua cong; tu choi ca dot nap la mot ten mon
// lam ca shop mat muc luc — bot cua ho tu dung mu, khong ai biet vi sao. Danh sach pham
// loi duoc TRA VE va GHI NHAT KY, va giu lai de hoi (`tuDemPham`) — nguoi van hanh nen
// tang phai nhin thay va sua ho so.

import {
  assertCatalogClean, coverage,
  type CatalogItem, type CatalogItemLite, type TenantId
} from "@sp/contract";
import type { IndustryPack } from "../pack/types";
import { kiemTuDemVoiMucLuc } from "../pack/validate";
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

interface MucLucShop {
  mon: CatalogItemLite[];
  /** `code + name` da chuan hoa qua `coverage` — tinh mot lan luc nap. */
  chuoi: string[];
  tuDemPham: string[];
}

export function mucLucTrongBoNho(opts: { ghi?: ((dong: string) => void) | undefined } = {}): MucLucXeon {
  const kho = new Map<TenantId, MucLucShop>();
  const ghi = opts.ghi ?? (() => undefined);

  return {
    nap(tenant, pack, items) {
      const daThay = new Set<string>();
      for (const it of items) {
        if (it.tenant !== tenant) {
          throw new Error(
            `Muc luc cua shop "${tenant}" mang mon "${it.code}" cua shop "${it.tenant}" — tu choi ca dot nap.`
          );
        }
        if (daThay.has(it.id)) {
          throw new Error(`Muc luc cua shop "${tenant}" co hai mon cung ma "${it.id}" — tu choi ca dot nap.`);
        }
        daThay.add(it.id);
      }
      // Cong QD3 o dau NHAN. Nem thi khong thay gi.
      assertCatalogClean(items);
      const tuDemPham = kiemTuDemVoiMucLuc(pack, items);
      if (tuDemPham.length > 0) {
        ghi(
          `[muc-luc] ${tenant}: tu dem cua ho so "${pack.id}" nuot ten mon cua shop: ` +
            `${tuDemPham.join(", ")} — sua ho so nganh, khong sua ten mon.`
        );
      }
      const mon: CatalogItemLite[] = items.map((it) => {
        const gia = it.variants.map((v) => v.price).sort((a, b) => a - b);
        return {
          id: it.id,
          code: it.code,
          name: it.name,
          brand: it.brand,
          priceFrom: gia[0] ?? 0,
          variantCount: it.variants.length,
          url: it.url
        };
      });
      kho.set(tenant, { mon, chuoi: mon.map((m) => `${m.code} ${m.name}`), tuDemPham });
      return { soMon: mon.length, tuDemPham };
    },

    bo(tenant) { kho.delete(tenant); },

    tuDemPham(tenant) { return [...(kho.get(tenant)?.tuDemPham ?? [])]; },

    async search(tenant, query, limit) {
      const ml = kho.get(tenant);
      if (ml === undefined || limit <= 0) return [];
      // Xep theo do phu giam dan; bang nhau thi giu THU TU KHO (bai kiem tra khong duoc
      // de hon OMI that — SPEC: bo tim kiem tra theo thu tu kho).
      return ml.mon
        .map((m, i) => ({ m, i, diem: coverage(query, ml.chuoi[i] ?? "") }))
        .filter((x) => x.diem > 0)
        .sort((a, b) => b.diem - a.diem || a.i - b.i)
        .slice(0, limit)
        .map((x) => ({ ...x.m }));
    },

    async size(tenant) { return kho.get(tenant)?.mon.length ?? 0; }
  };
}
