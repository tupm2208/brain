"use strict";
// Ban giao keo giua ba khoi. Sua o day la ca ba khoi cung biet — het canh chep tay
// mot cong thuc ra ba noi nhu he TopRun hien nay.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_VERSION = void 0;
exports.selfCheck = selfCheck;
__exportStar(require("./ids"), exports);
__exportStar(require("./text"), exports);
__exportStar(require("./money"), exports);
__exportStar(require("./errors"), exports);
__exportStar(require("./events"), exports);
__exportStar(require("./catalog"), exports);
__exportStar(require("./pii"), exports);
__exportStar(require("./tools"), exports);
__exportStar(require("./modules"), exports);
__exportStar(require("./license"), exports);
__exportStar(require("./link"), exports);
__exportStar(require("./khoa-may"), exports);
__exportStar(require("./khung-dong"), exports);
__exportStar(require("./chung-chi"), exports);
__exportStar(require("./ma-kich-hoat"), exports);
__exportStar(require("./pheu-dang-ky"), exports);
const modules_1 = require("./modules");
const tools_1 = require("./tools");
/** Phien ban ban giao keo. Bo nao dung so nay de tu choi ban OMI qua cu. */
exports.CONTRACT_VERSION = "0.3.0";
/**
 * Kiem tra cac luat kien truc tu chinh minh. Goi luc khoi dong Bo nao va OMI,
 * va goi trong bai kiem tra — de mot thay doi sai nguyen tac gay ngay,
 * khong cho toi luc phat hien bang tien that.
 */
function selfCheck() {
    (0, modules_1.assertModuleGraph)();
    (0, tools_1.assertToolsSafeForBot)();
}
//# sourceMappingURL=index.js.map