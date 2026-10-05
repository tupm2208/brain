# Bộ não — chatbot và license, chạy trên Xeon

Một máy chủ duy nhất phục vụ tất cả nhà bán hàng. **Đây là phần anh bán, và là phần khó sao
chép nhất** — nên nó không bao giờ được gửi xuống máy khách. Từ 14/09/2026 nó còn là **nơi
quản lý license**: cấp key, đếm máy, ký vé cho OMI và cho chính bộ não.

Từ 14/09/2026 toàn bộ mã viết lại bằng **TypeScript, hướng đối tượng, tên tiếng Anh**, chia ba
gói. Giao thức với landing và OMI (đường HTTP, tên trường JSON, biến môi trường, tệp
`license.json`, vé máy) **giữ nguyên**. Chuẩn thiết kế: `DESIGN.md`.

## Chạy

```bash
cd D:\projects\toprunvn_modules\bo-nao
npm install
npm test          # dịch rồi chạy 267 bài: giao kèo + bộ máy + license + máy chủ + trang quản trị
npm run check     # kiểm kiểu cả mã lẫn test, không dịch

cp .env.example .env   # rồi điền XEON_ADMIN_MAT_KHAU, XEON_DIA_CHI, ANTHROPIC_API_KEY...
npm start
# npm start = node packages/xeon/dist/main.js (phải npm run build trước; npm test đã build sẵn)
```

Biến đọc từ **`.env` ở gốc repo này** (`bo-nao/.env`, mẫu `.env.example`) — repo chạy độc lập nên
giữ tệp riêng. `.env` không vào git. Biến đặt sẵn trong môi trường đè lên tệp.

Lần chạy đầu nó sinh khoá ký Ed25519 ở `du-lieu/xeon.ky.key.pem` (0600) và sổ `du-lieu/license.json`.
**Sao lưu hai tệp đó.** Mất khoá ký thì mọi landing phải đăng ký lại để nhận khoá công mới.

| Biến | Việc | Không khai thì |
|---|---|---|
| `PORT` | cổng nghe | 4200 |
| `XEON_ADMIN_MAT_KHAU` | mật khẩu trang `/quan-tri`, từ 12 ký tự | trang quản trị **tắt** |
| `ANTHROPIC_API_KEY` | khoá AI cho bộ viết bài, giữ một lần trên Xeon cho mọi shop | cửa viết bài trả 503 |
| `XEON_MO_HINH_VIET` | mã mô hình của bộ viết bài | `claude-opus-5` |
| `FACEBOOK_APP_SECRET` | App Secret của app Meta nhà phát triển (một app cho mọi shop): kiểm chữ ký webhook | `/meta/webhook` trả 503 |
| `FACEBOOK_VERIFY_TOKEN` | chuỗi Meta gửi lại khi đăng ký địa chỉ webhook `<XEON_DIA_CHI>/meta/webhook` | Meta không xác minh được địa chỉ |
| `META_GRAPH_API_VERSION` | phiên bản Graph API khi hỏi Meta về trang | `v23.0` |
| `XEON_DIA_CHI` | địa chỉ công khai của Xeon, trả cho landing lúc đăng ký | landing không biết gọi về đâu |
| `XEON_THU_MUC_DU_LIEU` | nơi giữ sổ license + khoá ký | `bo-nao/du-lieu` |
| `XEON_BI_MAT_PHIEN` | bí mật ký cookie phiên admin | sinh mới mỗi lần khởi động (khởi động lại là đăng xuất) |
| `XEON_HTTPS=1` | cookie phiên mang cờ Secure | không |
| `TIN_PROXY=1` | tin IP trong tiêu đề khi có nginx/Cloudflare đứng trước | đọc IP socket |
| `XEON_AI_CHAT_URL`, `XEON_AI_CHAT_KEY`, `XEON_AI_CHAT_MODEL` | mô hình cho agent trả lời khách và mọi việc AI của Đ7 (nháp, hộp cát, phân tích, đọc ảnh) | agent tắt, máy luật soạn; cửa phân tích / đọc ảnh trả 503 |
| `XEON_SHOP_SUA_BANG_GIA` | danh sách shop (phẩy) được sửa bảng giá AI dùng chung từ OMI | không shop nào sửa được; mọi shop chỉ xem |
| `XEON_AI_PHAN_TICH_MS` | trần thời gian của LLM#1 (phân tích ngữ cảnh) mỗi lượt, ms (25/09/2026) | 15000 |
| `XEON_AGENT_XEM_ANH` | `tat` = agent không còn tự xem ảnh khách, chỉ đọc ghi chú như trước 02/10/2026 (công tắc chung để gỡ sự cố, không phải lựa chọn theo shop) | bật |
| `XEON_CAU_DAO_LOI` | **cầu dao cổng AI**: số lỗi tạm thời trong 5 phút thì mở cầu dao (25/09/2026) | 3 |
| `XEON_CAU_DAO_MO_MS` | cầu dao mở bao lâu, ms; đang mở thì mỗi phút thử một lệnh nhẹ, thành công là đóng | 600000 (10 phút) |
| `SHOP_JSON`, `MA_NHAN_TIN` | **chế độ cũ, chỉ để chạy thử**: shop khai tay, một mã chung | không dùng |

