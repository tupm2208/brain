"use strict";
// BO LUAT NGANH — phan thay duoc cua nen tang.
//
// Bo may KHONG biet gi ve giay, ve thuoc, ve spa. Toan bo kien thuc nganh nam trong
// mot bo ho so kieu nay. Ban cho nganh moi = viet mot bo luat moi, khong dung vao bo may.
//
// Ban 2 (sau phan bien 09/09): mo rong bon cho tung dong cung, vi nganh khac hinh dang
// giay la phai sua ma — dung cai lo thung trong loi hua ban hang:
//   - MOT truc bien the  ->  nhieu truc (spa can thoi luong + khung gio)
//   - o thay the dong cung -> ho so tu khai them
//   - luat cong dong cung  -> them `forbidden_patterns` de nganh duoc khai luat rieng
//   - o thong tin dong cung -> ho so tu dat ten o
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_TEMPLATES = void 0;
// ---------------------------------------------------------------- 7. Mau cau
/** Mau cau bat buoc phai co. Ho so duoc them mau cau rieng ngoai danh sach nay. */
exports.REQUIRED_TEMPLATES = [
    "greeting", "ask_item", "ask_slot", "handoff",
    "offline", "brand_not_carried", "out_of_stock", "in_stock"
];
//# sourceMappingURL=types.js.map