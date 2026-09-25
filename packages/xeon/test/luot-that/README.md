# Lượt thật — bài test đóng từ bug thật

Mỗi tệp `.json` ở đây là MỘT lượt bot trả lời khách đã từng sai, đóng lại bằng:

```
npm run chan-doan dong-bai <maHoiThoai> --ghi-chu "vì sao đáng giữ"
```

`luot-that.test.mts` diễn lại tất cả trong mỗi lần `npm test`. Một bài không còn tái hiện được
nghĩa là **hồi quy** — có thay đổi vừa đổi cách bot xử ca đó.

Dữ liệu cá nhân trong bài đã thay bằng **bút danh cố định** (cùng một số điện thoại → cùng một bút
danh ở mọi chỗ), vì bài test sống mãi trong git còn hồ sơ lượt thì 7–30 ngày là xoá.

Đừng sửa tay: đóng lại bài mới thì hơn.