## Triển khai cPanel (không cần Terminal)

Repo `github.com/tupm2208/brain` clone thẳng làm *Application root* (Git Version Control), Node 24,
startup file `packages/xeon/dist/main.js`, tên miền `brain.toprun.site`. `.env` tải lên bằng File
Manager (không đặt `PORT`); `du-lieu/` (sổ license + khoá ký) chép từ máy đang chạy — thiếu khoá ký
thì mọi vé máy OMI mất hiệu lực và landing phải đăng ký lại.

- **Build sau mỗi lần cập nhật:** Git Version Control → Pull or Deploy → *Update from Remote* rồi
  *Deploy HEAD Commit*. `.cpanel.yml` chạy `scripts/cpanel/build.sh`: npm install cả dev → nối lại gói
  workspace bằng đường tuyệt đối (trên cPanel `node_modules` là symlink sang nodevenv) → build.
  Nhật ký ở `~/brain-logs/build-*.log`.
- **Nạp bản mới:** Setup Node.js App → *Restart*; nếu vẫn chạy mã cũ thì *Run JS script* → `tien-trinh:tat`.
- **Kiểm tra:** `https://brain.toprun.site/health`.

## Nó giữ gì và không giữ gì

- Giữ: luật trả lời, kiến thức ngành, cổng an toàn, **sổ license và khoá ký**.
- **Không giữ**: tồn kho, đơn hàng, số điện thoại, địa chỉ, lịch sử mua của khách hàng.
  Cần số liệu thì hỏi server của shop, dùng xong bỏ. Trí nhớ hội thoại nằm ở landing của shop.
- **Một ngoại lệ có chủ ý — hồ sơ lượt** (21/09/2026, `XEON_HO_SO_THU_MUC`, mặc định **TẮT**):
  khi bật, mỗi lượt trả lời được ghi đủ để **tra nguyên nhân và diễn lại bug** — lời khách, lịch
  sử, kết quả công cụ, prompt đã dựng, câu bị chặn. Có giữ một phần dữ liệu khách (SĐT, địa chỉ)
  **có thời hạn**: 7 ngày với lượt thường, 30 ngày với lượt hỏng, rồi tự xoá. Không bao giờ giữ mật
  khẩu / OTP / thẻ / token. Hồ sơ là **tệp trên máy Xeon**, đọc bằng công cụ `chan-doan`, và
  **không bao giờ** đi ra `/nhat-ky` (đường đó mở công khai).
  Chi tiết: `../KE-HOACH-NHAT-KY-CHAN-DOAN.md`.

## Cấu trúc: ba gói

| Gói | Vai trò | Thư mục chính |
|---|---|---|
| `@sp/contract` | Giao kèo cho cả ba phần: kiểu định danh, chuẩn hoá chữ, tiền, sự kiện, mục lục và cổng chặn PII, bảng công cụ, bảng mảnh, quyền theo license | `packages/contract/src` |
| `@sp/brain` | Bộ máy trả lời thuần, không mạng: `TurnEngine` và các cộng sự (`IntentDetector`, `ItemResolver`, `VariantNumberScanner`, `ToolDispatcher`, `GateChain`, `TemplateRenderer`), hồ sơ ngành và bộ soi (`PackValidator`), mục lục trong bộ nhớ | `packages/brain/src` |
| `@sp/xeon` | Ứng dụng máy chủ: license (`LicenseService`, `LicenseLedger`, `SigningKeyStore`), cổng sang landing (`LandingGateway`), `BrainService`, lớp HTTP (chuỗi controller, `RateLimiter`, `AdminSessionManager`), hai trang web, điểm khởi động `main.ts` | `packages/xeon/src`, `packages/xeon/pages` |

Kit vé máy (ký + soi) nằm ở `../chung/ve-may.js`, dùng chung với landing; gói xeon bọc kiểu
TypeScript lên nó ở `support/ticket-kit.ts`.

Test: `packages/*/test/*.test.mts` (TypeScript, Node 24 chạy thẳng, không cần dịch);
`packages/xeon/test-mysql/integration.test.mts` cần MySQL 3307 (`npm run test:mysql`).

## Ba tầng lõi (24/09/2026)

Mọi thứ bộ não dùng để trả lời khách xếp vào ba tầng; luật mới xếp theo phép thử: *nhà thuốc cũng
phải tuân?* → tầng 1; *mọi shop giày phải?* → tầng 2; còn lại → tầng 3.

