# `nganh/` — mỗi ngành hàng là một thư mục JSON

Chốt 21/09/2026. Trước đó bộ luật ngành là tệp TypeScript trong `packages/brain/src/packs/`, nên
mở một ngành mới phải sửa mã, dịch lại và bơm lại bộ não. Giờ **thêm một ngành = thêm một thư mục
ở đây**. Không sửa mã, không dịch, không đụng trang quản trị.

Ngành nào được dùng là do trường `nganh` trên license key của shop (`du-lieu/license.json`), tên
thư mục chính là giá trị đó.

## Một thư mục gồm những gì

Từ 24–25/09/2026 (tái tạo tầng 1 Sales Desk) mỗi bộ phận của đường đi một lượt đọc **một tệp chung**
ở `loi-chung/` và **một tệp ngành** cùng tên (hoặc gần tên) ở đây. Tệp ngành **ghép lên** tệp chung:
danh sách nối thêm, chữ / số ghi đè từng khoá. Ngành không có tệp thì dùng phần chung. Tệp nào cũng có
trường `_doc` nói rõ nó chép từ đâu của Desk và luật gõ. Nạp và soi ở `packages/brain/src/pack/registry.ts`.

**Ai được sửa:** `loi-chung/` — chỉ đội phát triển (đổi là đổi cách hành xử cả nền tảng, phải build +
kiểm thử). `nganh/<id>/` — anh / chuyên gia ngành, không cần dịch mã. **Shop không sửa tệp nào ở đây**;
shop chỉ tắt / viết lại các khối `agent.json` có `shopSua: true` trên OMI (Huấn luyện AI → Chatbot) và
khai hồ sơ tầng 3 ở landing — mọi chỗ trống `{khach}`, `{site}`, `{tenNguoiPhuTrach}`, `{camKetHang}`,
`{banHang.…}` trong JSON được điền từ đó. Con số riêng của một shop (cọc %, số ngày, giá) đặt vào JSON là
bộ soi (`checkBlocksFree`) từ chối, Xeon không khởi động.

### Tệp trong `nganh/<id>/`

| Tệp | Bắt buộc | Bước dùng | Vai trò |
|---|---|---|---|
| `bo-luat.json` | **Có** | máy luật (9) | Luật chatbot: `id` (= tên thư mục), xưng hô, từ điển hãng/dòng, hình dạng mã, trục biến thể, ý định, cổng an toàn, mẫu câu |
| `agent.json` | Không | agent (7) | Sổ tay agent ngành: `khoi[]` (id, tieuDe, `shopSua`, loiDan), `mauHoSo` (gợi ý cho shop mới), `mustHumanPattern`, `handoffReplyPattern`, `tools[].moTa`. **Không có = agent không chạy cho ngành này** |
| `y-dinh.json` | Không | định tuyến (4) | Từ khoá ý định **định ngành**, nối thêm vào `y-dinh-chung.json` theo tên ý định (`ask_size` chỉ có ở đây vì "size" là khái niệm ngành); `reconcile` (vd `asksFootMeasure` cho ảnh đo chân) |
| `thuc-the.json` | Không | định tuyến (4) | Trích thực thể ngành: mẫu size (`sizeCore`, nấc 1/3, rưỡi, tem cm), size quần áo, nhu cầu, form chân, tín hiệu chốt, từ nhiễu trong tên |
| `bang-size.json` | Không | định tuyến (4), cổng soát (10) | Bảng tem Nhật (cm) → size, `rows[]`; "size 265" tra thẳng cột tem |
| `kich-ban.json` | Không | định tuyến (4), cổng chưa chắc mẫu (5) | Kịch bản trả lời cứng của ngành, ghi đè từng kịch bản chung; `hoiLai` = câu hỏi lại theo lý do (chưa rõ mẫu, xin tên, xin ảnh, hãng không bán…). Chỗ trống shop chưa khai → kịch bản đó **không dùng** |
| `khung-hoi-thoai.json` | Không | nền lượt (1) | Phần ngành của khung hội thoại: page hỏi size / hỏi mục đích, tin khách chỉ là số size (`sizeOnly`), hình dạng mã sản phẩm |
| `cham-diem.json` | Không | sự thật (5) | Phần ngành của chấm điểm ứng viên catalog: từ nhiễu, từ chung (air/pro/max), đời số dễ lẫn size (35–52), dòng ngầm định hãng, luật phân loại hàng từ tên, `uncertain` |
| `line-dna.json` | Không | sự thật (5), kiến thức | Dòng sản phẩm (`lines[]`: id, name, aliases, equivalents, beginnerAlternative, purpose, note, ma trận pace × cự ly) — bậc thang tồn đi sang dòng tương đương / dòng cho người mới, và tư vấn theo nhu cầu |
| `xac-nhan-catalog.json` | Không | sự thật (5) | Ví dụ ngành cho LLM#2 (xác nhận mẫu khi chỉ có một phỏng đoán yếu) |
| `xem-anh.json` | Không | đọc ảnh (2) | Mô tả hàng hoá của ngành để mô hình nhìn ảnh đọc đúng |
| `phan-tich-ngu-canh.json` | Không | LLM#1 (3) | Khối lời dặn ngành nối tiếp khối chung; `schema` góp thêm khoá vào JSON chung (vd `needBrief`, cách tách tên mẫu) |
| `ghi-chu-he-thong.json` | Không | ghi chú (6) | Lời định ngành của ghi chú hệ thống cho agent (size, trả kho, môn thể thao, tem cm), ghi đè từng khoá |
| `soan-nhap.json` | Không | LLM#3 (8) | Luật + guardrails ngành cho nháp dự phòng, cùng cơ chế `khi` (tình huống) |
| `vi-du-nguoi-truc.json` | Không | LLM#3 (8) | Câu người trực thật theo tình huống (`k` khách / `n` người trực): bot học độ dài + giọng, không chép số liệu |
| `cong-soat.json` | Không | cổng soát (10) | Phần ngành của cổng soát sau nháp: cách nói còn/hết size, size nấc lẻ, bảo hành / "bao check" / chính hãng, size quy từ cm phải theo `bang-size.json` |
| `kien-thuc.json` | Không | xưởng nội dung | Kiến thức ngành của Xeon: chữ gọi ngành, họ nghiên cứu, luật chấm dòng, bảng đánh giá, câu hỏi Fit Finder |
| `mau-mac-dinh.json` | Không | xưởng nội dung | Bộ mẫu sản phẩm mặc định cho nút "Nạp lại mẫu mặc định" (`{ "mau": [...] }`) |
| `nghien-cuu.md` | Không | xưởng nội dung | Prompt nghiên cứu; khai tên tệp ở `kit.researchPrompts` trong `kien-thuc.json` |

