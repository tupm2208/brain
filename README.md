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
npm test          # dịch rồi chạy 222 bài: giao kèo + bộ máy + license + máy chủ + trang quản trị
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
| `XEON_DIA_CHI` | địa chỉ công khai của Xeon, trả cho landing lúc đăng ký | landing không biết gọi về đâu |
| `XEON_THU_MUC_DU_LIEU` | nơi giữ sổ license + khoá ký | `bo-nao/du-lieu` |
| `XEON_BI_MAT_PHIEN` | bí mật ký cookie phiên admin | sinh mới mỗi lần khởi động (khởi động lại là đăng xuất) |
| `XEON_HTTPS=1` | cookie phiên mang cờ Secure | không |
| `TIN_PROXY=1` | tin IP trong tiêu đề khi có nginx/Cloudflare đứng trước | đọc IP socket |
| `SHOP_JSON`, `MA_NHAN_TIN` | **chế độ cũ, chỉ để chạy thử**: shop khai tay, một mã chung | không dùng |

## Triển khai cPanel (không cần Terminal)

Repo `github.com/tupm2208/brain` clone thẳng làm *Application root* (Git Version Control), Node 24,
startup file `packages/xeon/dist/main.js`, tên miền `centerbrain.site`. `.env` tải lên bằng File
Manager (không đặt `PORT`); `du-lieu/` (sổ license + khoá ký) chép từ máy đang chạy — thiếu khoá ký
thì mọi vé máy OMI mất hiệu lực và landing phải đăng ký lại.

- **Build sau mỗi lần cập nhật:** Git Version Control → Pull or Deploy → *Update from Remote* rồi
  *Deploy HEAD Commit*. `.cpanel.yml` chạy `scripts/cpanel/build.sh`: npm install cả dev → nối lại gói
  workspace bằng đường tuyệt đối (trên cPanel `node_modules` là symlink sang nodevenv) → build.
  Nhật ký ở `~/brain-logs/build-*.log`.
- **Nạp bản mới:** Setup Node.js App → *Restart*; nếu vẫn chạy mã cũ thì *Run JS script* → `tien-trinh:tat`.
- **Kiểm tra:** `https://centerbrain.site/health`.

## Nó giữ gì và không giữ gì

- Giữ: luật trả lời, kiến thức ngành, cổng an toàn, **sổ license và khoá ký**.
- **Không giữ**: tồn kho, đơn hàng, số điện thoại, địa chỉ, lịch sử mua của khách hàng.
  Cần số liệu thì hỏi server của shop, dùng xong bỏ. Trí nhớ hội thoại nằm ở landing của shop.

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
- Kênh Facebook khi landing chưa có token trang: Xeon trả 500 chung chung thay vì nói rõ.
