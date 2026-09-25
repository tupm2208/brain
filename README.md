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
| 3 — shop | hồ sơ shop (xưng hô, hãng, hàng order/cọc/COD, mặc cả, chốt đơn, câu "không có", chủ đề chuyển người, khối ngành đã tắt/viết lại) + ba ô chính sách + chính sách từng kho | landing của shop, doc `tro-ly-ai-ho-so-chatbot`; Xeon đọc qua công cụ `shop.profile` mỗi lượt, không lưu | shop, trên OMI → Huấn luyện AI → **Chatbot** (máy trực, hoặc chủ shop / người được cấp quyền trên web) |

Quy tắc cứng:
- Con số của một shop (cọc %, số ngày, giá) **không bao giờ** nằm trong `nganh/` hay `loi-chung/`: bộ soi
  (`checkBlocksFree`) từ chối và Xeon không khởi động. Khối ngành dùng chỗ trống `{banHang.tiLeCoc}`,
  dòng `[?banHang.coHangOrder] …` chỉ giữ khi shop đã khai.
- Ô tầng 3 chưa khai → lời dặn ghi "CHUA KHAI" và bot chuyển người, không lấy gợi ý ngành, không lấy số shop khác.
- Đoạn "năng lực hệ thống" trong lời dặn **tự sinh** (`systemCapabilities`) từ công cụ landing đang mở và mô hình
  nhìn có sẵn — không viết tay nữa.