### Tệp trong `loi-chung/` (tầng 1, mọi ngành — mọi shop, kể cả nhà thuốc, đều chịu)

| Tệp | Bước dùng | Vai trò |
|---|---|---|
| `agent-chung.json` | agent (7) | Lời dặn chung cho agent mọi ngành: `khoi[]`, `mustHumanPattern`, `cauCam`, `handoffReplyPattern`. Không tên hãng, tên mẫu, con số shop nào |
| `y-dinh-chung.json` | định tuyến (4) | 15 ý định Desk (`rules`), ý định giao dịch át xã giao, chào thuần, `paidMoney` / `paidAboutGoods` (báo đã chuyển tiền, loại trừ câu về hàng), `deposit` (hỏi cọc ≠ báo đã cọc), `paymentFrame`, 7 luật `reconcile` hoà giải với LLM#1 |
| `thuc-the-chung.json` | định tuyến (4) | SĐT, mã sản phẩm dự phòng / bỏ qua, địa chỉ, ngân sách, giới tính, tín hiệu chốt, size chữ |
| `kich-ban-chung.json` | định tuyến (4) | Kịch bản cứng chung (`scripts`) + `hoiLai`; câu ghi nhận chuyển khoản là câu **trung tính** — bot không bao giờ tự nói đã nhận tiền |
| `khung-hoi-thoai.json` | nền lượt (1) | Khung hội thoại + phiên mua: page vừa hỏi gì (`pageTurn`), đồng ý / từ chối / tham chiếu, mẫu link sản phẩm, câu trả lời ngắn, chữ mô tả khung |
| `so-hoi-thoai.json` | nền lượt (1), nhớ (11) | Chữ khung của sổ hội thoại (ledger) và nhãn ảnh: tiêu đề, nhãn trường / trạng thái / nguồn, ghi chú chốt hàng ngoài |
| `xem-anh.json` | đọc ảnh (2) | Lời dặn mô hình nhìn ảnh: loại ảnh (sản phẩm / biên lai / màn hình đơn / khác); schema JSON cố định trong mã |
| `phan-tich-ngu-canh.json` | LLM#1 (3) | Lời dặn chung LLM#1: đọc cả hội thoại, rút ý định + thực thể + mẫu chính, không kết luận giá / tồn / chính sách; `lenhTraCuu`, `schema`, `nhan` |
| `cham-diem-chung.json` | sự thật (5) | Trọng số chấm điểm, ngưỡng giữ ứng viên, hình dạng SKU, luật đọc nhãn size, cổng "chưa rõ mẫu thì hỏi lại" (`uncertain`), câu chữ sự thật tồn kho (`texts`) |
| `xac-nhan-catalog.json` | sự thật (5) | Lời dặn LLM#2: ứng viên nào đúng là mẫu khách nói, được phép trả "không mã nào" |
| `ghi-chu-he-thong.json` | ghi chú (6) | Câu khung 9 khối ghi chú hệ thống cho agent, thứ tự `order` (VAN_DON đầu vì cắt 4000 ký tự từ cuối) |
| `soan-nhap.json` | LLM#3 (8) | Prompt nháp dự phòng: `heThong`, `cauChuyenNguoi`, `luat` với `luon` (LEAN_CORE) / `khi` (tình huống), `guardrails`, `nhomViDu` |
| `cong-soat-chung.json` | cổng soát (10) | Luật soát sau nháp chung: danh tính bot, "đã nhận tiền", xin SĐT khi chốt, cọc / số tiền không nguồn, hứa đổi trả không chính sách, xin thêm ảnh → link, link trang khác, ETA, link tra cứu, tư vấn |

