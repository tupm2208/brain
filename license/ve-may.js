// VE MAY — thu OMI (va bo nao) mang theo khi goi vao landing. Anh Dung chot 14/09/2026.
//
// Thay cho ve 15 phut + ghep may cua ban truoc. Xeon ky; landing soi bang khoa cong Xeon,
// KHONG goi ra Xeon moi lan bam. Ve song 7 gio; OMI xin ve moi moi 6 gio. Ve lo thi thiet toi
// da 7 gio, va bo mot may tren Xeon la may do het duong sau toi da 7 gio.
//
// Hinh dang:  VM1.<than base64url>.<chu ky base64url>
//   than = JSON cua { v, vai, shop, tenShop, maMay, tenMay, manh, truc, phatLuc, hetLuc, keyId }
//   chuoi ky = "ve-may." + than   (nhan "ve-may" de khong bao gio trung chuoi ky cua thu khac)
//
// `vai`:  "quan-tri" = OMI cua chu shop (di duoc moi duong cua landing)
//         "dich-vu"  = bo nao tren Xeon (chi duong dich-vu + cong-khai)
// `manh`: nhung manh shop DA MUA — landing tu chan duong thuoc manh khong co trong ve.
// `truc`: may nay co phai may truc (chay automation Zalo / Facebook ca nhan) khong.

"use strict";

const { kyChuoi, kiemChuKy } = require("./khoa-ky");

const TIEN_TO = "VM1.";
const SONG_VE_MS = 7 * 60 * 60 * 1000;
const SONG_VE_DICH_VU_MS = 60 * 60 * 1000;
/** Dong ho hai may lech nhau chut it la binh thuong; qua muc nay thi ve "tu tuong lai" bi tu choi. */
const LECH_GIO_CHO_PHEP_MS = 5 * 60 * 1000;
const VAI = ["quan-tri", "dich-vu"];

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

/** JSON voi khoa sap xep — de hai phia ky va soi cung mot chuoi. */
function chuoiChuan(than) {
  const o = {};
  for (const k of Object.keys(than).sort()) o[k] = than[k];
  return JSON.stringify(o);
}

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

/**
 * Doc va soi mot ve. KHONG nem — ve sai la chuyen binh thuong o cua vao.
 * @param khoaCongTheoKeyId  (keyId) => PEM | null  — landing giu mot (hay vai, khi dang xoay) khoa cong
 * @param bayGio             Date
 * Tra { hopLe: true, than } hoac { hopLe: false, viSao }.
 */
function docVe(ve, { khoaCongTheoKeyId, bayGio }) {
  const chu = String(ve || "").trim();
  if (!chu.startsWith(TIEN_TO)) return { hopLe: false, viSao: "sai_hinh_dang" };
  const phan = chu.slice(TIEN_TO.length).split(".");
  if (phan.length !== 2 || !phan[0] || !phan[1]) return { hopLe: false, viSao: "sai_hinh_dang" };
  const [thanB64, chuKy] = phan;

  let than;
  try { than = JSON.parse(Buffer.from(thanB64, "base64url").toString("utf8")); } catch { return { hopLe: false, viSao: "than_hong" }; }
  if (!than || typeof than !== "object" || than.v !== 1) return { hopLe: false, viSao: "than_hong" };
  if (typeof than.keyId !== "string") return { hopLe: false, viSao: "thieu_keyId" };

  const khoaCong = khoaCongTheoKeyId(than.keyId);
  if (!khoaCong) return { hopLe: false, viSao: "khong_biet_khoa" };
  if (!kiemChuKy(khoaCong, `ve-may.${thanB64}`, chuKy)) return { hopLe: false, viSao: "chu_ky_sai" };

  if (!VAI.includes(than.vai) || typeof than.shop !== "string" || than.shop === "") return { hopLe: false, viSao: "than_hong" };
  const t = bayGio.getTime();
  if (!Number.isFinite(than.hetLuc) || t >= than.hetLuc) return { hopLe: false, viSao: "het_han" };
  if (!Number.isFinite(than.phatLuc) || than.phatLuc > t + LECH_GIO_CHO_PHEP_MS) return { hopLe: false, viSao: "chua_toi_gio" };
  if (!Array.isArray(than.manh)) than.manh = [];
  return { hopLe: true, than };
}

module.exports = { kyVe, docVe, chuoiChuan, TIEN_TO, SONG_VE_MS, SONG_VE_DICH_VU_MS, LECH_GIO_CHO_PHEP_MS };
