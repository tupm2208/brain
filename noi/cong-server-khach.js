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
// khong luu lai. Tri nho hoi thoai cung nam o landing (anh Dung chot 14/09/2026) — Xeon
// chi cam trong luot.
//
// Sua 14/09/2026 (dot L5):
//   - danh sach cong cu DOC TU LANDING (`GET /api/bo-nao/cong-cu`), lam moi moi 5 phut —
//     khong khai cung nua; shop chua mua manh nao thi cong cu do khong hien, bot khong goi.
//   - `call` mang theo ngu canh (ma hoi thoai + khoa chong trung) ma bo may dua — truoc bi vut.
//   - `online()` chi bao offline trong 30 giay sau mot lan hong, roi thu lai — truoc la offline
//     vinh vien vi khong ai goi lai nua.
//   - `catalog.size()` hoi `catalog.count` — truoc hoi tim voi limit 1 nen luon <= 1.

"use strict";

const LAM_MOI_CONG_CU_MS = 5 * 60 * 1000;
const OFFLINE_MS = 30 * 1000;
/** Ban lui khi chua hoi duoc landing lan nao — chi de bo may co cai ma bat dau. */
const CONG_CU_MAC_DINH = ["catalog.search", "stock.lookup", "storefront.link"];

/**
 * @param diaChi  goc cua server khach, vi du "https://toprun.site"
 * @param ma      ve dich vu ky tu Xeon — mot chuoi, hoac mot HAM tra chuoi (de xin ve moi khi gan het)
 * @param goi     ham goi mang; de thay duoc trong bai kiem tra
 * @param gio     { now(): Date } — de bai kiem tra ep thoi gian
 */
