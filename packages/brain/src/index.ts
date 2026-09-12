// BO NAO — chay tren Xeon, phuc vu moi nha ban hang.
//
// Bo may o `engine/` KHONG biet gi ve giay, thuoc hay spa. Kien thuc nganh nam o
// `packs/`. Ban cho nganh moi = viet mot bo ho so moi, khong dung vao bo may.

// Xuat lai cong du lieu ca nhan cua ban giao keo — Bo nao la noi goi no.
export { assertNoStoredPII, findPIIInText, redactPII } from "@sp/contract";
export * from "./pack/types";
export * from "./pack/validate";
export * from "./ports/index";
export * from "./engine/text";
export * from "./engine/memory";
export * from "./engine/muc-luc";
export * from "./engine/gates";
export * from "./engine/turn";
export * from "./link/goi-qua-day";
export * from "./link/may-chu";
export * from "./link/kho-khoa";
export * from "./link/kho-kich-hoat";
export * from "./link/chung-chi-xeon";
export { giayChayPack } from "./packs/giay-chay/index";
export { nhaThuocPack } from "./packs/nha-thuoc/index";

import { assertPackValid } from "./pack/validate";
import { giayChayPack } from "./packs/giay-chay/index";
import { nhaThuocPack } from "./packs/nha-thuoc/index";
import type { IndustryPack } from "./pack/types";

/** Cac bo luat nganh co san. Them nganh moi = them mot dong o day. */
export const BUILTIN_PACKS: Record<string, IndustryPack> = {
  [giayChayPack.id]: giayChayPack,
  [nhaThuocPack.id]: nhaThuocPack
};

export function loadPack(id: string): IndustryPack {
  const pack = BUILTIN_PACKS[id];
  if (pack === undefined) throw new Error(`Khong co bo luat nganh "${id}".`);
  assertPackValid(pack);
  return pack;
}

/** Soi het cac bo luat co san. Goi luc khoi dong va trong bai kiem tra. */
export function selfCheckPacks(): void {
  for (const id of Object.keys(BUILTIN_PACKS)) loadPack(id);
}
