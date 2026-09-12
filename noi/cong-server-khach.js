// NOI BO NAO VOI SERVER CUA KHACH.
//
// Bo may cua bo nao khong tu mo ket noi — no nhan cac "cong" (ports) tu ngoai vao. Truoc
// day cong do chay tren mot duong day TLS rieng toi OMI. Anh Dung chot 12/09/2026: du lieu
// nam o server cua khach, nen cac cong nay goi API cua server do.
//
// Doi duong day thanh goi API khong dung mot dong nao trong bo may — do la ca diem cua
// viec bo may chi biet "cong", khong biet duong day.
//
// MOT DIEU PHAI GIU: bo nao KHONG duoc giu du lieu cua khach. Cong nay hoi xong thi dung,
// khong luu lai. Tri nho hoi thoai la thu duy nhat bo nao giu, va no da che so dien thoai.

"use strict";

const TEN_CONG_CU = [
  "catalog.search", "stock.lookup", "order.lookup",
  "payment.status", "shipment.track", "storefront.link"
];

/**
 * @param diaChi  goc cua server khach, vi du "https://toprun.site"
 * @param ma      ma dich vu rieng cua bo nao (BO_NAO_TOKEN) — khong dung chung ma quan tri
 * @param goi     ham goi mang; de thay duoc trong bai kiem tra
 */
function taoCongServerKhach({ diaChi, ma, goi = globalThis.fetch, hanMs = 10000, nhatKy } = {}) {
  if (!diaChi) throw new Error("Cổng server khách cần `diaChi`.");
  const goc = String(diaChi).replace(/\/+$/, "");
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  let dangSong = true;

  async function goiCongCu(ten, vao) {
    const bo = new AbortController();
    const dongHo = setTimeout(() => bo.abort(), hanMs);
    try {
      const tl = await goi(`${goc}/api/bo-nao/cong-cu`, {
        method: "POST",
        signal: bo.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ma}` },
        body: JSON.stringify({ ten, input: vao })
      });
      const than = await tl.json().catch(() => ({}));
      dangSong = true;
      if (!tl.ok || than.ok !== true) {
        return { ok: false, error: { code: "tool_failed", message: String(than.message || than.error || `HTTP ${tl.status}`) } };
      }
      return { ok: true, data: than.data };
    } catch (e) {
      // Mat mang: bo nao chuyen sang che do han che. THA IM VE CON SO con hon noi sai.
      dangSong = false;
      ky.canhBao(`[noi] goi "${ten}" that bai: ${e?.message || e}`);
      return { ok: false, error: { code: "link_down", message: "Không hỏi được máy chủ của shop." } };
    } finally {
      clearTimeout(dongHo);
    }
  }

  /** Cong cong cu — bo may goi qua day de lay so lieu that. */
  const tools = {
    available: () => [...TEN_CONG_CU],
    online: () => dangSong,
    async call(ten, vao) {
      const kq = await goiCongCu(ten, vao);
      return kq.ok ? { ok: true, tool: ten, data: kq.data } : { ok: false, tool: ten, error: kq.error };
    }
  };

  /**
   * Cong muc luc. Ban cu giu muc luc TRONG BO NHO cua Xeon; hinh dang moi thi hoi thang
   * server cua khach moi luot. Cham hon mot chut, doi lai Xeon khong giu gi ca — dung
   * dieu anh Dung chot (QD3).
   */
  const catalog = {
    async search(tenant, hoi, gioiHan) {
      const kq = await goiCongCu("catalog.search", { q: hoi, limit: gioiHan });
      return kq.ok ? (kq.data.items ?? []) : [];
    },
    async size() {
      const kq = await goiCongCu("catalog.search", { q: "", limit: 1 });
      return kq.ok ? (kq.data.items ?? []).length : 0;
    }
  };

  /** Gui tin tra loi cho khach — di qua hop thu cua server khach, khong goi thang Meta. */
  async function guiTinTraLoi({ kenh = "facebook", nguoi, chu }) {
    const bo = new AbortController();
    const dongHo = setTimeout(() => bo.abort(), hanMs);
    try {
      const tl = await goi(`${goc}/api/hop-thu/gui`, {
        method: "POST",
        signal: bo.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ma}` },
        body: JSON.stringify({ kenh, nguoi, chu })
      });
      const than = await tl.json().catch(() => ({}));
      if (!tl.ok || than.ok !== true) throw new Error(String(than.message || than.error || `HTTP ${tl.status}`));
      return than;
    } finally {
      clearTimeout(dongHo);
    }
  }

  return { tools, catalog, guiTinTraLoi, dangSong: () => dangSong };
}

module.exports = { taoCongServerKhach, TEN_CONG_CU };