| Tầng | Là gì | Ở đâu | Ai sửa |
|---|---|---|---|
| 1 — nền tảng | ống dẫn tin, vòng agent, cổng an toàn (mã) + `loi-chung/agent-chung.json` (khối lời dặn chung, mẫu "phải người thật", câu cấm) | mã Xeon + `loi-chung/` | đội phát triển |
| 2 — ngành | `nganh/<id>/agent.json`: `khoi[]` (id, tieuDe, shopSua, loiDan), `mauHoSo` (gợi ý cho shop mới), `tools[].moTa`; `bo-luat.json` cho máy luật | `nganh/` | anh / chuyên gia ngành |
| 3 — shop | hồ sơ shop (xưng hô, điều kiện chung hàng order/cọc/COD, mặc cả, chốt đơn, câu "không có", chủ đề chuyển người, khối ngành đã tắt/viết lại) + ba ô chính sách + chính sách từng kho | landing của shop, doc `tro-ly-ai-ho-so-chatbot`; Xeon đọc qua công cụ `shop.profile` mỗi lượt, không lưu | shop, trên OMI → Huấn luyện AI → **Chatbot** (máy trực, hoặc chủ shop / người được cấp quyền trên web) |

Quy tắc cứng:
- Con số của một shop (cọc %, số ngày, giá) **không bao giờ** nằm trong `nganh/` hay `loi-chung/`: bộ soi
  (`checkBlocksFree`) từ chối và Xeon không khởi động. Khối ngành dùng chỗ trống `{banHang.tiLeCoc}`,
  dòng `[?banHang.thoiGianOrder] …` chỉ giữ khi shop đã khai. Hàng sẵn hay order là loại kho (kết quả `tra_kho`), không có ô khai riêng (05/10/2026).
- Ô tầng 3 chưa khai → lời dặn ghi "CHUA KHAI" và bot chuyển người, không lấy gợi ý ngành, không lấy số shop khác.
- Đoạn "năng lực hệ thống" trong lời dặn **tự sinh** (`systemCapabilities`) từ công cụ landing đang mở và mô hình
  nhìn có sẵn — không viết tay nữa.
- Thứ tự ghép (`composeSystemPrompt`): tầng 1 → tầng 2 (khối đã tắt/viết lại theo hồ sơ) → hồ sơ shop → kiến thức shop dạy + ghi chú ảnh → năng lực (ghi đè khi mâu thuẫn) → giao thức công cụ.
- Máy luật nhận gói ngành đã phủ hồ sơ shop (`applyShopProfile`): xưng hô, hãng, câu "không có", câu cấm cộng dồn ba tầng.
- Cửa cho tab Chatbot: `POST /ai/mau-ho-so` (gợi ý + khối + vân tay) và `POST /ai/loi-dan-xem-thu` (lời dặn thật cho shop lúc này).
- Cửa cho bảng giá của shop (02/10/2026, `packages/xeon/src/selling-price/`): `POST /kho/mau-bang-gia` → `{ nganh, mau[] }` =
  mẫu chung `loi-chung/mau-bang-gia.json` rồi mẫu ngành `nganh/<id>/mau-bang-gia.json` (không có tệp = không có mẫu ngành);
  `POST /kho/bang-gia/hieu-y` → `{ bang, hieuLa, chuaRo }`: lời shop kể thành bảng, lời dặn ở `loi-chung/bang-gia-hieu-y.json`,
  mô hình viết bài (`ANTHROPIC_API_KEY`, thiếu thì 503). Xeon tự soát sau mô hình: giá trị không có trong danh mục shop bị bỏ
  (điều kiện mất hết giá trị thì bỏ cả dòng), dòng cụ thể bị dòng chung che thì đưa lên — mọi chỗ sửa ghi đầu `chuaRo`.
  Ngành lấy theo license (key còn hạn + landing đã đăng ký), **không** đòi đã mua chatbot. Xeon không định giá, không lưu bảng.
- Đánh giá: `node bo-nao/scripts/danh-gia-chatbot.mjs that|kich-ban …` chạy hội thoại qua hộp cát, ghi `logs/danh-gia/`.

### Nhận ảnh khách: so với ảnh catalog (01/10/2026)

Mô hình nhìn ảnh **không đọc được đời/phiên bản** của hàng chụp ngoài đời (ca sadida: Pegasus 41 đọc thành 40,
mọi model thử đều có lúc sai, tự chấm 0.95). Nên ở bước [2]:

1. Lời dặn đọc ảnh chỉ cho ghi phiên bản khi **đọc được chữ** trên ảnh.
2. Ảnh không khớp vân tay → tra kho bằng **tên dòng đầy đủ** đọc được (từ khoá ngắn chỉ khi không ra), lấy tối đa 10 ảnh
   catalog (mỗi tên một ảnh trước), thu nhỏ 512/256 px (`sharp`), đặt **nhãn ngay trước từng ảnh**, gọi model **2 lần song song**.
3. Bốn cơ chế nền, không phụ thuộc ca nào: chỉ điều **hai lần cùng chọn** mới là "cùng mẫu"; **chữ đọc được thắng hình đoán**
   (số đời đọc trên ảnh loại ứng viên mang số khác); nhóm "cùng mẫu" chứa **nhiều số đời theo tên kho** = ảnh không phân biệt
   được → tất cả thành "có thể"; chỉ kết luận "kho không có" khi ứng viên **đúng dòng** đã đọc.
4. Ghi chú cho agent: giống / cùng mẫu khác màu / không có đúng đời / CHƯA CHẮC — luôn "em thấy giống…" + khách xác nhận
   trên ảnh shop (khối `anh-khach-gui` của `loi-chung/agent-chung.json`).