function taoCongServerKhach({ diaChi, ma, goi = globalThis.fetch, hanMs = 10000, nhatKy, gio } = {}) {
  if (!diaChi) throw new Error("Cổng server khách cần `diaChi`.");
  const goc = String(diaChi).replace(/\/+$/, "");
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const now = () => (gio?.now ? gio.now() : new Date()).getTime();
  const layMa = () => (typeof ma === "function" ? ma() : ma);
  let hongLuc = 0;
  let congCu = [...CONG_CU_MAC_DINH];
  let congCuLuc = 0;
  let daHoiCongCu = false;

  async function goiJson(duong, { method = "GET", than } = {}) {
    const bo = new AbortController();
    const dongHo = setTimeout(() => bo.abort(), hanMs);
    try {
      const tl = await goi(`${goc}${duong}`, {
        method,
        signal: bo.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${layMa()}` },
        body: than === undefined ? undefined : JSON.stringify(than)
      });
      const kq = await tl.json().catch(() => ({}));
      hongLuc = 0;
      return { ok: tl.ok && kq.ok === true, status: tl.status, than: kq };
    } catch (e) {
      // Mat mang: bo nao chuyen sang che do han che 30 giay. THA IM VE CON SO con hon noi sai.
      hongLuc = now();
      ky.canhBao(`[noi] ${method} ${duong} that bai: ${e?.message || e}`);
      return { ok: false, status: 0, than: {}, matMang: true };
    } finally {
      clearTimeout(dongHo);
    }
  }

  async function goiCongCu(ten, vao, nguCanh) {
    const r = await goiJson("/api/bo-nao/cong-cu", { method: "POST", than: { ten, input: vao, nguCanh } });
    if (r.matMang) return { ok: false, error: { code: "link_down", message: "Không hỏi được máy chủ của shop." } };
    if (!r.ok) return { ok: false, error: { code: "tool_failed", message: String(r.than.message || r.than.error || `HTTP ${r.status}`) } };
    return { ok: true, data: r.than.data };
  }

  /** Hoi landing dang mo cong cu nao. Hong thi giu danh sach cu. */
  async function lamMoiCongCu() {
    const r = await goiJson("/api/bo-nao/cong-cu");
    if (r.ok && Array.isArray(r.than.congCu)) {
      congCu = r.than.congCu.map(String);
      congCuLuc = now();
      daHoiCongCu = true;
    } else if (!daHoiCongCu) {
      ky.canhBao(`[noi] chua hoi duoc danh sach cong cu cua ${goc} — tam dung ban lui ${CONG_CU_MAC_DINH.join(", ")}`);
    }
    return [...congCu];
  }

  /** Cong cong cu — bo may goi qua day de lay so lieu that. */
  const tools = {
    available: () => [...congCu],
    online: () => hongLuc === 0 || now() - hongLuc > OFFLINE_MS,
    async call(ten, vao, nguCanh) {
      const kq = await goiCongCu(ten, vao, nguCanh);
      return kq.ok ? { ok: true, tool: ten, data: kq.data } : { ok: false, tool: ten, error: kq.error };
    }
  };

  /**
   * Cong muc luc. Ban cu giu muc luc TRONG BO NHO cua Xeon; hinh dang moi thi hoi thang
   * server cua khach moi luot. Cham hon mot chut, doi lai Xeon khong giu gi ca.
   */
  const catalog = {
    async search(tenant, hoi, gioiHan) {
      const kq = await goiCongCu("catalog.search", { q: hoi, limit: gioiHan });
      return kq.ok ? (kq.data.items ?? []) : [];
    },
    async size() {
      if (!congCu.includes("catalog.count")) return 0;
      const kq = await goiCongCu("catalog.count", {});
      return kq.ok ? Number(kq.data.total) || 0 : 0;
    }
  };

  /** Tri nho hoi thoai — nam o landing. Doc truoc luot, ghi sau luot. */
  const triNho = {
    async load(tenant, maHoiThoai) {
      const r = await goiJson(`/api/bo-nao/tri-nho/${encodeURIComponent(String(maHoiThoai))}`);
      return r.ok && r.than.trangThai ? r.than.trangThai : null;
    },
    async save(trangThai) {
      const r = await goiJson(`/api/bo-nao/tri-nho/${encodeURIComponent(String(trangThai.conversationId))}`, { method: "PUT", than: { trangThai } });
      if (!r.ok) ky.canhBao(`[noi] khong ghi duoc tri nho ${trangThai.conversationId}: ${r.than.error || r.status}`);
    }
  };

  /** Gui tin tra loi cho khach — di qua hop thu cua server khach, khong goi thang Meta. */
  async function guiTinTraLoi({ kenh = "facebook", nguoi, chu }) {
    const r = await goiJson("/api/hop-thu/gui", { method: "POST", than: { kenh, nguoi, chu } });
    if (!r.ok) throw new Error(String(r.than.message || r.than.error || `HTTP ${r.status}`));
    return r.than;
  }

  /** Bao cho shop: hoi thoai nay bot chuyen nguoi that. Khong nem — bao hong thi ghi nhat ky. */
  async function baoCanNguoi({ kenh, nguoi, maHoiThoai, lyDo, tinCuoi }) {
    const r = await goiJson("/api/hop-thu/can-nguoi", { method: "POST", than: { kenh, nguoi, maHoiThoai, lyDo, tinCuoi } });
    if (!r.ok) ky.canhBao(`[noi] khong bao duoc "can nguoi" cho ${maHoiThoai}: ${r.than.error || r.status}`);
    return r.ok;
  }

  return {
    tools, catalog, triNho, guiTinTraLoi, baoCanNguoi, lamMoiCongCu,
    dangSong: () => tools.online(),
    /** Danh sach cong cu da cu chua (de nguoi goi lam moi truoc luot). */
    congCuCu: () => !daHoiCongCu || now() - congCuLuc > LAM_MOI_CONG_CU_MS
  };
}

module.exports = { taoCongServerKhach, CONG_CU_MAC_DINH, LAM_MOI_CONG_CU_MS, OFFLINE_MS };
