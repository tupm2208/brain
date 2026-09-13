# Bộ não — chatbot và license, chạy trên Xeon

Một máy chủ duy nhất phục vụ tất cả nhà bán hàng. **Đây là phần anh bán, và là phần khó sao
chép nhất** — nên nó không bao giờ được gửi xuống máy khách. Từ 14/09/2026 nó còn là **nơi
quản lý license** (anh Dũng chốt): cấp key, đếm máy, ký vé cho OMI và cho chính bộ não.

## Chạy

```bash
cd D:\projects\toprunvn_modules\bo-nao
npm install
npm test          # 227 bài: giao kèo + bộ máy trả lời + license + máy chủ + trang quản trị

XEON_ADMIN_MAT_KHAU=<từ 12 ký tự> XEON_DIA_CHI=https://xeon.toprun.vn PORT=4200 node noi/chay.js
```

Lần chạy đầu nó sinh khoá ký Ed25519 ở `du-lieu/xeon.ky.key.pem` (0600) và sổ `du-lieu/license.json`.
**Sao lưu hai tệp đó.** Mất khoá ký thì mọi landing phải đăng ký lại để nhận khoá công mới.

| Biến | Việc | Không khai thì |
|---|---|---|
| `XEON_ADMIN_MAT_KHAU` | mật khẩu trang `/quan-tri`, từ 12 ký tự | trang quản trị **tắt** |
| `XEON_DIA_CHI` | địa chỉ công khai của Xeon, trả cho landing lúc đăng ký | landing không biết gọi về đâu |
| `XEON_THU_MUC_DU_LIEU` | nơi giữ sổ license + khoá ký | `bo-nao/du-lieu` |
| `XEON_BI_MAT_PHIEN` | bí mật ký cookie phiên admin | sinh mới mỗi lần khởi động (khởi động lại là đăng xuất) |
| `XEON_HTTPS=1` | cookie phiên mang cờ Secure | không |
| `TIN_PROXY=1` | tin IP trong tiêu đề khi có nginx/Cloudflare đứng trước | đọc IP socket |
| `SHOP_JSON`, `MA_NHAN_TIN` | **chế độ cũ, chỉ để chạy thử**: shop khai tay, một mã chung | không dùng |

## Nó giữ gì và không giữ gì

- Giữ: luật trả lời, kiến thức ngành, cổng an toàn, **sổ license và khoá ký**.
- **Không giữ**: tồn kho, đơn hàng, số điện thoại, địa chỉ, lịch sử mua của khách hàng.
  Cần số liệu thì hỏi server của shop, dùng xong bỏ.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `license/` | `khoa-ky.js` khoá ký Ed25519 · `ve-may.js` ký/soi vé · `so-license.js` sổ JSON ghi nguyên tử · `dich-vu.js` luật license |
| `noi/` | `chay.js` điểm khởi động · `may-chu.js` HTTP · `quan-tri.js` hai trang web · `cong-server-khach.js` cổng gọi landing · `tri-nho.js` |
| `noi/trang/` | HTML/JS/CSS của `/quan-tri` (anh) và `/may` (chủ key). CSP chặt, không inline |
| `packages/contract` | Giao kèo: kiểu dữ liệu, mã mảnh, công cụ bot |
| `packages/brain` | Bộ máy trả lời trung lập + hai bộ luật ngành (giày chạy, nhà thuốc). Thiết kế `link/*` cũ (TLS, kích hoạt) đã xoá 14/09/2026 — Xeon quản license ở `license/` |
| `test/` | `license`, `may-chu`, `quan-tri`, và `noi-hai-phan` (cần MySQL 3307, `npm run test:mysql`) |

## Các cửa HTTP

| Đường | Ai gọi | Việc |
|---|---|---|
| `POST /license/kiem` | OMI lúc mở, mỗi 6 giờ | `{ key, maMay, tenMay }` → vé máy 7 giờ + địa chỉ landing + cờ trực |
| `POST /license/truc` | OMI mỗi 5 phút | `{ key, maMay }` → `{ truc }` |
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

## Còn nợ (xem `KE-HOACH-BAN-RA.md`, đợt L5)

- Danh sách công cụ vẫn khai cứng ở `cong-server-khach.js`, chưa đọc từ landing; thiếu `policy.get`,
  `variant.chart`, `purchase.eta`, `customer.recognize`.
- `catalog.size()` luôn trả tối đa 1.
- Trí nhớ hội thoại còn trong RAM; sẽ chuyển về landing qua API.
- Không có hàng đợi: Xeon tắt lúc tin đến là tin đó bot không trả lời.
