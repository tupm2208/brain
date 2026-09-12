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
import type { IndustryPack } from "./pack/types";
/** Cac bo luat nganh co san. Them nganh moi = them mot dong o day. */
export declare const BUILTIN_PACKS: Record<string, IndustryPack>;
export declare function loadPack(id: string): IndustryPack;
/** Soi het cac bo luat co san. Goi luc khoi dong va trong bai kiem tra. */
export declare function selfCheckPacks(): void;
//# sourceMappingURL=index.d.ts.map