Đo bằng ảnh thật: `node bo-nao/scripts/do-nhan-anh.mjs [--lan 3]` (ảnh + đáp án ở `bo-nao/bo-do-anh/`, chấm theo AN TOÀN:
đúng / chưa chắc / nguy hiểm). 01/10: 10 đúng, 3 chưa chắc (Evo SL ↔ Evo SL 2 — ảnh catalog hai đời giống hệt), 0 nguy hiểm.

### Agent tự xem ảnh khách (02/10/2026, anh chốt: mặc định cho mọi shop)

Đo 30 ảnh thật × 2 lần (kho tin Desk + sadida + `bo-do-anh`): agent chỉ đọc ghi chú ảnh **72%** đúng; ghi chú **+ agent
tự nhìn ảnh** **87%** đúng, 0 nhận nhầm; agent nhìn một mình (bỏ bước [2]) 77–85% nhưng **5% nhận nhầm**; model đắt
hơn không đúng hơn. Nên giữ bước [2] và thêm:

1. Ảnh của lượt (đã tải ở bước [2], thu về 1600 px) **đính kèm tin lịch sử** của agent (`AgentVision`, sống như `tools`,
   không ghi vào hồ sơ lượt — hồ sơ chỉ giữ địa chỉ ở `xemAnh.anh`).
2. Công cụ `xem_anh`: chỉ mở ảnh khách gửi trong 30 phút gần nhất (`[ANH url=...]` trong lịch sử, `LOOK_BACK_MS`) hoặc ảnh
   trong trường `anh` của kết quả `tra_kho` — địa chỉ model tự bịa bị từ chối.
3. Mỗi lần gọi kết thúc bằng câu nhắc `xemAnh.nhacSauAnh` + chế độ JSON: thiếu nó, Gemini nhìn ảnh hay trả lời bằng
   function call mà cổng không mang được (`malformed_function_call`, rỗng ~½ số lần).
4. Ghi chú bước [2] viết thành **gợi ý để agent kiểm lại** (mã đã chốt vẫn là sự thật, cấm đổi); LLM#3 không thấy ảnh nên
   nhận bản ghi chú cũ (`noteBlind`). Hai lần so bất đồng nói "CHƯA CHẮC", không còn "không mẫu nào cùng dòng".
5. Vân tay đối chiếu với tên dòng đọc được (`crossCheckFingerprint`): đo được vân tay một mình chưa chốt đúng ca nào, các
   kết quả "hơi giống / ảnh dùng chung" đều sai mã → chỉ giữ mã mang tên dòng đọc được; vân tay khớp mà lệch tên dòng chỉ
   còn là "có thể"; mã in đọc được giữ nguyên.
6. Tên dòng chưa xác nhận được nhớ thành nhãn `[ảnh: đoán là … — chưa xác nhận]` thay cho "không đọc được".

Lời dặn ở `loi-chung/agent-chung.json` (mục `xemAnh` + khối `anh-khach-gui`). Tắt cho cả nền tảng khi có sự cố:
`XEON_AGENT_XEM_ANH=tat` trong `bo-nao/.env` rồi bật lại Xeon — không có ô bật/tắt theo shop.

### Đường đi một lượt (tầng 1 Desk, 24–25/09/2026)

Từ 24/09 tầng 1 không còn là "ống dẫn + vòng agent" nữa: **thứ tự Sales Desk trả lời một tin**
(`server.js` → `ai_router.js` → `maybeRunLevel2Agent` → gửi) được tái tạo thành `TurnPipeline`
(`packages/xeon/src/brain/turn-pipeline.ts`). Luật quyết định chép sang gói `@sp/brain` dạng
**mã thuần + JSON**, phần gọi mạng/mô hình nằm ở gói xeon. Cùng một đường cho cửa thật
(`/tin-den`, chế độ `gui`) và cho Soạn bot / Demo AI (`khong-gui`: không gửi, không báo, không ghi
nhớ, công cụ chỉ đọc) — nên "bot sẽ nói gì" trên màn hình **chính là** thứ bot nói.

```
tin khách ─► [1] nền lượt ─► [2] đọc ảnh ─► [3] LLM#1 ─► [4] bộ định tuyến ─┬─ kịch bản / hỏi lại / gọi người ─► [10]
                                                                            └─ agent_draft
                 ─► [5] sự thật (tra tồn, đơn, khách; chấm điểm; LLM#2; cổng chưa chắc mẫu)
                 ─► [6] ghi chú cho mô hình ─► [7] agent tầng 2 ─(hỏng/hết quota/cầu dao)─► [8] LLM#3 nháp ─(hỏng)─► [9] máy luật
                 ─► [10] cổng soát + gửi kèm + gửi ─► [11] nhớ + hồ sơ lượt
```