Đang có: `giay-chay` (đủ mọi tệp trên), `nha-thuoc` (mới có luật + chữ gọi ngành, chưa có dòng nào).

## Thêm một ngành

1. Chép một thư mục có sẵn, đổi tên thành mã ngành (chữ thường, số, gạch ngang — ví dụ `my-pham`).
2. Sửa `id` trong `bo-luat.json` **và** `kien-thuc.json` cho **khớp tên thư mục**. Lệch là báo lỗi
   lúc khởi động, vì license trỏ theo tên thư mục.
3. Sửa nội dung. Xoá tệp nào không cần (trừ `bo-luat.json`).
4. Bật lại Xeon. Lúc khởi động nó đọc, kiểm và in ra: `[nganh] doc tu ... : giay-chay, my-pham`.
5. Cấp key với ngành mới — ô **Ngành** trên trang quản trị lấy thẳng từ thư mục này.

Sai một trường thì Xeon **không khởi động** và nói rõ trường nào sai, ví dụ
`` `identity.tone` phai la mot danh sach ``. Thà gãy lúc bật còn hơn 11 giờ đêm bot im lặng.

## Vài quy ước khi gõ JSON

- **Chữ dài viết thành mảng dòng.** `systemPrompt`, `staticText`, `generalPrompt`… nhận cả chuỗi
  lẫn mảng chuỗi; mảng được nối lại bằng xuống dòng. Playbook 200 dòng nhét vào một chuỗi JSON thì
  không ai sửa nổi, mà không sửa nổi thì luật sai nằm đó mãi.
- **Biểu thức chính quy là chuỗi**, nên dấu `\` phải gõ đôi: `"\\d+"`, `"\\bpickleball\\b"`.
- **Mẫu câu không được có số viết cứng** — mọi con số phải đến từ dữ liệu, nếu không cổng "không
  bịa số" sẽ chặn chính câu của mình.
- **Cụm cấm và mẫu cấm phải có dấu tiếng Việt đầy đủ**: cổng soi câu có dấu, "đôi" khác "đổi".
- **Ba cổng bắt buộc**: `no_unsourced_numbers`, `forbidden_phrases`, `no_facts_when_offline`.
- Mỗi **trục biến thể** phải có ví dụ tự kiểm (`examples`); máy chạy các ví dụ đó lúc nạp, sai là
  báo ngay. Một trục bắt hụt từng bị báo cho khách thành "hết hàng".

Chi tiết từng trường: `packages/brain/src/pack/types.ts` (luật) và
`packages/xeon/src/knowledge/industry-packs.ts` (kiến thức). Cách đọc tệp:
`packages/xeon/src/knowledge/industry-files.ts`.

## Đổi chỗ để thư mục này

Mặc định Xeon đọc `bo-nao/nganh/`. Đặt `XEON_THU_MUC_NGANH` trong `.env` để trỏ đi nơi khác (ví dụ
một thư mục dữ liệu ngoài mã nguồn, sửa không cần đụng repo).
