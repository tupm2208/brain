# Bộ não — chatbot chạy trên Xeon

Một máy chủ duy nhất phục vụ tất cả nhà bán hàng. **Đây là phần anh bán, và là phần khó
sao chép nhất** — nên nó không bao giờ được gửi xuống máy khách.

## Nó giữ gì và không giữ gì

- Giữ: luật trả lời, kiến thức từng ngành, cổng an toàn, bảng biến thể, thuật toán khớp sản phẩm.
- **Không giữ**: tồn kho, đơn hàng, số điện thoại, địa chỉ, lịch sử mua của khách hàng.
  Cần số liệu thì hỏi server của shop, dùng xong bỏ.

## Nó nói chuyện với server của khách bằng hai đường

| Đường | Chiều | Việc |
|---|---|---|
| sự kiện `hop-thu.tin-den` | server khách → bộ não | Có khách nhắn tin |
| `POST /api/hop-thu/gui` | bộ não → server khách | Trả lời khách |

Cộng thêm các đường đọc số liệu (`/api/products`, `/api/orders/...`) khi các module đó
tách xong. Mọi đường đều cần mã quản trị.

## Mã nguồn đang ở đâu

Bản viết mới bằng TypeScript nằm ở `D:\projects\seller-platform` (`packages/brain`):
bộ máy trung lập + bộ luật ngành thay được (giày chạy, nhà thuốc), 526 bài kiểm tra.
Thư mục này giữ phần **nối bộ não đó vào server của khách** — chưa bắt đầu.

Hai module thuộc bộ não theo bản đồ 13 mảnh: `chatbot-cskh`, `nhu-cau-cho`.
