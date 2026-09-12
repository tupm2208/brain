# Seller Platform — quy tac bat buoc cho AI

Doc file nay truoc khi sua bat ky thu gi trong repo nay. Doc them `SPEC.md` de biet
QUYET DINH da chot, va vi sao chot nhu vay.

## Nguyen tac khong duoc pha

1. **Ba khoi roi nhau.** OMI chay tren may khach hang, Brain chay tren Xeon, Storefront chay tren web.
   Hong mot khoi khong duoc keo sap hai khoi kia.
2. **Thu gi quy thi dung gui di.** Kien thuc nganh, cong an toan cua bot, bang bien the,
   thuat toan khop san pham — tat ca o lai Brain. OMI chi co phan van hanh.
   Mot ban OMI bi lay trom phai tro nen vo dung.
3. **Xeon khong giu du lieu khach.** Chi giu muc luc hang hoa. Moi thu day len phai qua
   `assertCatalogClean()`. Khong duoc noi long cong nay de "cho tien".
4. **Bot khong duoc chi tien.** Moi cong cu deu khai `effect`; khong cong cu nao mo cho bot
   duoc mang `effect: "money"`. Viec tieu tien luon dung cho nguoi that duyet.
5. **Manh ngang hang khong goi thang nhau.** Chi duoc phu thuoc xuong ba manh loi
   (`hang-kho`, `don-khach`, `lien-ket`). Con lai phai di qua bang tin su kien.
   `assertModuleGraph()` lam viec nay gay ngay khi bi vi pham.
6. **Co cong chinh thuc thi dung cong chinh thuc.** Tin nhan Fanpage di Graph API.
   Trinh duyet dieu khien chi danh cho trang nha cung cap khong co API.
7. **Khong nhanh rieng cho tung khach.** Moi khac biet giua khach phai nam o cau hinh
   hoac bo luat nganh, khong nam o ma.
8. **Tran 15 manh** cho khach chon. Muon them manh thu 16 thi phai gop hai manh cu.

## Truoc khi sua

- Sua `packages/contract` = ca ba khoi cung doi. Sua xong phai chay `npm run build && npm test`.
- Moi luat kien truc moi phai kem MOT bai kiem tra lam no gay khi bi vi pham.
  Luat chi nam trong tai lieu thi som muon cung bi pha.
- Khong rewrite ca tep de tranh loi font; chi vá nho va kiem lai chu tieng Viet vua sua.
- Chu thich viet tieng Viet KHONG DAU (nhat quan voi he TopRun, tranh loi font tren Windows).
  Chuoi hien cho nguoi dung thi viet co dau day du.

## He TopRun dang chay

`D:\projects\toprun-sales-desk`, `D:\projects\toprunvn`, `D:\projects\dasbui-landing`.
**Khong duoc dung vao.** Nen tang moi lon len song song; chi chuyen sang khi chay tot hon han.
Duoc phep DOC de tham chieu logic, khong duoc sua.

## Kiem tra

```bash
npm run build   # dich TypeScript, che do chat
npm test        # bai kiem tra giu luat kien truc
```