| # | Bước | Mã | Là gì |
|---|---|---|---|
| 1 | Nền lượt | `TurnContextBuilder` (`turn-context.ts`) | đọc `conversation.recent`, dán nhãn ba loại tác giả (bot / người / không rõ), tin khách đang trả lời vào, thẻ người trực vừa gửi trong 30 phút, sổ hội thoại + phiên mua trong bộ nhớ, **khung hội thoại** (`dialogue-frame.ts`: "42", "ok" là câu trả lời cho câu page vừa hỏi). Người trực vừa nhắn tay hoặc đang gõ trong **cửa sổ nhường** (ô hồ sơ `chuyenNguoi.phutNhuong`, trống = 5 phút; tin bot, dòng hệ thống Meta, tin không rõ nguồn không tính) → bot im; hết cửa sổ Xeon xin landing giao lại lượt (`/api/hop-thu/tiep-quan`), người trực có nút "Bot trả lời tiếp"; người ra tay trong lúc bot soạn thì landing bỏ câu bot (`human-yield.ts`, 05/10/2026). Hồ sơ shop (tầng 3) đọc **một lần** đầu lượt. |
| 2 | Đọc ảnh | `ImageIntake` (`image-intake.ts`) | tải ảnh về (thử lại 1,5 s vì CDN Meta), hỏi mô hình ảnh là **loại gì** (sản phẩm / biên lai / màn hình đơn / khác), khớp catalog qua `catalog.matchImage`; ảnh không khớp vân tay thì **so với ảnh catalog của chính shop** (01/10/2026, xem dưới); ảnh page vừa xin để đo size là **tham chiếu**, không phải hàng bán. Biên lai → câu trung tính + gọi người, **không mô hình nào viết**. |
| 3 | LLM#1 | `ContextAnalyzer` (`context-analyzer.ts`) | đọc cả hội thoại, trả ý định + mẫu (tách hãng/dòng/đời) + biến thể + nhu cầu + mẫu chính + tối đa 3 lệnh tra cứu; nhiệt độ 0, JSON; hỏng → `null`, lượt vẫn chạy. Trần `XEON_AI_PHAN_TICH_MS`; chỉ tối đa 15 s của nó tính vào ngân sách 60 s của lượt. |
| 4 | Bộ định tuyến | `RuleRouter` (`rule-router.ts`, `intent-rules.ts`, `entities.ts`) | 15 ý định Desk + ba bộ nhận diện ngữ nghĩa (`paidMoney`, `deposit`, chào thuần), trích thực thể (size, SĐT, hãng, mã, nhu cầu, ngân sách, địa chỉ, tín hiệu chốt), sửa theo khung hội thoại, hoà giải với LLM#1 (`local_script_override`, `payment_claim_demoted`…). Kết quả: `script_reply` gửi ngay · `ask_clarification` gửi và đếm · `human_handoff` (khiếu nại, báo đã chuyển tiền) · `agent_draft`. Mọi câu là JSON (`kich-ban-chung.json` ⊕ `kich-ban.json`); chỗ trống shop chưa khai → **không dùng kịch bản đó**. |
| 5 | Sự thật | `groundTruth` trong pipeline + `catalog-score.ts`, `catalog-resolver.ts`, `uncertain-product.ts`, `focus-resolver.ts`, `stock-facts.ts`, `CatalogVerifier` | Desk bước 5–7, **trước khi mô hình nào viết**: bậc thang tồn (`catalog.resolveStock` của landing, hoặc Xeon tự đi từng nấc `catalog.find` theo `planStockCascade`), chấm điểm ứng viên, kết luận một/nhiều/không mẫu (`needVerify`), **LLM#2** xác nhận khi chỉ có một phỏng đoán yếu, chọn mẫu đang nói tới theo thứ tự tin cậy Desk, dựng sự thật tồn theo size/kho, tra đơn + nhận khách (`order.lookup`, `customer.recognize`) theo SĐT khách **tự gõ**. **Hồ sơ tư vấn** (`consult-profile.ts`, 05/10/2026): khách gọi đích danh mẫu → không hỏi nhu cầu / hồ sơ; nhu cầu phổ thông → khối PHO_THONG; nhu cầu chuyên môn → đã biết / còn thiếu / page đã hỏi (mỗi thông tin một lần trong phiên) → khối HO_SO_TU_VAN, khung nhiều dòng chỉ khi hồ sơ đủ, cổng `consultAsk` cắt câu hỏi lại. Cổng "chưa chắc mẫu" có thể kết thúc lượt ở đây (hỏi lại **một lần**, hãng không bán, link danh mục). |
| 6 | Ghi chú | `FactNoteComposer` (`fact-note.ts`) + `ledger.ts`, `episode.ts` | ghi chú hệ thống 9 khối của Desk (VAN_DON đứng đầu vì cắt 4000 ký tự từ cuối) + khung + mẫu chính + ảnh + đọc của LLM#1. |
| 7 | Agent tầng 2 | `SalesAgent` | chạy khi có mô hình, ngành có sổ tay, landing mở đủ công cụ, còn quota. Cổng sập cả lượt → nghỉ 5 s, chạy lại **một** lần (bỏ dấu vết lần đầu). Lượt có ảnh: agent **tự xem ảnh** + công cụ `xem_anh` (02/10/2026, xem trên). |
| 8 | LLM#3 nháp | `DraftWriter` (`draft-writer.ts`) | lưới dưới agent: **một** lần gọi, không công cụ, prompt gọn (`LEAN_CORE` + luật theo tình huống + 8–12 câu người trực thật + guardrails cắt 12k) từ sự thật đã có; qua **cùng** bộ soát của agent. |
| 9 | Máy luật | `TurnEngine` | lưới cuối, nhận ý định của bộ định tuyến làm gợi ý. Đã thử mô hình mà máy luật cũng không hiểu → chuyển người + báo shop, không nói câu chào suông. |
| 10 | Cổng soát, gửi kèm, gửi | `ReplyGate` (`reply-gate.ts`), `ReplyDispatcher` (`dispatcher.ts`) | vòng 2 **sau** khi mô hình viết (Desk `enforceReplyEvidence` + `enforcePolicyClaims`): **sửa** chứ không chặn — cắt câu, đổi số, thay câu an toàn, nối link tra cứu, `needsHuman` không bao giờ lật lại. Rồi quyết định gửi kèm: ≤2 thẻ sản phẩm (≥3 mã còn hàng → link lọc), phiếu đặt hàng (`order.formLink`) khi chốt được mã + size và shop chốt qua phiếu, ảnh đo chân, chào AI lần đầu — landing gửi qua `POST /api/hop-thu/gui`, trả `ketQua.daGui`. Mỗi câu mang `theoTin` (tin khách mới nhất lượt đã thấy) + `bangChung` (yếu/chắc, số ảnh đọc được, có sự thật): **cửa gửi landing** (`judgeBotTurn`, một lần ghi có khoá trên sổ hội thoại) bỏ câu soạn trên ngữ cảnh cũ (`tinMoi`), bỏ câu trả lời trùng một tin (`daTraLoi`) trừ **đính chính đúng một lần** khi câu trước yếu và lượt sau có bằng chứng mạnh hơn; gửi hỏng trả lại cửa (05/10/2026). |
| 11 | Nhớ + hồ sơ | `rememberTurn` + `DiskDossierStore` | ghi sổ hội thoại, phiên mua, nhãn ảnh **sau** khi đã gửi; hồ sơ lượt v2 ghi **một lần** cuối lượt. |

