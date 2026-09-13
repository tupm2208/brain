// VE MAY — thu OMI (va bo nao) mang theo khi goi vao landing. Anh Dung chot 14/09/2026.
//
// Thay cho ve 15 phut + ghep may cua ban truoc. Xeon KY o day; landing SOI bang
// `chung/ve-may.js` — cung mot ham `docVe`, de hai ben khong bao gio lech hinh dang.
// Ve song 7 gio; OMI xin ve moi moi 6 gio. Ve lo thi thiet toi da 7 gio, va bo mot may tren
// Xeon la may do het duong sau toi da 7 gio.

"use strict";

const { kyChuoi } = require("./khoa-ky");
const { docVe, laVe, chuoiChuan, TIEN_TO, VAI, LECH_GIO_CHO_PHEP_MS } = require("../../chung/ve-may.js");

const SONG_VE_MS = 7 * 60 * 60 * 1000;
const SONG_VE_DICH_VU_MS = 60 * 60 * 1000;

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

function kyVe(than, { khoaRiengPem, keyId }) {
  if (!VAI.includes(than.vai)) throw new Error(`Ve: vai "${than.vai}" khong hop le.`);
  if (typeof than.shop !== "string" || than.shop === "") throw new Error("Ve: thieu shop.");
  if (!Number.isFinite(than.phatLuc) || !Number.isFinite(than.hetLuc) || than.hetLuc <= than.phatLuc) {
    throw new Error("Ve: phatLuc / hetLuc khong hop le.");
  }
  const thanDu = { v: 1, ...than, keyId };
  const thanB64 = b64(chuoiChuan(thanDu));
  return `${TIEN_TO}${thanB64}.${kyChuoi(khoaRiengPem, `ve-may.${thanB64}`)}`;
}

module.exports = { kyVe, docVe, laVe, chuoiChuan, TIEN_TO, SONG_VE_MS, SONG_VE_DICH_VU_MS, LECH_GIO_CHO_PHEP_MS };
