# Chuẩn thiết kế mã — bộ não (áp dụng từ 14/09/2026)

Đây là chuẩn anh Dũng chốt cho việc viết lại: **TypeScript, hướng đối tượng, tên tiếng Anh**,
làm mẫu ở bộ não trước rồi lan sang landing và OMI. Tài liệu này để người sau viết cùng một kiểu.

## 1. Kiến trúc: Ports & Adapters (hexagonal)

```
            +----------------------------- @sp/xeon ------------------------------+
  HTTP ---> | controllers -> BrainService -> TurnEngine (@sp/brain) -> ports      |
            |                    |                                       ^         |
            |                    +-- LicenseService <- LicenseLedger      |         |
            |                                                             |         |
            |                LandingGateway (adapter HTTP sang landing) --+         |
            +----------------------------------------------------------------------+
```

- **Lõi thuần** (`@sp/brain`) chỉ biết *cổng* (`ToolPort`, `CatalogPort`, `MemoryPort`, `Clock`).
  Không mở mạng, không đọc giờ hệ thống, không gọi mô hình. Vì thế test được trọn vẹn bằng cửa giả.
- **Adapter** (`@sp/xeon/gateway`) cắm cổng vào HTTP của landing. Đổi cách nối không sửa lõi.
- **Giao kèo** (`@sp/contract`) là gốc: mọi gói đọc nó, nó không đọc ai.

## 2. Các mẫu thiết kế đang dùng và ở đâu

| Mẫu | Ở đâu | Vì sao |
|---|---|---|
| Strategy | `ToolHandler` (một lớp mỗi công cụ), `RuleEvaluator` (một lớp mỗi luật cổng), `IndustryPack` (hồ sơ ngành là dữ liệu) | Thêm công cụ / luật / ngành = thêm một lớp hoặc một tệp, không sửa vòng lặp chính |
| Chain of Responsibility | `GateChain` (chạy mọi luật, lấy phán quyết nặng nhất), chuỗi `RequestController` trong HTTP | Mỗi mắt xích tự quyết có nhận việc không; thứ tự khai rõ ở một chỗ |
| Facade | `BrainService`, `handleTurn()` | Bên ngoài gọi một cửa, không phải biết TurnEngine ghép từ gì |
| Repository | `LicenseLedger` | Che cách lưu (JSON ghi nguyên tử, xếp hàng) khỏi luật license |
| Composition root | `app.ts` (`buildXeonApp`) | Chỗ DUY NHẤT `new` các thành phần và nối chúng; `main.ts` chỉ đọc env và gọi |
| Value helper | `key-format.ts`, `ticket-kit.ts` | Hàm thuần cho khoá, key, vé; không giữ trạng thái |

Không lạm dụng lớp: hàm thuần (chuẩn hoá chữ, đọc số, trí nhớ hội thoại) vẫn là hàm, có tài liệu.
Lớp chỉ khi có trạng thái hoặc có nhiều cài đặt thay nhau.

## 3. Đặt tên

- **Mã**: tiếng Anh, `camelCase` cho biến/hàm, `PascalCase` cho lớp/kiểu, `SCREAMING_CASE` cho hằng.
  Tên tệp `kebab-case`. Mỗi tệp một chủ đề.
- **Giao thức bên ngoài giữ tiếng Việt**: tên trường JSON với landing/OMI (`nguoi`, `chu`, `maNhanTin`,
  `viSao`...), biến môi trường (`XEON_ADMIN_MAT_KHAU`), tệp trên đĩa (`license.json`, `xeon.ky.key.pem`),
  đường HTTP (`/quan-tri`, `/tin-den`), id mảnh (`hang-kho`), id bộ luật (`giay-chay`), id phần tử
  trong HTML. Khai chúng ở `protocol.ts` / `ledger.ts` / `PATHS` và đổi tên ở biên (controller), không
  để lọt sâu vào lõi.
- **Chuỗi hiện cho người Việt** (log vận hành, thông báo bộ soi hồ sơ, lý do cổng chặn, câu trả lời
  khách, chữ trên trang web) giữ tiếng Việt như cũ. Lỗi cho lập trình viên (assert kiến trúc) tiếng Anh.

## 4. Chú thích

- Mỗi tệp mở đầu bằng `@file` nói tệp làm gì và **vì sao** thiết kế như vậy.
- Mỗi symbol export có TSDoc một câu. Tham số không hiển nhiên thì có `@param`.
- Chú thích ghi **lý do và bài học**, không chép lại mã. Những đoạn "trước đây sai thế này, sửa vì
  chuyện thật này" được giữ nguyên ý (dịch sang tiếng Anh) vì đó là kiến thức đắt nhất của hệ.
- Regex phức tạp: mỗi mảnh kỳ lạ có một dòng nói nó chặn trường hợp nào.

## 5. Kiểu

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` bật ở `tsconfig.base.json`.
- Id là kiểu gán nhãn (`TenantId`, `ItemId`...) để không truyền nhầm.
- Dữ liệu từ mạng là `unknown`/`Record<string, unknown>` cho tới khi kiểm hình dạng ở biên.
- Kết quả có nhiều nhánh dùng union phân biệt (`{ ok: true, ... } | { ok: false, viSao: ... }`).

## 6. Test

- Viết bằng TypeScript (`*.test.mts`), chạy thẳng bằng `node --test` trên Node 24 (type stripping),
  kiểm kiểu bằng `npm run check` (`tsconfig.test.json`, `noEmit`).
- Mỗi luật kiến trúc có một bài làm nó gãy khi bị phá (không chỉ bài "đúng thì xanh").
- Test lõi chỉ dùng cửa giả; test HTTP mở cổng 0 thật; test nối MySQL tách riêng (`test-mysql/`).
- Câu khách trong test giữ nguyên tiếng Việt (đó là dữ liệu); tiêu đề bài viết tiếng Anh.

## 7. Cách thêm một thứ mới

| Muốn thêm | Làm |
|---|---|
| Công cụ bot mới | Khai trong `contract/tools.ts` (bảng `TOOLS` + `ToolMap` + kiểm input/output), viết một `ToolHandler` ở `brain/engine/tool-handlers.ts`, thêm vào `DEFAULT_HANDLERS`. `PackValidator` tự đối chiếu. |
| Luật cổng mới | Thêm nhánh vào `GateRule`, một lớp `RuleEvaluator`, một dòng trong `EVALUATORS`, độ ưu tiên trong `RULE_PRIORITY`, và bài test "chặn được / không chặn nhầm". |
| Ngành mới | Một tệp `packs/<nganh>.ts` dạng dữ liệu, một dòng trong `pack/registry.ts`. Không đụng `engine/`. |
| Cửa HTTP mới | Một `RequestController` (hoặc một `case` trong controller sẵn có), khai đường ở `protocol.ts`, bài test qua socket thật. |
| Cách lưu license khác | Cài lại `LicenseLedger` cùng giao diện `read()/update()`; `LicenseService` không đổi. |
