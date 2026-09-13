// SO LICENSE — mot tep JSON, ghi nguyen tu, xep hang.
//
// Xeon phuc vu vai tram shop la nhieu; mot tep JSON du. Ghi TAM roi doi ten (rename la nguyen
// tu tren cung o dia) nen mat dien giua chung thi hoac con tep cu, hoac co tep moi tron ven,
// khong bao gio co tep nua chung. Doi bo nho SAU khi ghi xong — ghi hong thi bo nho van la
// ban da chac chan nam tren dia.
//
// Hinh dang: { phienBan: 1, cacKey: { [key]: DongKey } }

"use strict";

const fs = require("fs");
const path = require("path");

const TEP_SO = "license.json";

function soTrong() {
  return { phienBan: 1, cacKey: {} };
}

/**
 * @param thuMuc  thu muc du lieu cua Xeon. `null` = chi trong bo nho (bai kiem tra).
 */
async function taoSoLicense({ thuMuc = null, nhatKy } = {}) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const tep = thuMuc ? path.join(thuMuc, TEP_SO) : null;
  let trangThai = soTrong();

  if (tep) {
    fs.mkdirSync(thuMuc, { recursive: true });
    if (fs.existsSync(tep)) {
      const chu = fs.readFileSync(tep, "utf8");
      const doc = JSON.parse(chu);
      if (!doc || doc.phienBan !== 1 || typeof doc.cacKey !== "object") {
        throw new Error(`So license ${tep} khong dung hinh dang — khong tu ghi de, kiem tay.`);
      }
      trangThai = doc;
      ky.tin(`[license] nap so: ${Object.keys(doc.cacKey).length} key`);
    }
  }

  let hang = Promise.resolve();
  const xepHang = (viec) => {
    const p = hang.then(viec, viec);
    hang = p.catch(() => undefined);
    return p;
  };

  async function ghiXuong(moi) {
    if (!tep) return;
    const tam = `${tep}.${process.pid}.tmp`;
    await fs.promises.writeFile(tam, JSON.stringify(moi, null, 2), "utf8");
    await fs.promises.rename(tam, tep);
  }

  return {
    /** Ban hien tai — CHI DOC. Muon doi thi qua `capNhat`. */
    doc: () => trangThai,

    /**
     * Doi so: `bien(banSao)` sua tren ban sao sau, tra ve gia tri tuy y; ghi xuong dia truoc,
     * doi bo nho sau. Tuan tu — hai lan cap nhat khong bao gio chen nhau.
     */
    capNhat(bien) {
      return xepHang(async () => {
        const banSao = JSON.parse(JSON.stringify(trangThai));
        const ra = bien(banSao);
        await ghiXuong(banSao);
        trangThai = banSao;
        return ra;
      });
    },

    duongTep: () => tep
  };
}

module.exports = { taoSoLicense, TEP_SO, soTrong };