Ngân sách một lượt: 60 s cho mọi lệnh mô hình (LLM#1 tối đa `XEON_AI_PHAN_TICH_MS`, mặc định 15 s;
agent phần còn lại trừ 5 s và không dưới 10 s; LLM#3 phần còn lại và không dưới 5 s). **Cầu dao cổng AI** (`agent/gateway-breaker.ts`): mọi
ghế mô hình ngồi sau một cổng; `XEON_CAU_DAO_LOI` lỗi tạm thời trong 5 phút → mở `XEON_CAU_DAO_MO_MS`;
đang mở thì lượt đi kịch bản / tra cứu / máy luật ngay, shop được báo **một lần** mỗi kỳ; mỗi phút
thử một lệnh nhẹ, thành công là đóng.

**Tệp JSON mới của tầng 1 và tầng 2** (nạp qua `packages/brain/src/pack/registry.ts`; tệp ngành
**ghép lên** tệp chung: danh sách nối thêm, chữ/số ghi đè). Không có tệp ngành thì dùng phần chung.

| Bước dùng | `loi-chung/` (mọi ngành) | `nganh/<id>/` (một ngành) |
|---|---|---|
| 1 khung hội thoại, phiên mua, sổ | `khung-hoi-thoai.json`, `so-hoi-thoai.json` | `khung-hoi-thoai.json` |
| 2 đọc ảnh | `xem-anh.json`, `so-anh-catalog.json` | `xem-anh.json`, `so-anh-catalog.json` |
| 3 LLM#1 | `phan-tich-ngu-canh.json` | `phan-tich-ngu-canh.json` |
| 4 định tuyến | `y-dinh-chung.json`, `thuc-the-chung.json`, `kich-ban-chung.json` | `y-dinh.json`, `thuc-the.json`, `bang-size.json`, `kich-ban.json` |
| 5 sự thật | `cham-diem-chung.json`, `xac-nhan-catalog.json` | `cham-diem.json`, `xac-nhan-catalog.json`, `line-dna.json` (bậc thang dòng tương đương) |
| 6 ghi chú | `ghi-chu-he-thong.json` | `ghi-chu-he-thong.json` |
| 7 agent | `agent-chung.json` | `agent.json`, `bo-luat.json` |
| 8 LLM#3 | `soan-nhap.json` | `soan-nhap.json`, `vi-du-nguoi-truc.json` |
| 10 cổng soát | `cong-soat-chung.json` | `cong-soat.json` |

**Ai sửa tệp nào:** `loi-chung/` — chỉ đội phát triển (build + kiểm thử). `nganh/<id>/` — anh /
chuyên gia ngành. **Shop không sửa tệp JSON nào**; thứ duy nhất shop đụng tới là các khối
`agent.json` có `shopSua: true` (tắt / viết lại trên OMI → Huấn luyện AI → Chatbot, lưu vào hồ sơ
shop `khoiNganh` ở landing) và hồ sơ tầng 3 (xưng hô, `tenNguoiPhuTrach`, `cauChaoAi`, `camKetHang`,
`banHang.*`…) — chỗ trống `{khach}`, `{tenNguoiPhuTrach}`, `{banHang.tiLeCoc}` trong JSON được điền
từ đó. Bộ soi (`checkBlocksFree`) từ chối con số của shop nằm trong JSON. Liệt kê từng tệp:
`nganh/README.md`.

**Hồ sơ lượt v2** (`chan-doan/turn-dossier.ts`, `DOSSIER_VERSION = 2`, 25/09/2026): ngoài `agent` /
`mayLuat` của v1 có thêm `phanTich` (+`phanTichMs`), `router` (quyết định, lý do, ý định sau sửa và
ý định cục bộ, thực thể, `duongOng` = tên các luật đã bắn), `traCuu` (từng lệnh landing trước khi
mô hình viết), `suThat` (tồn, khớp mẫu, mẫu chính, bậc thang, đơn, khách), `nhap` (LLM#3), `ghiChu`,
`cong` (câu mô hình viết / câu đã sửa / luật bắn), `guiKem`, `anh`, `cauDaoMo`. `duongDi` thêm giá
trị `kich-ban` và `nhap`. Hồ sơ v1 vẫn đọc được: mọi trường mới là tuỳ chọn.
`npm run chan-doan -- hoi-thoai <mã>` in theo thứ tự đường đi: PHÂN TÍCH NGỮ CẢNH (LLM#1) → BỘ ĐỊNH
TUYẾN (đường ống, câu kịch bản, gợi ý hỏi lại) → TRA CỨU TRƯỚC LƯỢT → sự thật → agent / SOẠN NHÁP
(LLM#3) → CỔNG SOÁT (model viết / đã sửa) → gửi kèm → máy luật; `--prompt` in prompt đã dựng (và
`ghiChu` khi agent không chạy), `--day` in đầy đủ kể cả câu mô hình trả thô. `dien-lai` với model giả phát lại đúng câu đã trả
hôm đó phải ra y hệt — hồ sơ thiếu thứ gì thì `chan-doan` nói rõ.

## Các cửa HTTP

| Đường | Ai gọi | Việc |
|---|---|---|
| `POST /license/kiem` | OMI lúc mở, mỗi 6 giờ | `{ key, maMay, tenMay }` → vé máy 7 giờ + địa chỉ landing + cờ trực |
| `POST /license/truc` | OMI mỗi 5 phút | `{ key, maMay }` → `{ truc }` |
| `POST /license/roi` | OMI "rời máy này" | `{ key, maMay }` → `{ conLai }` |
| `POST /license/landing-dang-ky` | bộ cài landing, một lần | `{ key, diaChi }` → khoá công Xeon + mã nhận tin riêng |
| `GET /license/khoa-cong` | ai cũng được | khoá công ký |
| `POST /tin-den` | landing, bằng mã nhận tin riêng | tin khách → bộ não trả lời qua `POST <landing>/api/hop-thu/gui` |
| `POST /meta/xoa-du-lieu` | Meta | "Data deletion callback" của app Meta trung tâm (02/10/2026) — xem mục dưới |
| `POST /meta/go-app` | Meta | "Deauthorize callback" của app Meta trung tâm (02/10/2026) |
| `GET /meta/xoa-du-lieu/trang-thai?ma=` | người dùng Facebook (Meta đưa link) | trang trạng thái yêu cầu, công khai, không có tên người / shop |
| `GET /health` | | còn sống, mấy shop |
| `/quan-tri` | anh | cấp key, khoá/mở, gia hạn, đổi mảnh, xem máy, bỏ máy, chọn máy trực |
| `/may` | chủ key, vào bằng key | xem 3 máy, bỏ máy, chọn máy trực |

Mọi cửa `/license/*` hạn 60 lần / 15 phút một địa chỉ. Đăng nhập admin sai 10 lần / 15 phút là chặn.
Mọi POST của hai trang web phải kèm tiêu đề `X-Yeu-Cau: xeon` (chống CSRF).

## App Meta trung tâm: xoá dữ liệu và gỡ app (02/10/2026)

Anh chốt: **chỉ tự động nút xoá của app Meta**. Khách mua hàng muốn xoá dữ liệu hội thoại thì liên hệ shop,
nhân viên shop xử lý — không đi qua đây.

**Khai trên Meta** (developers.facebook.com → app trung tâm), với `<xeon>` = `XEON_DIA_CHI` (máy này:
`https://brain.elevenvoice.site`):

| Ở đâu | Chọn / ô | Dán |
|---|---|---|
| App settings → Basic → **User data deletion** | chọn **Data deletion callback URL** | `https://<xeon>/meta/xoa-du-lieu` |
| Facebook Login → Settings | **Deauthorize callback URL** | `https://<xeon>/meta/go-app` |

Cần `FACEBOOK_APP_SECRET` (thiếu thì hai cửa trả 503). Link trang trạng thái lấy từ `XEON_DIA_CHI` (thiếu thì
lấy Host của lời gọi). Xeon phải được build + bật lại mới có hai cửa này.

**Chạy thế nào** (`meta/signed-request.ts`, `meta/app-users.ts`, `meta/data-deletion.ts`, `http/meta-controller.ts`):

1. Lúc đăng nhập Facebook (Đ6), Xeon đọc id theo app của người đăng nhập (`me?fields=id`) và chỉ giữ
   **HMAC-SHA256(App Secret, id)**. Khi landing **nhận** trang (`/meta/dang-nhap/ket-qua`) thì ghi người → shop →
   mã trang vào `du-lieu/meta-nguoi-cap-quyen.json`. Không giữ id thô, tên, email, token. Đọc id hỏng thì vẫn
   kết nối bình thường, chỉ ghi nhật ký. Trang được người khác đăng nhập nối lại SAU thì thuộc người sau.
2. Meta gọi một trong hai cửa với `signed_request` (form hoặc JSON). Sai chữ ký / sai thuật toán / thân hỏng →
   400, ghi nhật ký, không đổi gì.
3. Mỗi shop người đó đã nối: ngắt định tuyến các trang shop đó còn giữ (`license.disconnectPages`), rồi gọi
   landing `POST /api/hop-thu/quen-trang` `{ trang, lyDo: "nguoi-cap-quyen-go-app" }` bằng vé dịch vụ — landing
   xoá token và đánh dấu `matKetNoi` để OMI thấy trang cần nối lại. Xong thì xoá người khỏi sổ.
4. Ghi yêu cầu theo **mã xác nhận** 12 ký tự (giữ 180 ngày, tối đa 5.000, không bao giờ xoá yêu cầu dưới 90
   ngày; không có người trong đó). Cửa xoá dữ liệu trả `{ url: "<xeon>/meta/xoa-du-lieu/trang-thai?ma=…",
   confirmation_code }`; cửa gỡ app trả `{ ok: true }`.

Trạng thái: `da-xoa` · `khong-co-du-lieu` (sổ không có người này — kể cả mọi trang nối **trước 02/10/2026**,
hoặc đã xoá ở lần gọi trước) · `landing-chua-nhan` (landing không trả lời: Xeon đã ngắt, token trên landing
còn đó — xem nhật ký `[meta] … chua xac nhan quen token`). Nhật ký `/nhat-ky` loại **Xoá dữ liệu Meta**, chỉ
ghi 8 ký tự đầu của khoá người.

Lưu ý: trang nối trước 02/10/2026 không có người ghi sổ → muốn được phủ thì shop bấm "Kết nối page" lại một
lần trên OMI. **Đổi App Secret** thì mọi khoá người cũ không khớp nữa (trả `khong-co-du-lieu`) cho tới khi nối lại.

## Vé máy

`VM1.<thân>.<chữ ký>` — thân là JSON `{ vai, shop, maMay, manh, truc, phatLuc, hetLuc, keyId }`,
ký Ed25519 bằng khoá của Xeon. Landing soi bằng khoá công, không gọi Xeon. Vai `quan-tri` cho
OMI (7 giờ), vai `dich-vu` cho bộ não gọi landing (1 giờ). Chi tiết: `../KE-HOACH-BAN-RA.md`.

## Còn nợ

- Không có hàng đợi: Xeon tắt lúc tin đến là tin đó bot không trả lời.
- Landing tìm hàng bằng cả câu (LIKE), bộ não gửi nguyên câu khách → bot không nhận ra món khi
  câu có thêm chữ ("KE0696 còn size nào"). Sửa ở landing (`hang-kho/kho-bang.js`, tách từ khoá).
## Đ7 — AI ở Xeon (17/09/2026)

Cửa `/ai/*` (xác thực bằng mã nhận tin riêng như `/tin-den`; shop suy ra từ mã): `POST /ai/goi-y` (nháp + dấu vết, KHÔNG gửi; `nguon=tu-dong` + chế độ `off` thì bỏ qua), `POST /ai/hop-cat` (Demo AI: bộ nhớ dùng một lần, công cụ chỉ đọc), `POST /ai/phan-tich-lo` (lô hội thoại landing đã ẩn thông tin cá nhân; Xeon ẩn lại lần nữa), `POST /ai/de-xuat-kien-thuc`, `POST /ai/doc-anh`, `POST /ai/token` (sổ token của CHÍNH shop), `POST /ai/ghi-token` (landing khai lượt gọi nó TỰ TRẢ — quét tem ở cổng đối tác dùng khoá của nơi cấp phần mềm, không qua Xeon; chỉ nhận `viec` là `tag_scan`/`stock_image`, gửi nguyên khối `usage` của cổng để Xeon đọc và tính tiền một chỗ), `GET|POST /ai/bang-gia`. `/tin-den` nhận thêm `cheDo`: khác `auto` thì không gửi. Công cụ mới `training.knowledge`: bộ não chỉ đọc mục ĐÃ DUYỆT của shop.

Sổ token: `du-lieu/ai-usage/<yyyy-mm>.ndjson` (một dòng mỗi lượt gọi mô hình, không có chữ khách). Bảng giá: `du-lieu/bang-gia-ai.json` thay cả bảng mặc định (`ai/price-table.ts`).

- Kênh Facebook khi landing chưa có token trang: Xeon trả 500 chung chung thay vì nói rõ.
