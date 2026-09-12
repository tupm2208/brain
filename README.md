# Bộ não — chatbot chạy trên Xeon

**Bản copy nguyên si từ `D:\projects\seller-platform` ngày 12/09/2026** (anh Dũng chốt:
"copy nguyên sang đây đi, để tôi quản lý cho dễ"). Từ nay sửa ở đây, không sửa bên kia.

Một máy chủ duy nhất phục vụ tất cả nhà bán hàng. **Đây là phần anh bán, và là phần khó
sao chép nhất** — nên nó không bao giờ được gửi xuống máy khách.

## Chạy thử

```bash
cd D:\projects\toprunvn_modules\bo-nao
npm install
npm test          # 203 bài (contract + brain)
```

## Nó giữ gì và không giữ gì

- Giữ: luật trả lời, kiến thức từng ngành, cổng an toàn, bảng biến thể, thuật toán khớp sản phẩm.
- **Không giữ**: tồn kho, đơn hàng, số điện thoại, địa chỉ, lịch sử mua của khách hàng.
  Cần số liệu thì hỏi server của shop, dùng xong bỏ.

## Đã copy những gì

| Thư mục | Nội dung |
|---|---|
| `packages/contract` | Giao kèo: kiểu dữ liệu, mã kích hoạt, phễu đăng ký, khung đường dây |
| `packages/brain` | Bộ máy trả lời trung lập + hai bộ luật ngành (giày chạy, nhà thuốc) |
| `SPEC-goc-seller-platform.md` | Đặc tả gốc — đọc để biết vì sao từng luật được chốt như vậy |
| `AGENTS-goc-seller-platform.md` | Luật kiến trúc gốc |

**Không copy**: `packages/omi` (theo hình dạng mới, OMI chỉ là màn hình gọi API nên không
còn giữ dữ liệu), vỏ Electron, và các bài kiểm tra đường dây TLS — đường dây cũ được thay
bằng gọi API vào server của khách.

## Việc còn lại để nó chạy được với server khách

Bộ não hiện nói chuyện qua **đường dây TLS riêng** (thiết kế cũ, OMI giữ dữ liệu). Hình
dạng mới: nó gọi API của server khách. Phải viết lớp nối trong `noi/`:

| Cổng của bộ não | Nối vào đâu |
|---|---|
| `ToolPort` (gọi công cụ) | `POST` các đường dịch vụ của server khách |
| `CatalogPort` (mục lục hàng) | `GET /api/products` — hoặc bỏ hẳn, hỏi thẳng `GET /api/hang-kho/ton/:ma` |
| `MemoryPort` (trí nhớ hội thoại) | Sổ riêng trên Xeon (không phải dữ liệu khách) |
| Nhận tin | Sự kiện `hop-thu.tin-den` từ server khách |
| Trả lời | `POST /api/hop-thu/gui` |

Mọi đường đều cần mã dịch vụ riêng (`BO_NAO_TOKEN`), không dùng chung mã quản trị.

Hai module thuộc bộ não theo bản đồ 13 mảnh: `chatbot-cskh`, `nhu-cau-cho`.