- Thứ tự ghép (`composeSystemPrompt`): tầng 1 → tầng 2 (khối đã tắt/viết lại theo hồ sơ) → hồ sơ shop → kiến thức shop dạy + ghi chú ảnh → năng lực (ghi đè khi mâu thuẫn) → giao thức công cụ.
- Máy luật nhận gói ngành đã phủ hồ sơ shop (`applyShopProfile`): xưng hô, hãng, câu "không có", câu cấm cộng dồn ba tầng.
- Cửa cho tab Chatbot: `POST /ai/mau-ho-so` (gợi ý + khối + vân tay) và `POST /ai/loi-dan-xem-thu` (lời dặn thật cho shop lúc này).
- Đánh giá: `node bo-nao/scripts/danh-gia-chatbot.mjs that|kich-ban …` chạy hội thoại qua hộp cát, ghi `logs/danh-gia/`.

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
| 1 | Nền lượt | `TurnContextBuilder` (`turn-context.ts`) | đọc `conversation.recent`, dán nhãn ba loại tác giả (bot / người / không rõ), tin khách đang trả lời vào, thẻ người trực vừa gửi trong 30 phút, sổ hội thoại + phiên mua trong bộ nhớ, **khung hội thoại** (`dialogue-frame.ts`: "42", "ok" là câu trả lời cho câu page vừa hỏi). Người trực vừa nhắn <5 phút → bot im. Hồ sơ shop (tầng 3) đọc **một lần** đầu lượt. |
| 2 | Đọc ảnh | `ImageIntake` (`image-intake.ts`) | tải ảnh về (thử lại 1,5 s vì CDN Meta), hỏi mô hình ảnh là **loại gì** (sản phẩm / biên lai / màn hình đơn / khác), khớp catalog qua `catalog.matchImage`; ảnh page vừa xin để đo size là **tham chiếu**, không phải hàng bán. Biên lai → câu trung tính + gọi người, **không mô hình nào viết**. |
| 3 | LLM#1 | `ContextAnalyzer` (`context-analyzer.ts`) | đọc cả hội thoại, trả ý định + mẫu (tách hãng/dòng/đời) + biến thể + nhu cầu + mẫu chính + tối đa 3 lệnh tra cứu; nhiệt độ 0, JSON; hỏng → `null`, lượt vẫn chạy. Trần `XEON_AI_PHAN_TICH_MS`; chỉ tối đa 15 s của nó tính vào ngân sách 60 s của lượt. |
| 4 | Bộ định tuyến | `RuleRouter` (`rule-router.ts`, `intent-rules.ts`, `entities.ts`) | 15 ý định Desk + ba bộ nhận diện ngữ nghĩa (`paidMoney`, `deposit`, chào thuần), trích thực thể (size, SĐT, hãng, mã, nhu cầu, ngân sách, địa chỉ, tín hiệu chốt), sửa theo khung hội thoại, hoà giải với LLM#1 (`local_script_override`, `payment_claim_demoted`…). Kết quả: `script_reply` gửi ngay · `ask_clarification` gửi và đếm · `human_handoff` (khiếu nại, báo đã chuyển tiền) · `agent_draft`. Mọi câu là JSON (`kich-ban-chung.json` ⊕ `kich-ban.json`); chỗ trống shop chưa khai → **không dùng kịch bản đó**. |
| 5 | Sự thật | `groundTruth` trong pipeline + `catalog-score.ts`, `catalog-resolver.ts`, `uncertain-product.ts`, `focus-resolver.ts`, `stock-facts.ts`, `CatalogVerifier` | Desk bước 5–7, **trước khi mô hình nào viết**: bậc thang tồn (`catalog.resolveStock` của landing, hoặc Xeon tự đi từng nấc `catalog.find` theo `planStockCascade`), chấm điểm ứng viên, kết luận một/nhiều/không mẫu (`needVerify`), **LLM#2** xác nhận khi chỉ có một phỏng đoán yếu, chọn mẫu đang nói tới theo thứ tự tin cậy Desk, dựng sự thật tồn theo size/kho, tra đơn + nhận khách (`order.lookup`, `customer.recognize`) theo SĐT khách **tự gõ**. Cổng "chưa chắc mẫu" có thể kết thúc lượt ở đây (hỏi lại **một lần**, hãng không bán, link danh mục). |
| 6 | Ghi chú | `FactNoteComposer` (`fact-note.ts`) + `ledger.ts`, `episode.ts` | ghi chú hệ thống 9 khối của Desk (VAN_DON đứng đầu vì cắt 4000 ký tự từ cuối) + khung + mẫu chính + ảnh + đọc của LLM#1. |
| 7 | Agent tầng 2 | `SalesAgent` | chạy khi có mô hình, ngành có sổ tay, landing mở đủ công cụ, còn quota. Cổng sập cả lượt → nghỉ 5 s, chạy lại **một** lần (bỏ dấu vết lần đầu). |
| 8 | LLM#3 nháp | `DraftWriter` (`draft-writer.ts`) | lưới dưới agent: **một** lần gọi, không công cụ, prompt gọn (`LEAN_CORE` + luật theo tình huống + 8–12 câu người trực thật + guardrails cắt 12k) từ sự thật đã có; qua **cùng** bộ soát của agent. |
| 9 | Máy luật | `TurnEngine` | lưới cuối, nhận ý định của bộ định tuyến làm gợi ý. Đã thử mô hình mà máy luật cũng không hiểu → chuyển người + báo shop, không nói câu chào suông. |
| 10 | Cổng soát, gửi kèm, gửi | `ReplyGate` (`reply-gate.ts`), `ReplyDispatcher` (`dispatcher.ts`) | vòng 2 **sau** khi mô hình viết (Desk `enforceReplyEvidence` + `enforcePolicyClaims`): **sửa** chứ không chặn — cắt câu, đổi số, thay câu an toàn, nối link tra cứu, `needsHuman` không bao giờ lật lại. Rồi quyết định gửi kèm: ≤2 thẻ sản phẩm (≥3 mã còn hàng → link lọc), phiếu đặt hàng (`order.formLink`) khi chốt được mã + size và shop chốt qua phiếu, ảnh đo chân, chào AI lần đầu — landing gửi qua `POST /api/hop-thu/gui`, trả `ketQua.daGui`. |
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
| 2 đọc ảnh | `xem-anh.json` | `xem-anh.json` |
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
| `GET /health` | | còn sống, mấy shop |
| `/quan-tri` | anh | cấp key, khoá/mở, gia hạn, đổi mảnh, xem máy, bỏ máy, chọn máy trực |
| `/may` | chủ key, vào bằng key | xem 3 máy, bỏ máy, chọn máy trực |

Mọi cửa `/license/*` hạn 60 lần / 15 phút một địa chỉ. Đăng nhập admin sai 10 lần / 15 phút là chặn.
Mọi POST của hai trang web phải kèm tiêu đề `X-Yeu-Cau: xeon` (chống CSRF).

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
