// Ban giao keo giua ba khoi. Sua o day la ca ba khoi cung biet — het canh chep tay
// mot cong thuc ra ba noi nhu he TopRun hien nay.

export * from "./ids";
export * from "./text";
export * from "./money";
export * from "./errors";
export * from "./events";
export * from "./catalog";
export * from "./pii";
export * from "./tools";
export * from "./modules";
export * from "./license";
export * from "./link";
export * from "./khoa-may";
export * from "./khung-dong";
export * from "./chung-chi";
export * from "./ma-kich-hoat";
export * from "./pheu-dang-ky";

import { assertModuleGraph } from "./modules";
import { assertToolsSafeForBot } from "./tools";

/** Phien ban ban giao keo. Bo nao dung so nay de tu choi ban OMI qua cu. */
export const CONTRACT_VERSION = "0.3.0";

/**
 * Kiem tra cac luat kien truc tu chinh minh. Goi luc khoi dong Bo nao va OMI,
 * va goi trong bai kiem tra — de mot thay doi sai nguyen tac gay ngay,
 * khong cho toi luc phat hien bang tien that.
 */
export function selfCheck(): void {
  assertModuleGraph();
  assertToolsSafeForBot();
}
