# Ban dac ta — Seller Platform

Ban day du co so do, bang bieu va form tra loi:
https://claude.ai/code/artifact/71639399-5b67-4e6f-95d3-dab66e3cd53d

Tep nay la ban rut gon cho MAY doc: chi giu quyet dinh va luat ma ma nguon phai tuan theo.
Khi hai ban lech nhau, ban tren web la ban dung — cap nhat lai tep nay.

---

## 1. Ba khoi

- **OMI** — may nha ban hang. Kho, don, khach, doi tac, tien, van chuyen, lien ket tai khoan.
  Chay duoi dang ung dung co san nhan trinh duyet ben trong.
- **Brain** — Xeon cua chu nen tang, phuc vu moi khach. Nhan tin tu kenh, hieu y khach,
  goi cong cu sang OMI lay so that, soan cau, qua cong an toan roi moi gui.
- **Storefront** — gian hang tren web. Mot bo ma, nhieu ten mien.

Bot **khong** doan ton kho tu tri nho. Moi lan tra loi ve so lieu deu hoi thang OMI.

## 2. Quyet dinh da chot

| # | Quyet dinh | Chon |
|---|---|---|
| QD1 | Ngon ngu | **TypeScript**, bien dich ra CommonJS (Electron va module native con vuong ESM) |
| QD2 | Lop du lieu | **SQLite mac dinh o OMI, doi sang MySQL bang mot dong cau hinh**; Brain dung MySQL. Cong tac nay phai co tu dot 1 |
| QD3 | Ai giu du lieu | **OMI giu ban goc. Xeon chi giu muc luc hang hoa** — khong so dien thoai, khong dia chi, khong lich su mua, khong gia von |
| QD4 | Pham vi dot 1 | Khung ba khoi chay that + hai bo luat nganh |
| — | Gop module | **Ba mang, muoi ba manh** (09/09) |
| — | Giao hang | **Mot ban cai duy nhat + ma kich hoat ky so** |
| — | Pheu dang ky | Cau hoi kin quyet dinh module bang luat; AI chi duoc **de nghi** them |
| — | Dat hang that | **LUON dung cho nguoi duyet**. Khong co che do tu dat theo tran tien |
| — | Phien nen | Chay an, kem dai nhat ky nho o man Hom nay |
| — | Ten man | "Lien ket tai khoan" |

Con treo: ten nen tang, nganh thu hai lam pack mau, cach ban, cho dung thu the nao.

## 3. Ba mang, muoi ba manh

**Van hanh ban hang (7)** — cai cay, ban re, giu chan khach
`hang-kho`(loi) · `don-khach`(loi) · `lien-ket`(loi) · `van-chuyen` · `tien` · `mua-ho` · `gian-hang`

**Content (3)** — dong thu hang thang thu nhat
`xuong-noi-dung` · `xuong-video` · `goi-noi-dung`(Xeon)

**Chatbot (3)** — dong thu hang thang thu hai
`hop-thu` · `chatbot-cskh`(Xeon) · `nhu-cau-cho`(Xeon)

Ba mang nay vua la cach sap module, vua la cach chao gia.

## 4. Luat ma ma nguon phai giu

Moi luat duoi day co MOT ham kiem tra va MOT bai test lam no gay khi bi vi pham.

| Luat | Cho kiem | Bai test lam no gay |
|---|---|---|
| Manh ngang hang khong goi thang nhau; chi tro xuong manh loi | `assertModuleGraph()` | "BAT DUOC: phu thuoc ngang hang" |
| Manh o hai may khac nhau khong phu thuoc ma nguon vao nhau | `assertModuleGraph()` | "BAT DUOC: phu thuoc xuyen may" |
| Khong duoc co vong tron phu thuoc | `assertModuleGraph()` | "BAT DUOC: vong tron giua hai manh loi" |
| Su kien phat ra phai co nguoi nghe (hoac khai la tieu thu ben ngoai) | `assertModuleGraph()` | "BAT DUOC: su kien phat ra ma khong ai nghe" |
| Bot khong duoc chi tien | `assertToolsSafeForBot()` | "BAT DUOC: nguoi khai sai effect de lach cong" |
| Xeon khong giu du lieu khach hay gia von | `assertCatalogClean()` | "CHAN: so dien thoai nam trong o thuoc tinh tu do" |
| Manh tat thi cong cu bien mat voi bot | `enabledTools()` | "manh tat thi cong cu bien mat voi bot" |
| Het han thue thi Brain ngung phuc vu | `enabledTools()` | "giay phep het han thi bot khong con cong cu nao" |
| Ban OMI qua cu bi tu choi phuc vu | `isCompatible()` + `RejectFrame` | "so sanh phien ban ban giao keo" |
| Khung tu mang phai du truong moi duoc tin | `parseLinkFrame()` | "parseLinkFrame khong tin khung thieu truong" |
| Tien tren don chi co mot goc | `moneyOnOrder()` | "tien tren don di qua mot goc duy nhat" |
| Xeon khong LUU du lieu ca nhan cua khach | `assertNoStoredPII()` | "QUYET DINH 3: so dien thoai khach KHONG duoc luu tren Xeon" |
| Khong khang dinh tren ket qua kho bi cat | `stock.lookup` doc `truncated` | "ket qua kho bi cat thi khong duoc khang dinh gi" |
| Chua biet bien the bat buoc thi khong cong don ton | `needAxis` | "truc KHONG bat buoc khong duoc vo hieu cong cua truc bat buoc" |
| Hoi lai qua so lan cho phep thi goi nguoi that | `askBackCount` | "hoi lai nhieu lan cach xa nhau van phai goi nguoi that" |
| Mau cau lo o thay the rong thi khong gui | `render().missing` | "o thay the do HO SO dat ten cung phai duoc canh" |
| Moi mau cau gui khach (KE CA trong y dinh) deu bi soi | `validatePack` | "bo soi ho so soi CA mau cau nam trong y dinh" |
| Cau THAT SU gui di phai qua cong mot lan nua | lan soi thu hai trong `handleTurn` | "cum bi cam trong CAU HOI LAI khong duoc den tay khach" |
| Mau cau gui khach phai viet co dau | `validatePack` | (cong an toan soi cau bot dua vao dau de phan biet "đôi" voi "đổi") |
| Tran tien do voi TONG DON, khong do voi so nguoi goi tu khai | `order.approve` | "tran tien do voi TONG DON, khong do voi con so nguoi goi tu khai" |
| Chi duyet don NHAP — khong duyet lai don da xong | `order.approve` | "chi duyet don NHAP — duyet lai don da xong khong duoc xoa so khoan da thu" |
| Doi tien va ghi nhat ky nam tron trong mot giao dich | `order.approve` trong `db.tx` | "nhat ky hong thi tien KHONG doi" |
| Nhat ky ghi nguoi DA XAC THUC, khong ghi ten tu khai | `ghiNhatKy(c.actor)` | "nhat ky ghi nguoi DA XAC THUC, khong ghi ten nguoi goi tu khai" |
| Ma don nhap phai duy nhat | `order.draft` | "hai don nhap cung mot mili giay van ra hai ma khac nhau" |
| Goi lai cung khoa chong trung khong tao them don | `order.draft` + cot `idem_key` | "goi lai cung khoa chong trung thi ra cung don, khong tao them" |
| Vai tro tra tu bang `staff` cua chinh shop, khong tu loi tu khai | `loadActor()` | "vai tro tra tu bang nhan vien cua chinh shop, khong tu loi tu khai" |
| Bot chi mo duoc don khach da tu chung minh TRONG hoi thoai do | `moDon()` + bang `conv_order` | "bot o hoi thoai khac khong mo duoc don cua nguoi la" |
| Chu tu do cua nguoi ban duoc soi truoc khi ra khoi may | `redactPII` chieu di ra | "chu tu do cua nguoi ban duoc soi truoc khi ra khoi may" |
| So dien thoai chuan hoa o CA duong ghi lan duong doc | `chuanHoaSo()` | "so dien thoai chuan hoa o CA duong ghi lan duong doc" |
| Chua tim gi thi khong duoc bao "da tim het" | `catalog.search` | "chua tim gi thi khong duoc bao la da tim het" |
| `asOf` la moc cua DU LIEU, khong phai moc cua cau hoi | cot `stock.updated_at` | "asOf la moc cua DU LIEU, khong phai moc cua cau hoi" |
| Bien the phai thuoc dung mon; so luong la so nguyen duong | `order.draft` | "bien the phai thuoc dung mon da chon" |
| Cau co LIMIT deu phai co ORDER BY (hai may cat cung mot tap) | quet ma nguon | "cau lay ung vien co ORDER BY — hai may phai cat cung mot tap" |
| MOI cau SQL cham vao bang du lieu deu co dieu kien nha ban hang | quet ma nguon | "MOI cau SQL cham vao bang du lieu deu phai co dieu kien nha ban hang" |
| Ba khoi phu thuoc dung mot chieu | quet `import` that | "ba khoi phu thuoc dung mot chieu: Bo nao va OMI khong bao gio goi nhau" |
| Hai giao dich song song khong chay tran vao nhau | `taoHangDoi()` | "hai giao dich song song khong chay tran vao nhau" |
| Cau lenh le khong chui vao giao dich cua luot goi khac | `ngoiGiaoDich` (`AsyncLocalStorage`) | "cau lenh le KHONG duoc chui vao giao dich cua luot goi khac" |
| Cau ghi tien phai doc SO DONG that su bi doi | `SqlDriver.run` tra ve so dong | "duyet tien ma khong doi duoc dong nao thi PHAI bao that bai" |
| Kho da cai san tren may khach phai nang cap duoc | `BUOC_NANG_CAP` + `migrate` | "kho ban CU tren may khach nang cap len ban moi va chay duoc" |
| Ma hoi thoai chi co MOT nguon su that | `hoiThoaiCua()` | "ma hoi thoai trong goi tin khac ma hoi thoai cua luot goi thi bi tu choi" |
| Cua dut chia khoa mo don phai de lai dau vet (khong kem so dien thoai) | `order.lookup` ghi nhat ky | "tra don de lai dau vet, va dau vet KHONG chua so dien thoai" |
| Vai tro tra tu bang nhan vien, khong tu loi tu khai | `xacThucVaiTro()` -> `loadActor()` | "tu khai vai tro cao hon khong mo them duoc gi" |
| Sua mot phan mot don khong duoc xoa phan con lai | `capNhatDon()` (khac `replaceOrder`) | "sua mot phan mot don KHONG duoc xoa so tien da tra va dong hang" |
| Moi o chu tu do di ra deu duoc soi | `soiKetQua()` o `callTool` | "moi o chu tu do di ra deu duoc soi, khong chi rieng trang thai don" |
| Khoa chong trung duy nhat TRONG MOT hoi thoai | chi muc `order_idem` | "khoa chong trung khong duoc dut don cua khach khac" |
| Cau co LIMIT phai xep theo thu tu TOAN PHAN | quet ma nguon | "cau co LIMIT phai xep theo mot thu tu TOAN PHAN, khong chi co ORDER BY" |
| Bot khong co ma hoi thoai o KHUNG thi khong duoc lay ma trong goi tin | `hoiThoaiCua()` | "bot khong co ma hoi thoai o KHUNG thi khong duoc lay ma trong goi tin" |
| Ngu canh giao dich phai duoc DONG LAI khi giao dich xong | `NgoiGiaoDich.xong` | "loi hua bi bo quen khong con mang theo ngu canh giao dich" |
| Ket noi MySQL duoc tra ve ho trong MOI truong hop | `motGiaoDich()` | "MySQL: ket noi duoc tra ve ho ke ca khi mo giao dich that bai" |
| Buoc nang cap chiu duoc chay lai (mat dien giua chung) | `DA_CO_ROI` | "nang cap bi NGAT giua chung thi lan sau chay tiep duoc" |
| Ma cu chay tren kho moi thi tu choi, khong dong dau lui | `migrate` kiem `cu > SCHEMA_VERSION` | "ma CU chay tren kho MOI thi tu choi, khong lang le dong dau lui" |
| Kho moi tinh va kho da nang cap co cung hinh dang | `ddl` va `BUOC_NANG_CAP` khai cung dinh nghia | "kho MOI TINH va kho DA NANG CAP co cung mot hinh dang" |
| So tai khoan ngan hang cua shop khong bi che nham | `REDACT_PHONE_RE` doi hoi dau so di dong | "so tai khoan ngan hang cua shop KHONG bi che" |
| Cho mien tru cua bot bam theo ID, khong theo vai tro tu khai | `xacThucVaiTro()` | "nhan vien da nghi tu khai la bot cung khong lam duoc gi" |
| Kho khong biet minh la ban may van mo duoc | `banHienTai()` | "kho ban 1 bi NGAT truoc khi dong dau van mo duoc" |
| Chu shop tu viet ve chinh minh khong bi soi | `CONG_CU_CUA_SHOP` | "chu SHOP TU VIET VE CHINH MINH khong bi soi" |
| Cong cu moi mac dinh BI SOI | quet ma nguon | "cong cu MOI mac dinh BI SOI — muon mien phai ghi ten vao danh sach" |
| Viec phat ra tu giua giao dich chi chay SAU khi chot | `sauKhiChot()` | "viec hen o GIAY DAU cua mot giao dich DAI van an toan" |
| Cho lay ket noi MySQL co han gio | `layKetNoi()` | "MySQL: cho lay ket noi qua han thi BAO LOI, khong im" |
| Doi lai khi hai giao dich cham nhau co gioi han | `DUNG_NHAU` + `lan >= 1` | "MySQL: doi lai khi dung nhau co GIOI HAN, khong doi mai" |
| Mau che bao trum mau do | `redactPII` / `findPIIInText` | "mau che phai bao trum mau do — khong thi cong chan se nem tren chu da don sach" |
| O ma `assertCatalogClean` chan thi cong cu cung phai soi | `CONG_CU_CUA_SHOP` chi co `policy.get` | "o ma assertCatalogClean DANG chan thi cong cu cung phai soi" |
| Ten kho la ten nguoi ban dat, khong bi soi | `O_CUA_SHOP` | "ten kho la ten do nguoi ban dat — khong bi soi" |
| Viec hen chay SAU khi chot, ngoai khoi bat loi va ngoai hang doi | `chayViecDaHen()` | "viec hen chay SAU khi da chot — quay dau sau do khong cuon no lai" |
| Viec hen hong khong bien giao dich da chot thanh that bai | `chayViecDaHen()` nem loi rieng, co `daChot` | "viec hen NEM LOI thi bao ro la giao dich DA CHOT" |
| Ket noi cap MUON hon han gio phai duoc tra ve ho | `layKetNoi()` | "MySQL: ho cap ket noi MUON hon han gio thi ket noi do phai duoc tra lai" |
| Ngay thang va ma lo khong bi che nham | mau che bo `/`, them `(?!\d)` | "ngay thang va ma lo trong trang thai don khong bi che nham" |
| Moi co che giao dich phai duoc cai o CA HAI duong | quet `sqlite.ts` doi chieu `mysql.ts` | "moi co che giao dich phai duoc cai o CA HAI duong, khong chi SQLite" |
| Moi co che giao dich co MOT bai chay qua duong MySQL gia | quet bo bai | "moi co che giao dich deu co MOT bai chay qua duong MySQL gia" |
| Viec hen hong khong lam giao dich chay lai | `daChot` doc TRUOC `code` | "MySQL: viec hen hong KHONG lam giao dich chay lai, du loi mang ma dung nhau" |
| Viec hen cua lan da quay dau khong chay theo lan sau | ngoi moi moi lan thu | "MySQL: viec hen cua lan thu DA QUAY DAU khong duoc chay theo lan thu sau" |
| Ket qua giao dich song sot qua loi viec hen | `LoiSauKhiChot.ketQua` | "viec hen hong thi nguoi goi VAN lay lai duoc ket qua cua giao dich" |
| Tra ket noi cap muon khong duoc giet tien trinh | `try/catch` quanh `release()` | "MySQL: ho da dong ma ket noi ve muon thi KHONG duoc giet tien trinh" |
| Bot cua PHIEN nay chi nhan ket qua cua phien nay | `taoToolPort` kiem `sessionId` | "ket qua cua PHIEN KHAC khong duoc tra vao nguoi dang cho o phien nay" |
| Luot goi cua bot phai co ma hoi thoai ngay o bien mang | `parseLinkFrame` | "khung goi cua bot THIEU ma hoi thoai bi chan ngay o bien mang" |
| Giao dich da chot khong bao gio bi bao that bai qua day | `taoBoPhucVu` doc `daChot` | "giao dich DA CHOT khong bao gio bi bao la that bai" |
| Cong chong bia so doc duoc tien da dinh dang | `TIEN_TE_RE` trong `scanNumbers` | "cong chong bia so DOC DUOC dang tien da dinh dang" |
| Moi con so trong cau gui khach co trong dan chung SAU khi dinh dang | doi chieu `numbersIn(reply)` voi `facts` | "cau bot noi va dan chung phai khop nhau SAU khi dinh dang" |
| Chi neu ten mon thi ho so quyet dinh do la y dinh gi | `intentWhenItemNamed` | "chi neu ten mon thi hieu la hoi hang: hoi size, roi '42' la cau tra loi" |
| Khong tim thay mon nao khong phai bang chung doi mon | `coTuChuLa` / `coMonKhac` | "cau hoi tiep chi co con so va tu dem KHONG lam mat tam diem" |
| Tu chu la van la doi mon | `coTuChuLa` | "tu CHU la thi van la doi mon — khong duoc tra ton adidas cho cau hoi ve Salomon" |
| So tran doi chieu nhan kho, chi khi khop DUNG MOT nhan | `doanTrucTuSoTran` | "so tran khop HAI nhan thi KHONG doan — hoi lai van hon doan sai" |
| So tran doan duoc THAY gia tri dinh tu luot truoc, nhung khong de len truc vua rut ra | `slotsThisTurn` | "so tran KHONG duoc de len truc khach vua noi ro trong chinh cau do" |
| Ma luot goi duy nhat theo CUA, khong chi theo phien | `tienTo = randomUUID()` | "noi lai giu nguyen ma phien: ket qua MUON cua luot da bo khong duoc nhan lam luot moi" |
| Bo nao KIEM khung ket qua tu mang, va kiem hinh dang theo cong cu | `parseLinkFrame` + `kiemOutput` | "Bo nao KIEM khung ket qua tu mang — khung hong khong duoc nhan" |
| OMI kiem hinh dang input tung cong cu | `kiemInput` | "OMI kiem hinh dang input TUNG cong cu: dau vao rac la bad_input, khong phai 'het hang'" |
| Loi thoang qua cua kho khong duoc giet tien trinh OMI | `loadActor` trong `try` | "kho bao ban (SQLITE_BUSY) luc tra vai tro thi tra KHUNG LOI, khong giet tien trinh" |
| Tran luot song song giu duoc voi nguoi that | giu cho truoc `await` | "tran luot song song giu duoc ca voi NGUOI THAT" |
| Lenh huy phai co nguoi nghe | `xuLyHuy` + `daHuy` | "Bo nao huy luot thi luot chua bat dau KHONG chay" |
| So tran canh tu so luong / tien / can nang KHONG duoc doan | `soTranTrongCau` | "so tran dung canh tu chi so luong / can nang / tien thi KHONG doan" |
| Gia tri DOAN chi song trong luot | `slotsDoan` tach khoi `slots` | "gia tri DOAN chi song trong luot, khong bam dinh sang luot sau" |
| Neu ten mon KEM noi dung khac thi khong phai hoi hang | `conGiNgoaiTenMon` | "neu ten mon KEM noi dung khac thi KHONG phai hoi hang" |
| Mon moi ten thuan so van la doi mon | `soLaTenMon` | "mon moi co ten THUAN SO (New Balance 574) van la doi mon" |
| Tu dem nam o HO SO nganh, khong nam trong bo may | `lexicon.fillerWords` | "tu dem nam o HO SO, khong nam trong bo may" |
| Tra loi duoc thi lan hoi nguoc truoc coi nhu xong | xoa `lastAskBackAt` khi `send && answered` | (bai "gia tri DOAN chi song trong luot" — luot thu ba) |
| So tran chi duoc doan khi dung sau TU BAO HIEU bien the (danh sach TRANG) | `TU_BAO_HIEU` trong `soTranTrongCau` | "X2: so khong dung sau tu bao hieu bien the thi KHONG doan (nha thuoc)" |
| Gia tri THUAN SO tu mau cua ho so cung phai qua cong so tran | `soHopLe` truoc khi ghi `slots` | "X1: mau size KHONG duoc doc tien thanh size, va khong luu gia tri do" |
| Con so tra loi cho o vua hoi khong lam doi mon | `!traLoiBangSo` trong `coMonKhac`/`soLaTenMon` | "con so tra loi cho o vua hoi KHONG bi coi la ten mon khac (Vitamin C 500)" |
| Goi mon bang ten ngan khong lam mat tam diem | `stillAboutFocus` nhan ung vien dau bang la mon cu | "goi mon bang TEN NGAN khong lam mat tam diem" |
| Ten mon hai chu so van la doi mon | `coSoHaiChuSo` | "ten mon HAI chu so (Air Max 90) van la doi mon" |
| Chao suong khong xoa moc hoi lai | `send && answered` | "N4: chao suong khong xoa moc hoi lai — hoi -> alo -> hoi lai la chuyen nguoi that" |
| `kiemOutput` kiem RUOT: tung dong kho co `qty` huu han, tung don co tien | `soHuuHan`, `moiPhanTu`, `tienTrenDon` | "kiem ca RUOT: dong kho thieu qty, don thieu tien, deu la loi" |
| `ton` khong huu han thi de rong cho cong o rong bat | `Number.isFinite(total)` | "dong kho thieu qty thi khong duoc noi 'Con NaN doi'" |
| Lenh huy chi cho luot cua BOT, va co han | `daHuy: Map<id, han>` + `actor.id === bot` | "lenh huy KHONG giet duoc luot cua nguoi that" |
| Khung hello phat lai (nonce cu) bi tu choi dut khoat | `f.nonce !== nonce` + chu ky bao nonce | "khung hello PHAT LAI (nonce cu) bi tu choi" (dot bien D1 la TUONG DUONG: chu ky da bao nonce nen bo kiem nonce rieng khong doi hanh vi) |
| Chu ky sai / ban giao keo cu bi tu choi voi ma rieng | `kiemChuKy`, `isCompatible` | "chu ky bang khoa KHAC bi tu choi; ban giao keo qua cu bi tu choi voi ma rieng" |
| Khoa may cap cho shop/may khac thi KHONG mo phien | `khoa.tenant !== f.tenant \|\| khoa.machine !== f.machine` | "khoa may hop le nhung cap cho SHOP KHAC / MAY KHAC: tu choi, khong mo phien" |
| Giay phep het han: tu choi co hen noi lai | `license_invalid` + `retryAfterSec 3600` | "giay phep het han: tu choi voi license_invalid va hen noi lai sau" |
| Bi tu choi voi `retryAfterSec = 0` la DUNG HAN, ke ca sau han chao | `daDung = true` trong `dungHan` | "bi tu choi voi retryAfterSec = 0 thi KHONG noi lai, ke ca sau khi han chao troi qua" |
| Su kien phat trong giao dich chi len day SAU KHI CHOT, danh so, ack | `sauKhiChot` + `HopThuDi` | "duyet tien that -> su kien order.paid di qua day SAU KHI CHOT, duoc danh so va ack" |
| Dut day: su kien chua ack duoc gui lai, khong trung, khong mat | `welcome.lastEventSeq` + `guiTiepHopThu` | "dut day giua chung: su kien chua ack duoc GUI LAI sau khi noi lai" |
| Su kien trung chi ack lai, khong xu ly lan hai, khong dong day | `f.seq <= seqCuoi` -> ack | "su kien TRUNG (seq da nhan) chi duoc ack lai, khong xu ly lan hai, khong dong day" |
| Welcome bao DUNG so cuoi da nhan; ack don hop thu | `lastEventSeq: seqCuoi`, `hopThu.daAck` | "welcome bao DUNG so cuoi Xeon da nhan; OMI chi gui tiep phan sau do va don hop thu khi duoc ack" |
| Su kien nhay coc la dong day | `f.seq !== seqCuoi + 1` | "su kien NHAY COC (mat so o giua) lam Xeon dong day thay vi nhan tiep" |
| Khung vuot tran kich thuoc la dong day, khong phinh bo nho | `BoTachKhung` + `VuotTranKhung` | "khung vuot tran kich thuoc lam dong day, khong phinh bo nho" |
| Khung call/event truoc khi chao la dong day | `trangThai === "cho-hello"` | "khung call/event TRUOC khi chao la dong day" |
| Luot goi cua phien khac khong duoc phuc vu | `frame.sessionId !== cfg.sessionId` | "luot goi cua PHIEN KHAC khong duoc phuc vu" |
| Duyet tien luc dut day: tien chot, su kien nam trong kho, len Xeon khi noi lai | `hopThuDiTrongKho` | "duyet tien luc DUT DAY: tien van chot, su kien nam trong kho va len Xeon khi noi lai" |
| Ghi hop thu hong thi lan duyet KHONG chot | `phat(su)` trong giao dich, khong boc `sauKhiChot` | "ghi hop thu HONG thi lan duyet KHONG chot — tien khong doi, nhat ky khong ghi, khong co su kien mo coi" |
| Mat dien giua luc dut day: su kien chua ack con tren dia | bang `outbox` | "OMI MAT DIEN giua luc dut day: su kien chua ack van con tren dia, OMI moi khoi dong gui du" |
| Kho phuc hoi tu ban cu: su kien moi khong mang so cu | `nangSoCuoi` khi `welcome.lastEventSeq > soCuoi` | "kho OMI phuc hoi tu BAN SAO LUU CU (Xeon da nhan xa hon): su kien moi khong mang so cu" |
| Phat tu giua giao dich: khong gui truoc khi chot, quay dau thi Xeon khong nhan gi | `sauKhiChot` trong `phatSuKien` | "phat su kien tu GIUA giao dich: khong gui truoc khi chot; giao dich quay dau thi Xeon khong nhan gi" |
| So hop thu: quay dau thi tra lai, nhieu luot khong trung, xoa dong da ack khong lui bo dem | `outbox_seq` + `UPDATE last_seq + 1` | "hop thu trong kho: giao dich quay dau thi so cung quay dau (khong nhay coc); nhieu luot cung luc khong trung so" |
| Hop thu ghi bang ket noi CUA GIAO DICH tren MySQL | `db.tx` + ALS | "MySQL: hop thu di ghi bang ket noi CUA GIAO DICH, khong phai ket noi tu ho" |
| Xeon giu khoa may theo `keyId`, CHI khoa cong khai, song qua khoi dong lai | `khoKhoaTrongTep` + `docDong` tu choi "PRIVATE KEY" | "kho khoa trong TEP: song qua khoi dong lai, CHI giu khoa cong khai, tep hong thi mo that bai" |
| Mot may mot khoa song: cap khoa moi la khoa cu chet | `cap` thu hoi khoa cu cung (tenant, machine) | "cap khoa MOI cho cung may thi khoa CU bi thu hoi" |
| Thu hoi khoa CAT NGAY phien dang song, OMI dung han | `khiThuHoi` -> `tuChoiPhien` (forbidden, retryAfterSec 0) | "THU HOI khoa dang dung: phien dang song bi cat NGAY voi forbidden, OMI dung han" |
| Shop kich hoat lai: ban OMI cu bi cat, ban moi vao | `cap` phat thu hoi -> may chu cat phien theo `PhienOmi.keyId` | "shop KICH HOAT LAI (cap khoa moi cung may): ban OMI cu dang noi bi cat, ban moi vao duoc" |
| Doi goi: Xeon phat `refresh(license)`, OMI chao lai NGAY de `welcome` mang cong cu moi | `mayChu.lamMoi` + `noiLaiNgay` (khong qua thang cho noi lai) | "Xeon phat refresh(license) sau khi DOI GOI: OMI noi lai NGAY, welcome mang cong cu MOI, phien cu chet" |
| Khung `refresh` phai co `what` la mang khong rong cac muc da biet | `parseLinkFrame` + `REFRESH_WHAT` | "parseLinkFrame: khung refresh phai co `what` la mang KHONG RONG cac muc da biet" |
| Noi lai sau refresh phai XOA `welcome` cu, khong thi dong ho han chao bi tat | `noiLaiNgay` dat `welcome = undefined` | "sau refresh(license), noi lai vao mot may chu CAM (nhan TCP, khong chao): het han chao va noi lai tiep, khong treo" (dot bien H4 chi bai nay bat) |
| Thu hoi den TRONG LUC bat tay (Xeon dang doi DB) van khong mo phien | `khoaDaThuHoi` (ghi dong bo trong nguoi nghe) soi lai sau await cuoi VA sau `phien.set` | "THU HOI khoa dung luc dang bat tay (Xeon con doi DB giay phep): phien KHONG duoc mo" |
| Han chao no giua `xuLyHello` khong hoi sinh phien ma | guard `trangThai !== "cho-hello"` sau moi await | "han chao no TRONG LUC Xeon dang doi DB: khong hoi sinh phien ma, khong onPhien" |
| Ghi tep kho khoa hong thi kho KHONG doi (tep truoc, bo nho sau) | copy-on-write: `dong = ban` chi sau `ghiXuong` | "ghi tep HONG thi kho KHONG doi: khoa cu van song, khoa moi khong ton tai" |
| Tep kho khoa sua tay pha luat (keyId trung, hai khoa cung song) thi mo that bai | `docDong` | "tep sua tay pha luat: keyId trung, hoac mot may HAI khoa cung song -> mo that bai" |
| Nguoi nghe thu hoi nem khong bien thu hoi thanh that bai | try/catch trong `baoThuHoi` | "nguoi nghe thu hoi NEM: viec thu hoi van thanh cong" |
| Ly do thu hoi cua nguoi quan tri khong ra khung reject | `tuChoiPhien` gui cau chung, `ghi` ly do | "ly do thu hoi cua nguoi quan tri KHONG di ra khung reject" |
| Khung `refresh` NGUOC (OMI -> Xeon) la dong day | `default` trong `xuLyKhung` cua may chu | "OMI (hay ke gia) gui khung refresh NGUOC len Xeon: dong day, khong chuyen cho ai" |
| `lamMoi` kiem khung truoc khi gui, sai thi nem o Xeon | `parseLinkFrame` trong `lamMoi` | "lamMoi voi `what` sai hinh dang: NEM o Xeon, khong gui khung hong lam OMI mat day" |
| Hai lan chao lai vi refresh cach nhau it nhat `KHOANG_CACH_LAM_MOI_MS` | `lanLamMoiLuc` trong `case "refresh"` | "refresh(license) don dap: lan chao lai thu hai cach lan dau it nhat KHOANG_CACH_LAM_MOI_MS" |
| `onRefresh` cua tang tren nem van chao lai | try/catch quanh `onRefresh` | "onRefresh cua tang tren NEM: OMI van chao lai" |
| Khung xep hang cua socket CU khong duoc xu ly sau khi doi socket | `socket === s` trong chuoi `hangDoi` | (loi vao hang doi: chua co bai xac dinh — dot bien P16 song sot, ghi no) |
| Ket qua luot goi cua PHIEN CU khong duoc ghi vao socket MOI | `socket !== s` sau `await xuLyGoi` va sau cac await cua `welcome` | "luot goi DAI dang chay thi mat day va noi lai: ket qua cua phien cu KHONG duoc ghi vao socket moi" |
| Ngat chu dong (refresh) dung `end()` de khung vua ghi di het, `destroy()` chi du phong | `noiLaiNgay` | (khong dung duoc bai tren loopback — sua theo lap luan phan bien vong 2) |
| Xeon tu sinh chung chi TLS tu ky Ed25519, khong can openssl; Node doc lai va tu xac minh duoc | `sinhChungChiTuKy` (DER viet tay, `contract/chung-chi.ts`) | "chung chi tu sinh: Node doc duoc, tu ky bang Ed25519, dung ten, han 10 nam, khong phai CA" |
| Ghim = SHA-256 cua KHOA (SPKI), khong phai cua chung chi: gia han cung khoa thi ghim khong doi | `ghimCuaChungChi` | "ghim = bam khoa cong khai: cung khoa -> cung ghim du chung chi khac" |
| OMI CHI noi voi Xeon co ghim trong danh sach, va KHONG GUI BYTE NAO truoc khi kiem ghim | `ketNoiTls` kiem o `secureConnect` roi moi tra socket | "ghim SAI: OMI khong noi, KHONG gui mot byte nao" + "ke dung giua mang chung chi rieng: ... doc duoc 0 byte ro" |
| Ke dung giua chi bi chan boi GHIM (bai doi chung: tin ghim cua ke do thi di qua) | `ketNoiTls` | "OMI tin ke do (ghim cua no) thi di qua — chung minh chi ghim chan" |
| Ghim sai la THU LAI theo thang cho (co the la mang tam), ly do mang ghim NHIN THAY | `GhimKhongKhop` -> `matDay` | "ghim SAI ... va van thu lai" |
| Xoay khoa Xeon: OMI mang hai ghim (cu + moi) | `ketNoiTls({ ghim: [...] })` | "xoay khoa Xeon: OMI mang HAI ghim (cu + moi) noi duoc; OMI chi co ghim cu thi khong" |
| Cau hinh noi TLS sai (ghim rong/sai dang, port sai) nem NGAY luc tao | `ketNoiTls` | "ketNoiTls tu choi cau hinh sai NGAY LUC TAO, khong doi den luc noi" |
| Noi TLS co han: cong dong thi nem, may chu im lang thi het han, khong treo | `hanNoiMs` trong `ketNoiTls` | "ketNoiTls: khong ai nghe thi nem (khong treo); Xeon nhan TCP nhung im lang thi het han noi" |
| Xeon chi TLS 1.3; khach im lang / gui rac / TLS cu bi cat trong han, co nhat ky, khong toi `ganSocket` | `tuyChonTlsXeon` (`minVersion`, `handshakeTimeout`) + `tlsClientError` trong `mayChuTls` | "Xeon TLS: khach TCP thuan im lang hay gui rac, va khach TLS 1.2 — deu bi cat trong han" |
| Chung chi Xeon nam trong HAI tep (khoa rieng 0600 / chung chi), ghi nguyen tu, khong de tep tam | `chungChiTrongTep` | "chung chi trong tep: lan dau sinh hai tep ... Khong duoc de lai tep tam" |
| Mat chung chi con khoa -> sinh lai CUNG KHOA (ghim khong doi) | `chungChiTrongTep` nhanh `gia-han` | "mat chung chi (con khoa) -> sinh lai CUNG KHOA, ghim khong doi" |
| Ma kich hoat la giay phep KY SO: sua payload / ky bang khoa khac / doi mot ky tu la sai | `kiemChuKyGiayPhep`, `giaiMaMaKichHoat` | "ma kich hoat: ky -> ma hoa -> giai ma ra dung giay phep; ... sua payload la chu ky sai" |
| Ma kich hoat khong bao gio mang khoa rieng; khung `activate` mang "PRIVATE KEY" bi chan o bien | `giaiMaMaKichHoat`, `parseLinkFrame` | "giai ma ma kich hoat: tu choi ... ma mang KHOA RIENG" + "parseLinkFrame: activate/activated/pins" |
| Chuoi ky kich hoat KHAC chuoi ky hello (proof khong dung cheo duoc) | `chuoiDeKyKichHoat` co nhan `kich-hoat` | "chuoiDeKyKichHoat KHAC chuoiDeKy cua hello" |
| Pheu dang ky TAT DINH: cung cau tra loi -> cung bo manh, moi manh co vi sao; AI chi DE NGHI, khong tu vao bo manh | `pheuDangKy`, `gopDeNghi`, `chotManh` | "pheu: cung cau tra loi -> cung bo manh" + "pheu: de nghi cua AI KHONG vao bo manh" |
| Luat pheu khong doc van ban tu do: truong la bi tu choi | `kiemCauTraLoi` | "pheu: kiemCauTraLoi chi nhan dung hinh dang; truong la (van ban tu do) bi tu choi" |
| Ma kich hoat DUNG MOT LAN, gan may; ke ca cung may cung khong dung lai; ma het han (72 gio) / thu hoi la vo dung | `KhoKichHoat.kiemMa` / `dungMa` | "kho kich hoat bo nho: cap ma -> kiem ok; dung MOT lan..." + "ma HET HAN ... ma cap boi kho KHAC" |
| Giay phep dang dung = ma DUNG gan nhat; thu hoi thi KHONG lui ve giay phep cu | `dangDung` trong `kho-kich-hoat.ts` | "congCuCua(tenant): ... giay phep MOI de len cu" |
| Khoa ky nam rieng (0600), khong trong so ma; mat khoa ky con so ma -> mo that bai; thu muc trong can `khoiTao` | `khoKichHoatTrongTep` | "kho kich hoat trong TEP: ... mat khoa ky con so ma -> mo that bai" |
| Xeon chi NHAN khoa cong khai Ed25519; khoa rieng / RSA / rac bi tu choi, kho khong doi | `KhoKhoaMay.nhan` + `chotKhoaCong` | "khoa cong khai cua kho khoa: `nhan` ..." |
| KICH HOAT: OMI sinh khoa TREN MAY, chi khoa cong khai di len; Xeon kiem proof -> ma -> nhan khoa -> danh dau -> `activated` -> dong; OMI luu ho so roi chao lai | `xuLyKichHoat` (may-chu) + `activated` (khach) | "KICH HOAT TRON VEN: ..." |
| Proof sai / phat lai / ma da dung / ma gia / ban qua cu: ma KHONG bi tieu, kho khoa KHONG co khoa moi | thu tu kiem trong `xuLyKichHoat` | "proof sai ... ma KHONG bi tieu" + "ma DA DUNG (may khac) -> reject forbidden" + "ban OMI qua cu kich hoat: version_too_old, ma KHONG bi tieu" |
| `activate` chi duoc nhan o trang thai cho-hello; `pins`/`activated` di nguoc len Xeon la dong day | `xuLyKhung` (may-chu) | "activate den SAU khi da chao" + "khung `pins` di NGUOC" |
| OMI co ho so trong kho thi chao thang; khong ho so va khong ma thi DUNG HAN, khong mo day | `batDau` (khach) | "OMI co ho so trong kho: khoi dong lai chao THANG" + "OMI khong co ho so va cung khong co ma: dung han ngay" |
| Ho so OMI: mot kho mot shop; ghim hop le; `capNhatGhim` khong nhan rong; SQLite va MySQL cung ket qua | `kichHoatTrongKho` | "OMI kho ho so tren SQLite" + "QUYET DINH 2 cho ho so kich hoat (A5)" (test:mysql) |
| Kho OMI ban 4: kho ban 3 tu len doi (SQLite va MySQL) | `BUOC_NANG_CAP[4]` | "kho OMI ban 4" + "MySQL: kho ban 3 (chua co bang kich_hoat) len doi ban 4" |
| Khoi tao Xeon sinh CA khoa du phong; thu muc A3 mo lai thi sinh du phong ma ghim chinh KHONG doi; du phong hong -> mo that bai | `khoaDuPhong` | "khoi tao Xeon sinh CA khoa du phong" |
| Xoay khoa: chinh moi = du phong cu (ghim OMI DA co); xoay bi ngat giua chung thi lan mo sau hoan tat | `xoayKhoaXeon`, nhanh "KHONG KHOP" cua `chungChiTrongTep` | "xoay khoa: chinh moi = du phong cu ... mo lai tu hoan tat" |
| Xoay khoa tren may chu DANG CHAY: ket noi moi thay ghim moi | `capNhatChungChiTls` | "xoay khoa tren may chu TLS DANG CHAY" |
| `activated` mang CA HAI ghim cua Xeon; OMI luu vao kho, lan sau noi bang ghim trong kho | `cacGhim` (may-chu) + `hoSo.luu` | "activated qua TLS mang CA HAI ghim cua Xeon" |
| Xeon day ghim: danh sach phai chua ghim DANG DUNG cua Xeon (nem neu khong); OMI TU CHOI danh sach khong chua ghim cua ket noi dang dung | `dayGhim` + `ghimCuaSocket` + `pins` (khach) | "Xeon dayGhim([A,B,C]) ... day [B,C] ... OMI TU CHOI" + "XOAY KHOA TRON VEN qua TLS" |
| Hai OMI cung ma cung luc: MOT vao, MOT khoa song, ma tieu mot lan (doan kich hoat la MOT hang doi) | `xepHangKichHoat` (may-chu) | "HAI OMI cung ma, cung luc" |
| Thu hoi MA = thu hoi KHOA da nhan bang ma; kich hoat bang ma moi = mot shop MOT khoa song (may bi mat ten khac cung chet) | `khiThuHoi` cua kho kich hoat + `thuHoiKhac` | "THU HOI MA la thu hoi KHOA ..." |
| Giay phep dang dung bi thu hoi thi KHONG lui ve giay phep cu | `dangDung` (kho-kich-hoat) | "congCuCua(tenant): ... giay phep MOI de len cu" |
| Ho so co san + khoa bi tu choi + ma MOI: bo ho so, kich hoat lai (mot lan); ma cu (da dung) thi dung han | `reject` (khach) + `daThuMaMoi` | "HO SO CO SAN + khoa bi thu hoi + khach dan MA MOI" |
| `pins` phai KY bang khoa ky giay phep cua Xeon (khong phai khoa TLS) va mang SO THU TU BEN lon hon so da luu (khong dung dong ho); cung danh sach cung so thi bo qua; Xeon day ghim hien tai ngay SAU welcome | `kyGhim` (bo dem `ghimBen` trong so ma), `khoaCongKy`/`ghimSeq` trong `activated`, `chuoiDeKyGhim`; `pins` sau welcome (may-chu) | "DAY GHIM KHI OMI OFFLINE" + "Xeon dayGhim([A,B,C]) ... khung KHONG ky / ky sai / PHAT LAI" + "LECH DONG HO" |
| `activated.ghim` cung qua luat 7: OMI THEM ghim dang noi neu thieu; Xeon TLS co kho kich hoat ma khong `cacGhim` thi `mayChuTls` NEM (OMI se khong co ghim du phong) | `activated` (khach), `thieuCacGhim` (may-chu) | "Xeon TLS ma QUEN cacGhim: mayChuTls NEM" + "activated mang danh sach KHONG chua ghim dang noi" |
| Thu tu kich hoat: danh dau ma -> nhan khoa (KHONG thu hoi khoa cu) -> ghi keyId -> thu hoi khoa khac cua shop -> soi day dong -> `activated`; bo do o dau cung tra lai ma + thu hoi khoa moi, khoa cu cua may KHONG bi giet oan | `xuLyKichHoat`, `nhan({ giuKhoaCu })`, `dungMa({ ghiDe })`, `traLaiMa` | "day dong SAU khi da thu hoi khoa cu" + "kiemMa cham hon han chao" + "dungMa tra FALSE" |
| Ma moi de kich hoat lai phai la cua CHINH shop trong ho so; `activated` mang shop khac ma dang kich hoat thi khong luu | `reject`/`activated` (khach) | "MA MOI cua SHOP KHAC ... Xeon gia gui activated cho shop khac" |
| GIA HAN = ma moi: het han (`license_invalid`) + ma moi -> OMI kich hoat lai ngay, khong doi mot gio | `reject` (khach) | "GIA HAN: giay phep HET HAN + ma MOI" |
| Kich hoat lai KHONG xoa ho so (giu ghim da nhan sau xoay khoa); ho so ghi de khi `activated` moi den | `reject` (khach) | "KICH HOAT LAI SAU KHI XEON DA XOAY, bo cai chi co ghim CU" |
| Mot shop MOT khoa song: ke ca khoa cap TAY cua shop cung bi thu hoi khi shop kich hoat bang ma; thu hoi MA CU (da bi thay) khong dung ma moi | `thuHoiKhac` | "khoa cap TAY cua shop (may-2) cung bi thu hoi" + "thu hoi MA CU" |
| OMI giao keo < 0.3.0 khong nhan `pins`; `mayChu.dong()` roi khong nhan ket noi moi; `catMoiPhien` cho buoc 3 xoay khoa | `CONTRACT_CO_PINS`, `daDong`, `catMoiPhien` | "HAI SHOP kich hoat cung luc ... OMI giao keo 0.2.0" + "mayChu.dong() roi socket moi vao" |
| So ma la MA CHUA DUNG (token 72 gio): tep 0600; so ma lech khoa ky thi canh bao khi mo | `khoKichHoatTrongTep` | "so ma phuc hoi LECH khoa ky" |
| Ho so kho ghi CHAM hon thang cho noi lai: van mot ma, mot khoa (khoa dat truoc khi cho kho) | `activated` (khach) | "hoSo.luu CHAM hon thang cho noi lai" |
| Day dong sau khi danh dau ma (han chao no): ma duoc TRA LAI, khoa vua nhan bi thu hoi | `traLaiMa` + nhanh "bo do" (may-chu) | "HAN CHAO NO trong luc Xeon dang danh dau ma" |
| Ma cua shop khac cau hinh: OMI tu choi TRUOC khi gui (ma khong tieu); ho so kho thuoc shop khac: khong chao | `challenge` (khach), `batDau` | "cfg.tenant KHAC shop trong ma" |
| Du phong VUA SINH (tep mat / sao luu thieu) phai LO: dau tren dia, `xoayKhoaXeon` tu choi toi khi `epXoay` | `TEP_DAU_DU_PHONG_MOI` | "khoi tao Xeon sinh CA khoa du phong ... thu muc A3" |
| Khoa rieng cua may KHONG lo ra nhat ky / khung / tep Xeon / trang thai; ca chuoi tep that (kho ma, kho khoa, TLS, SQLite) chay tron | bai quet "PRIVATE KEY" | "CHUOI THAT: kho kich hoat TEP + kho khoa TEP + TLS ..." |
| Mat KHOA RIENG con chung chi -> MO THAT BAI, khong lang le sinh khoa moi (moi OMI se bi khoa ngoai) | `chungChiTrongTep` | "mat KHOA RIENG (con chung chi) -> MO THAT BAI, khong lang le sinh khoa moi" |
| Tep chung chi hong / mang khoa rieng / khong khop khoa / khoa khong phai Ed25519 -> mo that bai | `chungChiTrongTep` | "tep hong, khoa khong phai Ed25519, chung chi khong khop khoa, tep chung chi mang khoa rieng — deu mo that bai" |
| Sap het han (duoi 30 ngay) hay da het -> tu gia han cung khoa luc mo; OMI khong kiem han | `GIA_HAN_TRUOC_NGAY` | "sap het han (duoi 30 ngay) hay da het han -> gia han cung khoa; con lau thi giu" |
| Da co chung chi thi giu TEN trong chung chi, khong lay ten moi | `tenTrong(x) \|\| opts.ten` | "ten khac voi chung chi dang co thi giu ten cu" |
| Xeon nghe tren card mang that, OMI noi qua IP LAN (khong loopback) bang TLS | bai kiem tra | "mang that: Xeon nghe tren MOI card mang, OMI noi qua IP LAN" |
| Qua NAT co do tre va goi bi chia nho van bat tay, goi cong cu, ack su kien | `BoTachKhung` + TLS | "qua hop NAT co DO TRE 150ms moi chieu ... va goi bi CHIA NHO 7 byte" |
| NAT cat IM LANG (khong FIN/RST): nhip tim phat hien, noi lai bang anh xa moi, su kien phat luc "chet" van toi du | nhip tim hai dau + hop thu | "NAT cat IM LANG luc nhan roi: ... su kien phat luc 'chet' van toi Xeon dung thu tu" |
| Nhip tim ngan hon han nhan roi cua NAT thi anh xa duoc giu song | `heartbeatSec` (mac dinh 20s) | "NAT nhan roi 1.5s nhung nhip tim 1s: ... van la MOT phien" |
| Han bat tay co HAI tang (TLS, roi challenge->hello), moi tang can >= 1 RTT | `handshakeTimeout` + `hanBatTayMs` | "RTT lon hon han bat tay: hai tang, moi tang can >= 1 RTT" |
| Loi la duoc ghi nhat ky may shop TRUOC khi che | `ghiLoi` | "loi la duoc GHI vao nhat ky may shop truoc khi che" |
| Tu dem cua ho so khong duoc trung ten mon cua shop | `kiemTuDemVoiMucLuc` (chay luc nap muc luc) | "tu dem cua ho so khong duoc nuot ten mon cua shop" |
| Tu choi mot con so moi thi phai GO gia tri ghim cua truc do | `delete slots[axis.id]` o ca hai cong | "o size da ghim: hoi size khac bang cach thuong ngay -> KHONG tra loi bang size cu" |
| Ten mon dung ngay truoc con so la tu bao hieu bien the | `cueThem` | "ten mon dung ngay truoc con so la tu bao hieu bien the" |
| Truc KHONG bat buoc loc ra rong thi bo bo loc, khong bao het hang | vong loc trong `stock.lookup` | "truc KHONG bat buoc loc ra rong thi bo bo loc — KHONG duoc bao het hang" |
| Mau cua ho so va cong so tran doc CUNG mot chuoi | `extractAxis(axis, normText)` | "so hop le tinh tren CUNG chuoi voi mau cua ho so — bang alias khong doi phan quyet" |
| Tu bao hieu YEU (dong am) chi tinh khi so dung cuoi/ truoc tu hoi | `CUE_YEU` + `SAU_LA_HOI` | "tu bao hieu YEU (co/con/la) dong am voi tu thuong thi khong duoc lot" |
| Doi mon phai khop it nhat mot TU CHU cua mon moi | `khopChu` | "so nam trong dai cua mot truc (size 41) KHONG bi coi la ten mon (Pegasus 41)" |
| Bai kiem tra khong duoc de hon OMI that: bo tim kiem gia tra theo thu tu kho | `fakePorts({ giuThuTuKho })` | "bo tim kiem tra theo THU TU KHO: 'Con O' dung dau bang khong lam mat tam diem" |
| Dong tu DAT HANG (lay/mua/can/cho/xin) khong phai tu bao hieu bien the | `DONG_TU_DAT_HANG` | "cau CHOT DON ('minh lay 2 nhe') khong duoc tra loi bang ton cua lo 2ml" |
| Con so la mot phan TEN MON khach vua go khong phai so tran | `soTenMon` | (bai S3 "khach tra loi dung cau bot vua hoi thi phai duoc phuc vu") |
| Hai cho go ghim co CUNG tuoi tho | `DispatchOut.slotsGo` | "hai cho go ghim co CUNG tuoi tho: luot thu ba khong duoc thay gia tri cu quay lai" |
| Mot so tran khop HAI nhan, co o da ghim -> hoi lai | `slotsGo` khi khong doan duoc | "U1: mot so tran khop HAI nhan, co o da ghim -> hoi lai, khong tra loi bang o cu" |
| Bai ve tri nho hoi thoai phai dai BA luot | (nguyen tac viet bai) | "cueThem: 'boston 43' duoc LUU (luot thu ba van la 43, khong hoi lai)" |
| Ten mon va so dau tin cung phai qua chot cau hoi, khong phai bao hieu MANH | `cueThem` + `laHoi`; `dauTin` + `SAU_LA_HOI_TON` | "chot don voi so dung SAU TEN MON hoac MO DAU TIN khong duoc doc thanh bien the" |
| Bot vua hoi truc do thi so dau tin la cau tra loi | `dangTraLoi` | "bot vua hoi truc do thi con so mo dau tin la cau tra loi, tieu tu gi cung duoc" |
| Veto dat hang chi trong cua so 3 token | `CUA_SO_DAT_HANG` | "'cho em hoi' / 'xin hoi' o dau cau KHONG vo hieu hoa cau hoi bien the" |
| Tieu tu khang dinh khong phai tu hoi | `SAU_LA_HOI` khong co nhe/nha/thoi/luon/a/di | (cung bai tren) |
| Tu chung nhieu chu duoc TACH token khi loc | `specificTokens` | "tu chung 'cai nay', 'san pham nay', 'chai nay' khong lam mat tam diem" |
| ~~**CON NO:** `kiemTuDemVoiMucLuc` chua co noi goi~~ DA TRA (A4): goi trong `mucLucTrongBoNho.nap` — noi DUY NHAT muc luc di vao Bo nao | `mucLucTrongBoNho` | "muc luc Xeon: `kiemTuDemVoiMucLuc` CO NOI GOI" |
| Xeon chi nhan muc luc qua `nap`: cong QD3 chay o dau NHAN, mon cua shop khac / hai mon cung ma -> tu choi CA DOT, ban cu giu nguyen | `mucLucTrongBoNho.nap` | "muc luc Xeon: nap qua cong QD3 o dau NHAN", "mon cua shop KHAC lan vao" |
| Tu dem pham loi la BAO (tra ve + nhat ky + `tuDemPham`), KHONG tu choi: loi o ho so nganh, shop khong sua duoc | `mucLucTrongBoNho.nap` | "tu dem nuot ten mon thi bao ve, ghi nhat ky, van nap" |
| Tim trong muc luc Xeon: do phu giam dan, bang nhau thi THU TU KHO, co tran, khong thay mon shop khac, tra BAN SAO | `mucLucTrongBoNho.search` | "tim theo do phu, bang nhau thi THU TU KHO" |
| Moi cau lenh MySQL (ke ca BEGIN/COMMIT/ROLLBACK) co HAN; het han = HUY ket noi + loi `db_timeout`, KHONG chay lai giao dich | `coHan` | "cau lenh le KHONG hoi am qua han thi HUY ket noi", "COMMIT khong hoi am qua han", "BEGIN khong hoi am" |
| Mot ket noi chet im -> huy HET ket noi nhan roi trong ho, khong dung vao ket noi dang ban | `huyNhanRoi` | "mot ket noi chet im -> huy het ket noi NHAN ROI", "router khoi dong lai" (MySQL that) |
| Cau lenh le tu lay ket noi tu ho va tra ve trong MOI truong hop (de het han huy dung ket noi do) | `chay` | "cau lenh le nem thi ket noi van duoc tra ve ho" |
| Moi ket noi moi dat `wait_timeout` PHIEN (mac dinh 300s); ho thu ket noi nhan roi SOM HON (`maxIdle` < `connectionLimit`, `idleTimeout` = min(60s, N/2)); SET hong thi ghi nhat ky | `pool.on("connection")` | "moi ket noi moi duoc dat wait_timeout PHIEN", "wait_timeout PHIEN cua OMI (4s)" (MySQL that) |
| May chu cat ket noi nhan roi bang FIN (KILL / wait_timeout): cau lenh sau chay tren ket noi moi, khong loi | mysql2 `PoolConnection` + bai MySQL that | "may chu KILL ket noi nhan roi trong ho" |
| May khach chet GIUA giao dich dang khoa hang: may chu nha khoa sau `wait_timeout` phien, giao dich sau ghi duoc, ghi cua giao dich chet khong con lai | `wait_timeout` phien | "NAT cat GIUA giao dich dang khoa hang" (MySQL that) |
| **CON NO:** ten mon NGAN toan tu thuong ("Air Force", ma `AIR`) doi mon chi bang mot chu ("ship air toi ha noi") — khong sai so nhung nhay tam diem | `ITEM_MATCH_THRESHOLD` chia cho so token ten mon | — |
| Khoa rieng cua may nam tren dia da NIEM bang ket gan may; ban niem khong con chu nao cua ban ro | `niemKhoa` + `soiBanNiem` | "kho ho so co ket: cot tren dia la ban NIEM, doc() van ra dung khoa rieng" |
| Ban niem cua KET KHAC (may khac, tai khoan khac) mo THAT BAI voi ly do ro, khong doan bua la ban tho | `tachThan` + `moKhoa` | "ket: ban niem cua ket KHAC bi tu choi voi cau noi ro ten ket" + "kho ho so: ban da NIEM ma mo kho KHONG co ket" |
| Cho ma hoa cua may khong ma hoa that (Linux `basic_text`, hay tra ve ban ro) thi TU CHOI luu | `ketTuSafeStorage` + `soiBanNiem` | "ket safeStorage: neu cho ma hoa tra ve ban RO thi `niem` NEM" |
| Kho cu (khoa TRO) duoc nang len ket dung MOT lan, trong mot giao dich, va chi khi khoa doc duoc | `niemLaiKhoa` | "niemLaiKhoa: kho cu (khoa THO) mo bang ket thi khoa duoc niem" + bai MySQL "QUYET DINH 2 cho KET (B7)" |
| Man hinh KHONG BAO GIO nhan khoa rieng: tang vo chi co `docCong` | `HoSoCong` + quet ma nguon | "docCong: KHONG BAO GIO mang khoa rieng" + "tang vo (packages/omi/src/vo) khong bao gio doc khoa rieng" |
| Khoa rieng / ma kich hoat / ban niem khong bao gio ra khoi tien trinh chinh | `chotRaNgoai` (cong IPC) | "cong vo: moi tra loi di qua CHOT — thu quy khong ra duoc renderer" |
| Nhat ky cua vo duoc cat sach TRUOC khi luu (khoa rieng, ma, ban niem, so dien thoai) | `sachDong` | "nhat ky cua vo KHONG BAO GIO chua khoa rieng, ma kich hoat, hay ban niem" |
| Renderer goi TEN KENH trong danh sach trang, tham so co tran do dai | `KENH_VO` + `taoCongVo` | "cong vo: kenh la bi tu choi" + "tham so sai hinh dang bi tu choi ngay o cong" |
| Ma dan vao duoc SOI TAI CHO truoc khi gui: shop khac, may khac, ban OMI cu, chu ky khong phai cua Xeon da kich hoat may nay | `xemMa` | "vo: ma cua SHOP KHAC bi chan tai cho" + "ma KHONG do Xeon da kich hoat may nay cap" + "ban OMI cu hon `minContract`" |
| Bi tu choi dut khoat (`license_invalid`/`forbidden`) khi DA co ho so = man GIA HAN, khong tu xoay xo | `tuChoiThanhMan` | "GIA HAN: Xeon thu hoi -> vo sang man GIA HAN; dan ma MOI -> ket noi lai" |
| Mot vo = MOT khach day: mo lai / kich hoat lai deu dung khach cu truoc | `dungKhach` trong `mo`/`kichHoat` | "vo: mo() lan hai DUNG khach day cu truoc" |
| Cua so Electron kin: contextIsolation + sandbox, khong Node trong trang, CSP 'self', chan dieu huong va cua so bat ra, kiem nguoi gui IPC | quet ma nguon `packages/vo-omi` | "vo Electron: cua so mo voi contextIsolation + sandbox..." (bon bai quet) |

### Gioi han da biet cua cac cong nay

- `assertModuleGraph` doc BANG KHAI BAO `dependsOn`, khong doc `import` that trong ma.
  Da tra mot NUA mon no: bai "ba khoi phu thuoc dung mot chieu" doc `import` that va chan
  duoc viec Bo nao goi thang sang OMI hay nguoc lai. **Con no phan manh le**: manh hien la
  khai niem trong `modules.ts` chu chua phai thu muc rieng, nen chua the doi chieu `import`
  o muc manh. Khi tach manh thanh thu muc thi phai mo rong bai kiem tra do.
- Luat "co cong chinh thuc thi dung cong chinh thuc" chua co cho kiem — se lam o buoc 3
  khi co so dang ky ket noi.
- Luat "moi luot goi Brain phai gan voi mot hoi thoai that" moi co CHO trong khung
  (`CallFrame.conversationId`), chua co cho CUONG CHE — se lam khi noi hai khoi o buoc 4.
- ~~`CallFrame.conversationId` con la truong TUY CHON~~ — DA TRA: `parseLinkFrame` tu
  choi khung `call` cua bot khong co `conversationId`. Nguoi that thi khong bat buoc.
- ~~`WelcomeFrame.maxInflight` phai duoi 60~~ — DA TRA: hang so `MAX_INFLIGHT = 40`
  trong ban giao keo, va dau OMI tu choi bang `rate_limited` khi vuot tran.
- **`sauKhiChot()` chua co noi goi nao trong ma san xuat** — giong het `loadActor` o dot
  truoc: mot cai cong xay xong chua lap vao tuong. Phai la thu NOI DAU TIEN cua buoc 4,
  khong phai thu noi cuoi.
- ~~Nguoi goi phai doc `LoiSauKhiChot.daChot` va `.ketQua`~~ — DA TRA: `taoBoPhucVu`
  tra `ok: true` kem `canhBao` khi giao dich da chot ma viec sau khi chot hong.
- **Su kien phat ra tu trong giao dich: GHI hop thu trong giao dich, GUI sau khi chot.**
  `taoKhachDay().phatSuKien` lam ca hai — ghi bang ket noi cua giao dich (qua
  `AsyncLocalStorage`), roi `sauKhiChot()` moi gui. Cong cu goi `phat(su)` THANG, khong
  boc `sauKhiChot` — boc la dong hop thu roi ra ngoai giao dich, mat dien giua COMMIT va
  dong ghi la Xeon khong bao gio biet khach da tra tien. Ghi hop thu hong thi giao dich
  quay dau: tien chua doi thi khong co gi de bao.
- ~~`ToolPort` cua Bo nao la RPC tran~~ — DA TRA: `ToolPort.call` nhan `CallCtx`
  (`conversationId`, `idempotencyKey`), va `goiCongCu` trong `turn.ts` la cho DUY NHAT
  goi cong cu nen khong ai quen duoc. Khoa chong trung gom ca ten cong cu.
- **Duong day THAT da co (10/09/2026, buoc 6):** `brain/link/may-chu.ts` (dau Xeon) va
  `omi/link/khach.ts` (dau OMI) noi qua bat ky `Duplex` nao — bai kiem tra `test/day-that.test.js`
  chay TCP that tren may; may that boc TLS (`mayChuTls`, `tls.connect`). Bat tay
  `challenge` -> `hello` (ky Ed25519 bang khoa may, `contract/khoa-may.ts`) -> `welcome`/`reject`;
  khung JSON tung dong co TRAN kich thuoc (`contract/khung-dong.ts`); su kien danh so, ack,
  gui lai tu so Xeon bao trong `welcome`; nhay coc la dong day; mat nhip tim la noi lai; bi
  tu choi voi `retryAfterSec = 0` la DUNG HAN (viec cua nguoi). `sauKhiChot()` DA co noi goi:
  `order.approve` phat `order.paid` sau khi chot; phat hong thi lan duyet van la thanh cong.
- **Hop thu di nam trong KHO (ban kho 3, 10/09/2026):** `omi/link/hop-thu.ts` —
  `hopThuDiTrongKho(db, tenant)`, hai bang `outbox` + `outbox_seq`; `taoKhachDay` BAT BUOC
  nhan `hopThu` (khong co mac dinh trong bo nho — mac dinh do la cai bay qua het bo kiem tra
  roi mat su kien tren may khach). Cap so la `UPDATE last_seq + 1` nguyen tu, nam trong
  giao dich cua nguoi goi nen quay dau la so cung tra lai (Xeon chi nhan `cuoi + 1`, mot so
  bo trong la dong day mai). Bo dem tach bang rieng vi `MAX(seq)` lui ve 0 khi dong da ack
  bi xoa. Xeon `welcome` bao da nhan XA HON so cuoi cua OMI (kho phuc hoi tu ban sao luu cu)
  thi OMI nang bo dem — khong thi su kien moi mang so cu, Xeon coi la trung va bo qua.
- **Kho khoa may o dau Xeon (A2, 10/09/2026):** `brain/link/kho-khoa.ts` — `KhoKhoaMay`
  (`cap`/`tra`/`thuHoi`/`lietKe`/`khiThuHoi`), ban bo nho cho bai thu va ban TEP JSON cho may
  that (ghi tep tam roi doi ten; tep hong hay mang "PRIVATE KEY" la MO THAT BAI, khong lang le
  rong). Xeon chi giu khoa CONG KHAI; khoa rieng sinh o `cap` va tra ve dung mot lan. Mot may
  mot khoa song: cap lai la khoa cu bi thu hoi. Thu hoi la SU KIEN: `taoMayChuDay({ khoKhoa })`
  nghe no de cat NGAY phien dang dung khoa do (reject `forbidden`, `retryAfterSec 0`) — khong
  cat thi ban OMI bi lay trom con noi den luc dut day. `traKhoaMay` van nhan duoc cho bai thu,
  nhung khong co thu hoi. `RefreshFrame` DA co nguoi phat: `mayChu.lamMoi(tenant, what, reason)`
  sau khi doi goi; OMI nhan `license` thi bo day va chao lai NGAY (khong qua thang cho noi
  lai) vi danh sach cong cu chi nam trong `welcome`; `pack`/`recipes` chi bao len `onRefresh`.
- **TLS + ghim + mang that (A3, 11/09/2026):** `contract/chung-chi.ts` sinh chung chi X.509 v3
  TU KY bang Ed25519 voi DER viet tay (khong can openssl — thu khong chac co tren may chu va
  chac chan khong co tren may khach); Node doc lai, tu xac minh chu ky, va bat tay TLS 1.3 that.
  Ghim theo RFC 7469: `sha256/<base64 cua SHA-256(SPKI)>` — bam KHOA chu khong bam chung chi,
  nen gia han cung khoa la ghim khong doi. `brain/link/chung-chi-xeon.ts` giu chung chi trong
  HAI tep (`xeon.key.pem` 0600, `xeon.cert.pem`), ghi nguyen tu; mat chung chi con khoa thi sinh
  lai cung khoa; mat KHOA con chung chi thi MO THAT BAI (lang le sinh khoa moi la doi ghim, moi
  OMI ngoai kia bi khoa ngoai cung luc ma khong ai biet vi sao); sap het han thi tu gia han luc
  mo. `omi/link/noi-tls.ts` — `ketNoiTls({ host, port, ghim: [...] })` tra ve ham `ketNoi` cho
  `taoKhachDay`: `rejectUnauthorized: false` LA CO Y (tu ky, khong CA), thu xac nhan la ghim,
  kiem o `secureConnect` roi MOI tra socket — OMI khong gui byte nao truoc do, ke dung giua doc
  duoc 0 byte ro (bai kiem tra co doi chung: tin ghim cua ke do thi di qua, tuc chi ghim chan).
  OMI KHONG kiem han chung chi: Xeon quen gia han thi moi OMI bi khoa ngoai cung luc va khong co
  duong nao day chung chi moi xuong; han chi la ve sinh, thu giu an toan la ghim + khoa rieng nam
  yen tren Xeon. Ghim sai la thu lai theo thang cho (co the la mang tam / captive portal), ly do
  mang ghim nhin thay. Xeon chi nhan TLS 1.3, `handshakeTimeout` = han bat tay, ket noi hong
  truoc khi bat tay xong ghi nhat ky `[tls]` va bi cat, khong bao gio toi `ganSocket`. Mang
  that: bai `test/tls-va-mang-that.test.js` nghe tren `0.0.0.0` va noi qua IP LAN that; hop NAT
  gia (`test/hop-nat-gia.js`) lam do tre moi chieu, chia nho goi, va CAT IM LANG luc nhan roi
  (khong FIN, khong RST — kieu dut day chi nhip tim moi thay): OMI mat nhip tim sau 3 nhip, Xeon
  sau 2 nhip, noi lai bang anh xa moi, su kien phat trong luc "chet" van toi du va dung thu tu;
  nhip tim ngan hon han nhan roi cua NAT thi anh xa song mai. Han bat tay co HAI tang (TLS 1
  RTT, roi challenge->hello 1 RTT), mac dinh 10s moi tang. Xeon THAT ngoai Internet thi chua
  co — do la viec trien khai (anh lam), khong phai viec cua ma. Hai vong phan bien doi khang (an
  ninh giao thuc; van hanh + do manh test) ra 2 chan duong, da va: (1) `dong()` cua may chu chi
  `end()` khong co `destroy()` du phong — socket TLS nam lai vo han khi NAT nuot FIN hay khach co y
  giu (co tu buoc 6; hop NAT gia cu tu tra FIN nen bai thu khong thay — nay `allowHalfOpen` hai
  phia, va `socketDangMo` giu socket toi luc dong that); (2) thu muc trong thi lang le sinh khoa
  moi = doi ghim cua moi OMI — nay bat buoc `khoiTao: true`. Dot bien 43 con (33 + 10 vao phan
  va): 40 bi bat; 3 song sot deu tuong duong (OMI cho TLS 1.2 nhung Xeon van ep 1.3; GeneralizedTime
  thay UTCTime, Node doc nhu nhau; xoa khoi `socketDangMo` som chi lam `dong()` cham). `npm test`
  nay chay voi `--test-timeout=60000 --test-force-exit`: bai do phai DO, khong duoc treo.
- **CON NO cua duong day:** ~~chung chi TLS cua Xeon va cach OMI ghim chung chi (A3)~~ DA TRA;
  ~~chua thu qua mang that (NAT, do tre, cat ket noi luc nhan roi)~~ DA TRA tren may nay bang hop
  NAT gia + IP LAN, chua thu Xeon that ngoai Internet; ~~khoa TLS rieng cua Xeon bi LO thi khong co
  duong thu hoi (OMI chi biet ghim; muon doi la doi ghim o tung OMI — A5 phai co cho luu nhieu ghim
  va duong day ghim moi xuong TRUOC khi bo ghim cu; RFC 7469 doi co GHIM DU PHONG: A5 nen sinh khoa
  du phong luc khoi tao va in ca hai ghim)~~ DA TRA (A5: khoa du phong, `xoayKhoaXeon`, khung `pins`); may chu TLS chua co tran so ket noi dang bat tay (mo
  nhieu TCP roi im la giu socket toi `handshakeTimeout`) va `[tls]` ghi mot dong moi ket noi rac
  (lut nhat ky); khung `hello` chua BUOC vao kenh TLS (`exportKeyingMaterial` vao chuoi ky) — voi
  ghim dung thi ke dung giua khong vao duoc, nhung mot OMI cau hinh sai ghim thi hello co the bi
  chuyen tiep (phong thu chieu sau, lam khi doi `chuoiDeKy`); `chungChiTrongTep` chi hieu chung chi
  do chinh no sinh (CN la hostname/IPv4) — chung chi quan tri cap bang openssl voi CN la se nem
  "Ten may chu..." dung luc gia han; khong fsync thu muc sau `rename` (nhu kho khoa); quyen 0600
  chi ap luc TAO tep khoa (khoi phuc tu sao luu 0644 thi giu 0644); hai tien trinh Xeon cung thu
  muc chung chi trong se ghi cheo (khoa A / chung chi B -> lan sau "KHONG KHOP"); `dungHan` cua
  OMI khong xoa `welcome`/`phucVu` nen `batDau()` lai sau reject dut khoat co the gui `event` truoc
  `hello` (tu lanh sau mot lan Xeon dong); `noiLaiNgay` hen destroy tu luc `end()` chu khong tu
  `finish` (ket qua to tren duong cham > 2s bi cat); khong ben nao `setNoDelay` (Nagle co the tre
  chuoi khung nho); bai kiem tra chua co "chung chi Xeon that nhung khong co khoa rieng" (an toan
  dua vao OpenSSL kiem CertificateVerify — dung theo ma nguon, chua chay thuc nghiem vi Node khong
  cho nap cert/khoa lech); bai "chia nho 7 byte" qua TLS chi chung minh OpenSSL ghep ban ghi, khong
  cham `BoTachKhung` (day-that da bat rieng); bai "mang that" noi toi IP cua chinh may (van qua
  loopback trong nhan) — Xeon that ngoai Internet la viec trien khai; ~~OMI chua co cho LUU
  keyId + khoa rieng + ghim (A5 kich hoat)~~ DA TRA (A5: bang `kich_hoat`, `kichHoatTrongKho`); kho khoa tep thuoc MOT tien trinh Xeon (cap/thu hoi phai
  qua tien trinh dang giu tep) — chua co khoa chong hai tien trinh cung mo. Phan bien A2 con
  ghi no: (13) `ToolPort` cu cua Bo nao khong biet phien da bi thay, luot dang cho doi du
  `timeoutMs` (15s mac dinh) — sau doi goi bot co the dung 15s; (14) `lamMoi` tra `true` = da
  ghi vao socket, `pack`/`recipes` gui dung luc dut day thi mat (license tu lanh vi hello lay
  lai); (21) dau OMI xu ly khung TUAN TU nen `MAX_INFLIGHT` chua co nghia thuc, va `refresh`
  dung sau mot luot goi dai. Vong 2 ghi them: shop het han (`license_invalid`, hen 3600s) roi
  gia han lai thi khong co duong "kich OMI day som" — no nam ngoai toi 1 gio; `khoaDaThuHoi`
  cua may chu chi tang khong xoa (moi lan thu hoi mot dong, suot doi tien trinh); `dung()` goi
  trong luc `await ketNoi()` thi socket tra ve khong ai destroy (co tu truoc A2); `ghiXuong`
  fsync tep tam nhung khong fsync thu muc sau `rename` (ext4 mat dien co the lui ve ban cu).
  Khi noi that qua `link.ts` o buoc 4 se phai doi hinh dang cua cua nay. Phia OMI da san
  sang: `OmiContext` co `conversationId` va `idempotencyKey`, va `loadActor()` la cho
  DUY NHAT duoc phep quyet dinh vai tro.
- **`redactPII` doi hoi DAU SO thue bao** sau so 0 (di dong tu 2018, di dong cu truoc
  2018, va so co dinh). Khong co rang buoc do thi no an ca so tai khoan ngan hang cua
  shop. Nhung mau chu KHONG the phan biet so tai khoan voi so khach khi shop dung MB
  Bank hay TPBank — hai thu giong het nhau — nen viec phan biet nam o CHO DAT CONG:
  `CONG_CU_CUA_SHOP` liet ke nhung cong cu tra ve chu shop tu viet ve chinh minh va
  khong di qua duong soi — va no chi co MOT ten (`policy.get`), vi ranh gioi that nam
  o muc COT chu khong o muc cong cu: `item.name`, `variant.label`, `purchase_eta.note`
  deu la o ma `assertCatalogClean` DANG chan o duong xuat muc luc, nen mien ca cong cu
  la mo lai dung cai lo do bang mot cua khac. Cong cu moi mac dinh BI SOI.
- **Quy tac cho moi co che moi cham vao giao dich: phai co MOT bai chay qua duong MySQL
  gia.** Bon vong lien tiep, nua duong MySQL cua co che vua them deu khong co bai — day
  la cho duy nhat lap lai nhieu vong. Quy tac nay KHONG con nam trong tai lieu: co hai
  bai quet ma nguon lam no gay.
- **Han cho lay ket noi MySQL phai tu lam.** `connectTimeout` cua `mysql2` la han bat
  tay TCP, khong phai han lay ket noi tu ho, va `mysql2` khong co `acquireTimeout`.
  `queueLimit` chi chan DO DAI hang cho; nguoi dang xep hang thi cho vo han.
- **Duong MySQL DA chay tren may chu that (10/09/2026):** `test/mysql-that.test.js` chay
  CUNG mot kich ban tren SQLite va tren MySQL 8.4.11 (container rieng, cong 3307, database
  `seller_platform_test`; bai tu choi moi database khong ket thuc bang `_test`), va hai ket
  qua GIONG HET sau khi bo moc gio; kem nang cap tu kho ban 1 va kho khong dong dau.
  Chay: `OMI_MYSQL_URL=mysql://...@127.0.0.1:3307/seller_platform_test npm run test:mysql`.
  Lan chay dau tim ra MOT khac biet that: `ON DUPLICATE KEY UPDATE` cua MySQL bat trung
  tren BAT KY chi muc duy nhat nao, nen mot don khac id ma trung khoa chong trung se GHI DE
  don nhap cu thay vi bao loi (SQLite thi nem). Vi vay `order.draft` di `insertOrder`
  (INSERT thuan) va `replaceOrder` TU CHOI `idemKey`. Dot bien "insertOrder ghi de" chi bai
  MySQL bat duoc — bai SQLite khong phan biet — nen bai nay phai chay truoc moi lan giao.
- **Duong MySQL qua MANG (A4, 11/09/2026):** `test/mysql-qua-mang.test.js` dat hop NAT gia
  (`test/hop-nat-gia.js`, tuy chon `nghe`) NGHE TREN IP LAN cua may, dung truoc MySQL 8.4 that;
  OMI noi toi IP LAN — goi tin qua card mang that — va hop lam do tre, cat IM LANG, mat anh xa.
  Chin bai, chay cung `npm run test:mysql` (`--test-concurrency=1` vi hai tep dung chung mot
  database `_test`). Ba thu loopback khong bao gio lo ra, gio nam trong `db/mysql.ts`:
  (1) ket noi nhan roi bi NAT cat im (khong FIN/RST) thi `mysql2` cho VO HAN (keepalive cua
  Windows la 2 gio) — nay moi cau lenh, ke ca BEGIN/COMMIT/ROLLBACK, co han `HAN_CAU_LENH_MS`
  (30s, env `OMI_DB_HAN_CAU_LENH_MS`); het han la `destroy()` ket noi (roi ho ngay) + loi
  `code: "db_timeout"`, KHONG chay lai giao dich (COMMIT co the da toi). `timeout` cua mysql2
  khong dung duoc: no chi nem loi ma van tra ket noi chet ve ho (ho bi dau doc). Vi phai huy
  duoc ket noi, cau lenh le cung tu lay ket noi tu ho (`chay`) thay vi `pool.execute`.
  (2) Router khoi dong lai la CA HO nhan roi chet im: mot ket noi het han thi huy het ket noi
  nhan roi khac (`huyNhanRoi`, theo doi qua su kien `connection`/`acquire`/`release` cua mysql2),
  khong thi moi xac trong ho la mot cau lenh nua cho du han roi moi hong (bai "router khoi dong
  lai": 4 xac, MOT loi, roi 4 cau lenh sau chay ngay). (3) May khach chet giua giao dich thi
  may chu giu khoa hang toi `wait_timeout` (mac dinh 8 GIO) — nay moi ket noi moi dat
  `SET SESSION wait_timeout = 300` (env `OMI_DB_NHAN_ROI_S`), va ho thu ket noi nhan roi som hon
  (`maxIdle: 5` — phai NHO HON `connectionLimit` thi bo thu cua mysql2 moi chay, chay moi 1s;
  `idleTimeout = min(60s, N/2)`) de ket noi lanh khong bi may chu cat truoc mat. May chu cat
  bang FIN (KILL, wait_timeout) thi mysql2 tu loai ket noi khoi ho — bai chung minh cau lenh
  sau chay khong loi. Ho day: luot thu 11 cho `OMI_DB_HAN_CHO_MS` roi bao loi, tra ket noi la
  hoi phuc. Cung qua hop tre: hai nguoi cung bam duyet mot don — MOT thang, kho ghi dung so.
  CHUA thu: MySQL o MAY KHAC that (chi hop NAT tren cung may); do la viec trien khai.

- **NO cua A4 (duong MySQL qua mang + muc luc Xeon):** han cau lenh 30s cung cat cau CHO KHOA
  hop le (innodb_lock_wait_timeout 50s) va cau cham hop le (bao cao lon) — co y: nguoi ban khong
  nen cho hon 30s, nhung luc do ho nhan roi cung bi huy oan (chi phi noi lai, khong mat du lieu);
  `wait_timeout` 300s cat giao dich NHAN ROI giua hai cau lenh qua 300s (OMI khong co giao dich
  nao nhu vay, nhung mot `sauKhiChot` cham thi khong nam trong giao dich nen khong sao); loi
  `db_timeout` o COMMIT nghia la KHONG RO da chot hay chua — tang cong cu chua doc ma nay de noi
  voi nguoi ban "hay kiem tra lai" thay vi "that bai"; `dangBan` theo doi bang su kien cua
  mysql2, ket noi bi mysql2 tu loai khi dang ban thi con nam trong `dangBan` toi luc `release()`
  (khong ro ri vi `Set` chi giu toi da `connectionLimit` doi tuong song); MySQL o may khac that
  chua thu. Muc luc Xeon: chi trong BO NHO, chua co khung `catalog` tren duong day de OMI day
  muc luc len (test nap thang tu `exportCatalogIndex`), Xeon khoi dong lai la trong muc luc toi
  luc OMI day lai — B8; `handleTurn` van loc tu dem khoi cau khach du kho da biet tu dem pham
  (kho chi BAO — sua ho so la cach dung); `search` tinh `coverage` tren tung mon moi lan goi
  (O(n) — du cho vai nghin mon, muc luc chuc nghin mon thi can chi muc).
  Hai vong phan bien doi khang A4 (an ninh/du lieu; van hanh/do manh test) khong ra chan duong
  trong ma, ra MOT chan duong o kich ban dot bien (khong co luot doi chung, khong dem bai treo —
  dot 2 da sua) va cac no da TRA ngay: (1) `close()` treo vinh vien khi ho con ket noi bi NAT cat
  im (`pool.end()` cho QUIT hoi am, va sau `_closed` thi `destroy()` khong go duoc khoi danh sach)
  — nay `close()` co han `HAN_CAU_LENH_MS`, het han huy thang moi ket noi con theo doi; (2) han
  cau lenh 30s NGAN HON `innodb_lock_wait_timeout` 50s nen cho khoa bi doc thanh mang chet (huy ca
  ho nhan roi oan, khong doi lai) — nay moi ket noi dat `innodb_lock_wait_timeout` = 2/3 han
  (20s) cung cau SET, cho khoa noi len DUOI han bang dung ma doi lai; (3) trong callback dong
  ho cua `coHan`, `tuChoi` di TRUOC don dep, va `destroy`/`sauKhiHuy` boc try/catch — nhat ky nem
  (stream da dong, dung luc mat mang) khong duoc lam loi hua treo va giet tien trinh; (4)
  `kiemTuDemVoiMucLuc` bo token duoi 3 chu (`specificTokens` khong bao gio dung chung — bao gia).
  No con lai cua A4: `db_timeout` o COMMIT hay o cau ghi LE (autocommit) nghia la KHONG RO da
  ghi hay chua — may chu van co the chay xong cau do sau khi OMI bo cuoc (destroy = FIN, chieu
  doc con mo); tang cong cu chua doc ma nay de noi "hay kiem tra lai"; moi cau ghi tien phai
  nam trong `tx` va co chot chong trung (`is_draft`, `idemKey`). `kiemTuDemVoiMucLuc` chi soi
  `fillerWords`, khong soi `genericTerms`/STOPWORDS cung bi `specificTokens` loc (ten mon toan tu
  chung — "Ao Mau" — lot); `tuDemPham()` chua co noi DOC trong ma san xuat. `tatCa`/`dangBan`
  ro ri xac theo hai duong (bo thu mysql2 `destroy()` xac NAT chet im khong phat `end`; ket noi
  dang ban gap loi mang thi `release()` no-op) — chan boi `connectionLimit` moi dot, tich luy theo
  so lan dut mang suot doi tien trinh. `OMI_DB_NHAN_ROI_S` doc LUC MO (keo theo `idleTimeout`),
  hai bien kia doc moi lan goi — doi N phai khoi dong lai OMI; dat N duoi 5s la bo thu 1s cua
  mysql2 thua may chu (chi bai thu lam vay). Bo thu mysql2 dung `destroy()` (FIN, khong COM_QUIT)
  cho ket noi vuot `maxIdle` -> may chu dem `Aborted_clients`, vo hai. Bai mang: `chotUrl` bat
  URL ghi ro cong va khac 3306; nguong thoi gian (bo thu 1s, `< 700ms` sau router, KILL 300ms)
  do tren may nay — qua VPN/Hyper-V/firewall chan node.exe thi do theo moi truong, khong skip.

- **KICH HOAT KY SO + PHEU DANG KY + KHOA DU PHONG (A5, 11/09/2026):** `contract/ma-kich-hoat.ts` —
  ma kich hoat = `SPK1.` + base64url(JSON `SignedLicense`), `payload.machine = "*"` (`MAY_CHUA_GAN`,
  gan may luc kich hoat); `kyGiayPhep`/`kiemChuKyGiayPhep` (Ed25519, `canonicalLicenseJSON`);
  `giaiMaMaKichHoat` chi kiem HINH DANG va chan "PRIVATE KEY"; `chuoiDeKyKichHoat` co nhan `kich-hoat`
  nen proof kich hoat va proof hello khong dung cheo duoc. `contract/pheu-dang-ky.ts` — 11 cau hoi kin
  (`CAU_HOI_PHEU`), `pheuDangKy(cauTraLoi)` TAT DINH ra `{ manh[{id, viSao, nguon:"luat"}], luuY[] }`,
  `kiemCauTraLoi` tu choi truong la (van ban tu do KHONG phai dau vao cua luat), `gopDeNghi` giu de nghi
  AI o danh sach RIENG, `chotManh` = khach tick, tra manh MUA THEM (khong loi) cho `LicensePayload.modules`.
  Duong day: khung `activate` (thay `hello` khi OMI chua co khoa: ma + khoa CONG KHAI vua sinh tren may
  shop + proof ky bang khoa rieng tuong ung tren nonce), `activated` (tenant, keyId, manh, expiresAt,
  ghim cua Xeon), `pins` (Xeon day CA danh sach ghim). Xeon: `brain/link/kho-kich-hoat.ts` —
  `khoKichHoatTrongBoNho` / `khoKichHoatTrongTep(thuMuc, { khoiTao })` (`xeon.ky.key.pem` 0600 +
  `kich-hoat.json`), `capMa` (ma song 72 gio, giay phep 365 ngay), `kiemMa` (chu ky -> co trong so ->
  chua thu hoi -> chua dung -> ma con han -> giay phep con han), `dungMa` mot lan gan may, `thuHoiMa`,
  `giayPhepCua`/`congCuCua` = ma DUNG gan nhat, thu hoi thi KHONG lui ve ma cu; `KhoKhoaMay.nhan`
  nhan khoa cong khai OMI sinh (khoa rieng khong bao gio roi may shop); `taoMayChuDay({ khoKichHoat,
  cacGhim })` xu ly `activate` theo thu tu thu thach -> ban giao keo -> co kho -> giai ma -> proof ->
  kiemMa -> NHAN khoa -> dungMa (that bai thi thu hoi khoa vua nhan) -> `activated` -> dong;
  `mayChu.dayGhim(ghim, reason)` nem neu danh sach khong chua ghim DANG DUNG cua Xeon. VONG PHAN BIEN 1 (hai
  agent doi khang: an ninh giao thuc; van hanh + do manh test) ra 7 + 6 chan duong, phan lon trung nhau, DA VA:
  (1) hai OMI cung ma cung luc lam ca hai khoa chet (nhan truoc/danh dau sau xen nhau) -> ca doan kich hoat
  (kiemMa -> nhan -> dungMa -> thuHoiKhac) la MOT hang doi `xepHangKichHoat`; (2) thu hoi MA khong thu hoi KHOA,
  kich hoat lai tren may ten khac khong giet khoa may bi mat -> `dungMa` ghi `keyId`, `khoKichHoat.khiThuHoi`
  -> `khoKhoa.thuHoi`, va sau `dungMa` thanh cong `khoKhoa.thuHoiKhac(tenant, keyId)`: mot shop MOT khoa song
  (KE CA khoa cap tay bang `cap` cua cung shop — `seats` la so tai khoan nhan vien, khong phai so may; hai chi
  nhanh = hai tenant); (3) OMI co ho so thi bo qua ma moi -> `reject forbidden` + ma co
  `licenseId` khac ho so -> xoa ho so, kich hoat lai (mot lan, `daThuMaMoi`); (4) `pins` mot phat, khong gui
  lai -> Xeon day ghim hien tai ngay SAU `welcome` (OMI bo qua neu khong doi), OMI tat may luc xoay van nhan;
  (5) `pins` chi tin kenh TLS -> ke co khoa TLS cu bi lo day ghim doc -> `pins` mang `issuedAt` + `signature`
  bang KHOA KY GIAY PHEP (`khoKichHoat.kyGhim`), `activated.khoaCongKy` dua khoa cong khai do cho OMI luu
  (`xeon_ky_pem`), OMI tu choi khung khong ky / ky sai / `issuedAt` khong moi hon `ghim_at`; (6) Xeon TLS quen
  `cacGhim` -> `activated.ghim` rong -> OMI tu khoa minh -> Xeon lay ghim tu `socket.getCertificate()` khi khong
  co `cacGhim`, OMI them ghim dang noi neu danh sach thieu, `hoSo.ghim()` tra `undefined` (khong bao gio mang
  rong) de lui ve ghim bo cai; (7) `hoSo.luu` cham hon thang cho noi lai -> gui `activate` lan hai bang ma da
  tieu -> khoa dat TRUOC khi cho kho; (8) `capNhatGhim` tren MySQL nem khi danh sach y het (`affectedRows` 0)
  -> kiem ton tai bang SELECT; (9) mat tep du phong -> sinh moi im lang -> lan xoay sau khoa ngoai moi OMI ->
  dau `xeon.du-phong.moi` tren dia, `duPhongVuaSinh`, `xoayKhoaXeon` tu choi toi `epXoay: true` (dau mat khi
  xoay); (10) han chao no sau `dungMa` -> ma chay oan -> `traLaiMa` + thu hoi khoa; (11) ma cua shop khac cau
  hinh -> OMI tu choi TRUOC khi gui; (12) `congCuCua` cua may chu mac dinh = `khoKichHoat.congCuCua` (kiem
  giay phep o may chu khong the bi bo quen); (13) `PhienOmi.contract`, `pins` chi gui cho OMI >= 0.3.0.
  VONG PHAN BIEN 2 (cung hai agent, doc ban chup sau vong 1) ra 6 + 8 chan duong, DA VA: (1) `thuHoiKhac` nam
  sau lan soi day dong cuoi -> ma tieu + khoa moi mo coi + khoa cu da giet -> soi lai SAU `thuHoiKhac`, bo do
  thi `traLaiMa` + thu hoi khoa moi (khoa cu khong hoi sinh — ghi ro), va han chao DUNG khi bat dau kich hoat;
  (2) `hoSo.xoa()` truoc khi kich hoat lai vut danh sach ghim (sau xoay khoa, bo cai chi co ghim cu) -> khong
  xoa, `activated` moi ghi de; (3) ma moi cua SHOP KHAC khi `cfg.tenant` trong -> mat khoa shop A, cat may
  that shop B -> ma moi phai cung `hs.tenant`, `activated.tenant` phai bang shop trong ma dang kich hoat; (4)
  che do khong `cacGhim` (ghim tu chung chi socket) chi co MOT ghim -> `pins` sau welcome ghi de mat du phong
  -> bo che do do, `mayChuTls` NEM khi co kho kich hoat ma khong `cacGhim`; (5) `ghimLuc` = dong ho OMI vs
  `issuedAt` = dong ho Xeon -> lech gio la tu choi ghim that -> thay bang SO THU TU BEN (`ghimBen` trong so
  ma: tang khi danh sach doi, ghi dia truoc khi ky; `activated.ghimSeq`, `pins.seq`, cot `ghim_seq`), cung
  danh sach cung so thi bo qua chu khong "tu choi"; (6) so ma 0644 chua nguyen `SignedLicense` = ma chua dung
  tai tao duoc -> 0600; (7) `nhan` thu hoi khoa cu cung may TRUOC `dungMa` -> mot lan bo do giet khoa dang
  song -> thu tu moi: `dungMa` (danh dau) -> `nhan({ giuKhoaCu })` -> `dungMa({ ghiDe })` ghi keyId ->
  `thuHoiKhac`; (8) dau `xeon.du-phong.moi` khong bao gio tu xoa -> `xacNhanDuPhongDaPhat(thuMuc)` cho nguoi
  quan tri sau khi OMI da nhan; (9) gia han khong co duong di tren OMI co ho so -> nhanh kich hoat lai bat ca
  `license_invalid`; (10) `mayChu.dong()` van nhan ket noi moi -> `daDong`, them `catMoiPhien(lyDo)`; (11)
  `daThuMaMoi` la co chet -> bo; (12) `noiLaiNgay` sau `luu` cat phien moi vua noi -> chi khi socket con la
  socket kich hoat; (13) test: bai "hai OMI cung ma" ep chen bang `kiemMa` cham, bai "chuoi that" quet ca
  byte tren day (sau TLS, hai chieu), M40/M43 co bai rieng, bai OMI 0.2.0, hai shop cung luc, lech dong ho,
  gia han, kich hoat lai sau xoay, `dong()` roi noi, so ma lech khoa ky, khoa cap tay bi thu hoi.
  `brain/link/chung-chi-xeon.ts` — khoi tao sinh CA `xeon.du-phong.key.pem`; `cacGhim = [chinh, du
  phong]`; thu muc A3 mo lai thi sinh du phong (ghim chinh khong doi); du phong HONG thi mo that bai;
  `xoayKhoaXeon(thuMuc)` ba buoc (chung chi cua du phong -> rename du phong thanh chinh -> du phong
  moi), ngat giua chung thi `chungChiTrongTep` nhan ra (chung chi khop khoa du phong) va hoan tat;
  `capNhatChungChiTls(server, tuyChonTlsXeon(cc))` doi chung chi khong khoi dong lai. OMI:
  `omi/link/kich-hoat.ts` — bang `kich_hoat` (ban kho 4), `kichHoatTrongKho(db)` luu keyId + KHOA RIENG
  + ghim + giay phep; mot kho mot shop; `ghim()` la bo nho dem dong bo cho `ketNoiTls({ ghim: () =>
  hoSo.ghim() ?? GHIM_BO_CAI })`. `taoKhachDay({ kichHoat: { ma, hoSo } })`: `batDau` doc ho so (co thi
  chao thang; khong co ho so, khong co ma thi DUNG HAN, khong mo day); `activated` -> luu ho so -> dat
  khoa -> `noiLaiNgay`; `pins` -> TU CHOI neu khong chua ghim cua ket noi dang dung (`ghimCuaSocket`),
  neu khong thi `capNhatGhim` + `onGhim`. QUY TRINH XOAY KHOA (nguoi quan tri): (1) `xoayKhoaXeon` +
  `capNhatChungChiTls`; (2) CAT phien de OMI noi lai qua khoa moi (hay cho tu noi lai); (3) `dayGhim(cc.cacGhim)`
  — day TRUOC khi OMI noi lai qua khoa moi thi OMI tu choi (dung luat), khong hai nhung khong co tac dung.
- **NO cua A5:** khoa rieng cua may nam trong kho OMI dang PLAINTEXT (SQLite tep / MySQL — qua LAN toi
  MySQL o A4 va nam trong sao luu DB); `hoSo.doc()` tra ca khoa rieng cho moi nguoi goi (man "Lien ket tai
  khoan" serialize la lo) — ai chep duoc kho la co khoa may, nhung Xeon thu hoi duoc theo keyId, kich hoat
  lai la khoa cu chet, va ban OMI bi lay trom khong co gi quy (nguyen tac 2); ma hoa tai cho bang bi mat
  gan may la viec cua vo Electron (B7). Ma da tieu ma OMI khong nhan duoc `activated` (dut day sau khi Xeon
  gui) thi khoa mo coi nam o Xeon toi khi shop kich hoat lai (thuHoiKhac) — cap ma moi la viec cua nguoi;
  `hoSo.luu` NEM (kho hong) cung vay. `pins` KHONG co ack: Xeon dem "da gui", khong biet OMI da luu; OMI
  offline nhan o lan noi ke tiep (pins sau welcome) — xoay HAI lan lien tiep ma OMI khong noi giua chung
  la khoa ngoai. OMI cap khoa TAY (khong ho so) chi co ghim trong cau hinh, `pins` chi bao `onGhim`. Ke da
  co khoa TLS cu + ky duoc `pins` (tuc co ca khoa KY giay phep) thi xoay khoa TLS khong duoi duoc — hai
  khoa nam hai tep, cung mat la mat Xeon. Khong co cach xoay KHOA KY (`SignedLicense.keyId` co, kho chi biet
  mot khoa): mat khoa ky = cap lai moi ma chua dung. Phuc hoi `kich-hoat.json` tu ban cu trong 72 gio lam ma
  da dung thanh chua dung (kho khoa co keyId, kho ma co keyId — doi chieu duoc bang tay). Xeon THAT chua co
  API quan tri de `capMa`/`thuHoiMa`/`lietKe`/`dayGhim`/`xoayKhoaXeon`/cat phien — B8; nhung ham nay va
  `pheuDangKy -> gopDeNghi -> chotManh -> DonCapMa.modules`, `onGhim`, trang thai `da-kich-hoat`, cac truong
  `tenantName/packId/modules/expiresAt` trong ho so OMI (`expiresAt` cu dan sau gia han vi `refresh` khong
  cap nhat) CHUA CO NOI GOI ngoai test — nhu `loadActor`/`sauKhiChot` cac moc truoc, phai la thu noi dau
  tien cua B7/B8. Tuong thich: OMI 0.3.0 gap Xeon cu -> `activate` bi "khung hong", OMI lap noi lai theo
  thang cho vo tan khong bao ro; OMI 0.2.0 gap Xeon moi: khong bi `pins` (loc theo `PhienOmi.contract`)
  nhung kich hoat thi khong co. `license.minContract` van chua ai kiem (Xeon dung `cfg.minContract`);
  `payload.machine` van "*" sau kich hoat (may nam o kho khoa). `chotManh.them` nhan bat ky manh (khong gioi
  han trong de nghi AI) — nguoi duyet don van thay, `nguon` mat; `viSao` cua AI chua gioi han do dai.
  `machine` khong rang buoc dinh dang; OMI doi hostname -> `forbidden` dung han khong canh bao. Ma kich hoat
  khong ghi Xeon host/port — bo cai mang san. `activated.modules` la manh dang bat (ke ca loi), quyen that
  van o `welcome.tools`. OMI KHONG tu soi chu ky ma (`khoaCongKy()` co san neu B7 muon bao dan sai som). Hai
  tien trinh Xeon cung thu muc kho kich hoat ghi cheo (nhu kho khoa) — cap ma phai qua tien trinh Xeon dang
  chay; `kich-hoat.json` khong fsync thu muc sau rename. `xoayKhoaXeon` o tien trinh khac tien trinh giu
  `cacGhim` thi guard `dayGhim` soi ghim cu — `cacGhim` phai la closure doc `let cc` duoc gan lai sau xoay
  (README). Kich ban dot bien: con "bi bat chi vi treo" chay lai mot lan roi moi tinh. Mo hinh de doa "khoa
  TLS cu bi lo + dung giua" chi duoc va cho `pins` (ky bang khoa ky giay phep), CHUA va cho `activate`/
  `activated`: ke gia Xeon (con ghim cu trong ho so OMI toi khi nhan `pins` moi) bat duoc MA tu OMI dang kich
  hoat va tra `activated` gia (khoaCongKy/ghim cua ke gia) — OMI bi chiem toi khi cai lai; hardening: ma kich
  hoat mang khoa CONG ky cua Xeon (`sl.keyId` da co) de OMI soi `activated.khoaCongKy` va ky `challenge`.
  Ma chua dung = token chiem shop trong 72 gio (ai co ma kich hoat duoc va `thuHoiKhac` cat may that) —
  `thuHoiMa` la cach cuu. Khong co giao dich xuyen hai kho (kho khoa / so ma): dia day giua chung la khoa
  song khong ma hay ma tieu khong khoa — tung buoc da co duong quay dau nhung khong nguyen tu. `khiThuHoi`
  cua kho ma -> `khoKhoa.thuHoi` khong await: `thuHoiMa` tra `true` truoc khi khoa chet. `khoaDaThuHoi` cua
  may chu khong bao gio don. `parseLinkFrame` chua kiem `activated.expiresAt` la ISO, `hello.contract` la chuoi.
  `docDong` cua kho OMI SELECT ca `private_key_pem` cho `capNhatGhim`/`xoa` (khoa rieng qua LAN toi MySQL moi
  lan doi ghim). Dau `xeon.du-phong.moi` chi mat khi nguoi quan tri `xacNhanDuPhongDaPhat` (khong co ack cua
  OMI de tu biet). `pins` sau welcome chi khi co `cacGhim`. Han chao cua Xeon DUNG khi bat dau kich hoat: OMI
  giu socket ma DB Xeon treo thi phien cho-hello song toi khi OMI bo (OMI co han rieng).

- **VO OMI (ELECTRON) + KET NIEM KHOA MAY (B7, 11-12/09/2026):** moc nay tra bon mon no cua A5 bang
  cach cho chung MOT NOI GOI — man hinh. `packages/omi/src/vo/` la tang quyet dinh (chay bang Node
  thuan nen thu duoc); `packages/vo-omi/` la vo Electron, LOP MONG: mo cua so, doc cau hinh, dua
  `safeStorage` vao lam ket, bac MOT cua IPC.
  - `link/ket-may.ts`: `KET1.<ten ket>.<ban niem>`. `ketTuSafeStorage(safeStorage)` (DPAPI tren
    Windows / Keychain / keyring) va `ketThuNghiem(khoa32, ten)` (AES-256-GCM, cho bai thu va cho
    nguoi chay OMI ngoai Electron). `niem` SOI lai cho ma hoa: ban niem con nguyen chu cua ban ro
    hay chu "PRIVATE KEY" thi TU CHOI LUU (bay `basic_text` cua Linux); nen giu bi mat tren Linux
    theo DANH SACH TRANG (`gnome_libsecret`/`kwallet*`), "unknown" cung bi tu choi. TEN KET nam CA
    o tien to LAN ben trong ban ro (safeStorage khong co AAD) — sua tien to trong kho khong lua
    duoc ai. `mo` chi nhan dung dang; chuoi khong co tien to KHONG duoc doan la ban tho.
  - `link/kich-hoat.ts` len them: `docCong()` (ho so KHONG co khoa rieng — duong DUY NHAT cua tang
    vo, co `khoaDaNiem`/`ketTen`/`khoaMoDuoc`/`viSaoKhoaHong`), `niemLaiKhoa()` (nang kho cai truoc
    B7 tu khoa TRO len ket, mot lan, trong mot giao dich, va chi khi khoa doc duoc), `kichHoatTrongKho(db,
    { ket })`. `khoaMoDuoc` nghia la khoa DUNG DUOC (`createPrivateKey` sau khi mo), khong chi "mo
    ra duoc chuoi". `xoa()` KHONG di qua `docDong`: kho co hai ho so thi doc la nem, ma xoa la duong
    thoat duy nhat khoi cai kho do.
  - `vo/vo.ts` — `taoVoOmi({ hoSo, taoKhach, machine })`: BON man (`kich-hoat` / `ket-noi` / `gia-han`
    / `hong`), `xemMa` soi ma TAI CHO truoc khi gui (shop khac, may khac, `minContract` moi hon ban
    OMI, chu ky khong phai cua Xeon da kich hoat may nay, ma da dung, ma het han -> canh bao), `kichHoat`,
    `boHoSo` (chi o man Hong/Gia han), `nhatKy`. Mot vo = MOT khach day: `mo`/`kichHoat` dung khach cu,
    va `batKhach` dung khach MOI truoc roi moi ha khach cu (dung hong thi may dang chay khong mat day).
  - `vo/nhat-ky.ts` — vong tron co tran (200 dong), `sachDong` cat khoa rieng / ma kich hoat / ban niem /
    so dien thoai TRUOC khi dong vao bo nho (nhat ky la thu nguoi ta chup man hinh gui di khi bao loi).
  - `vo/cong.ts` — `KENH_VO` (danh sach TRANG 6 kenh), `chotRaNgoai` chan mot lan cuoi truoc khi bat cu
    thu gi roi tien trinh chinh (khoa rieng / ma THAT / ban niem). Chan "ma that" (`SPK1.` + >=16 ky tu)
    chu khong chan chuoi chi NHAC ten tien to — chan ca cau do la man hinh mat duong bao ly do dan sai.
  - `vo-omi/main.js`: cua so mo TRUOC khi mo kho (kho hong van co man Hong, khong phai mot cu bam khong
    ra gi); cau hinh doc `cau-hinh.json` trong thu muc du lieu (bien moi truong de len tren); ten may lay
    tu HO SO khi da kich hoat (doi ten may Windows khong duoc dot mot ma); ghim KHONG lui ve ghim bo cai
    khi da co ho so; `contextIsolation`+`sandbox`+`app.enableSandbox()`, CSP 'self', chan dieu huong/cua so
    bat ra/webview, `setPermissionCheckHandler`, devTools tat mac dinh, kiem NGUOI GUI o cua IPC duy nhat,
    duong DAY (`vo:doi`) cung qua `chotRaNgoai`, `before-quit` chan lai de dung day va dong kho cho sach.
  - HAI VONG PHAN BIEN DOI KHANG (moi vong hai agent: an ninh; van hanh + do manh test). Vong 1 ra 5+6
    chan duong, DA VA: (1) `xemMa` coi loi doc kho la "chua co ho so" -> tat CA BA cua soi dung luc kho
    hong; (2) duong DAY ra renderer khong qua chot; (3) chu cua may chu vao thang man hinh -> mot message
    co "SPK1." lam chot chan VINH VIEN (man trang, khong con duong ve); (4) `mo()` khong dung khach cu ->
    bam "thu mo lai" ba lan la bon khach day cung song; (5) het gio kich hoat khong dung day -> `activated`
    ve sau do tieu ma trong im lang; (6) mo kho TRUOC khi mo cua so -> kho hong la khong co cua so nao;
    (7) cau hinh chi tu bien moi truong (ban cai cho khach khong co duong dat); (8) man Hong la ngo cut khi
    khoa mo khong duoc (khong o dan ma, khong duong xoa ho so); (9) kho hai ho so lam ca `xoa()` nem;
    (10) `internal` (loi tam) bi day sang man Hong; (11) man Gia han khong bao gio roi du day da noi lai;
    (12) dua `da-kich-hoat`/`da-noi` lam pill ket; (13) `before-quit` khong cho ham async; (14) bo sach thuc
    don la bo luon Ctrl+V (ma dai 700-900 ky tu); (15) ten ket chi la chu o tien to; (16) `basic_text` khong
    bi bat boi phep soi ban ro.
    VONG 2 (cung hai agent, doc ban chup SAU vong 1) ra 4+6 chan duong, DA VA: (1) `app.enableSandbox()` goi
    TRONG `batDau` tuc la SAU `whenReady` — Electron NEM, OMI khong mo duoc lan nao (bai quet chi kiem CO mat
    lenh do, khong kiem CHO dat; nay co bai quet vi tri VA mot bai CHAY VO THAT bang Electron); (2) chu tho
    cua may chu van vao man hinh qua `day: tt` (`error.message`, `lyDo`) du `cauTuChoi` da sach — nay
    `sachTrangThai` lam sach truoc khi vao `ManVo`; (3) `bo-ho-so` mo qua rong: man Hong con sinh ra tu loi
    CAU HINH, bam nut la mat khoa may vo ich — nay chi cho bo khi ho so that su khong dung duoc (doc kho nem,
    hay `khoaMoDuoc === false`); (4) `kichHoat` khong bat loi cua `taoKhach` (ma no chay SAU khi da bo ho so
    hong) -> loi phot thang ra renderer va man hinh con ve ho so da xoa; (5) `congTam` (khi chua dung duoc
    `vo`) khong qua `chotRaNgoai`; (6) `sachDong` khong cat chu "PRIVATE KEY" TRAN trong khi `chotRaNgoai`
    chan no -> mot dong nhat ky lam chet ca kenh (nay hai bo loc co bai DUYET TUNG MAU CAM de khong lech
    nhau nua); (7) `before-quit` khong co han -> kho treo la cua so bien mat ma tien trinh con song, va khoa
    mot-ban-chay lam lan mo sau im lang (nay `Promise.race` 4 giay roi thoat); (8) `docCong` giai niem MOI LAN
    GOI (man hinh goi moi lan go phim) -> nho ket qua theo chinh ban da luu; (9) `xemMa` so ten may bang
    hostname trong khi tang day chao bang ten trong HO SO -> doi ten may Windows la ma gia han bi chinh OMI
    chan; (10) nut "Chép nhật ký" khong bao gio chay vi `setPermissionCheckHandler(() => false)` chan ca
    `clipboard-sanitized-write` (nay danh sach TRANG dung mot quyen, va co bai quet doi chieu hai ben);
    (11) trang thai cua khach day CU van ve len man hinh ("Đã dừng" nhap nhay sau khi bam Thu mo lai) — nay
    moi khach co so rieng; (12) het gio kich hoat ma `activated` ve kip thi phai DOC LAI kho truoc khi bao
    that bai. Con lai o muc "NO cua B7".
  - Bo bai: `test/vo-omi.test.js` (62 bai, co MOT bai chay vo Electron THAT) + hai bai MySQL that
    ("QUYET DINH 2 cho KET (B7)", "QUYET DINH 2 cho VO (B7)"). Chay thu tren may:
    `node scripts/xeon-thu.js` roi `npm run vo`.

- **NO cua B7:** `cau-hinh.json` trong thu muc du lieu la mot NEO TIN CAY moi (dia chi may chu, ghim bo cai,
  duong kho) — khong ky, moi tien trinh chay duoi tai khoan nguoi dung deu ghi duoc; may CHUA co ho so ma bi
  troi tep nay la noi vao mot may chu gia, va `xemMa` luc do chi CANH BAO (khong co khoa cong de soi chu ky).
  Duong vá that la bo cai mang san khoa cong ky cua Xeon — viec cua moc dong goi (B8/B9), khong phai cua ma.
  `ghim_json` va `xeon_ky_pem` trong kho VAN NAM TRO (chi khoa rieng duoc niem): ai ghi duoc kho thi doi duoc
  hai cai neo do; niem/MAC ca hang la viec con no. Mot kho dung chung cho HAI OMI (hai may cung mot
  `OMI_DB_URL`) chua co khoa: `luu` la SELECT-roi-UPSERT trong `db.tx`, khong `FOR UPDATE`, nen hai shop kich
  hoat cung luc tren MySQL co the ra HAI dong `kich_hoat` (kho do doc la nem; duong thoat duy nhat la nut
  "Bỏ hồ sơ", da co bai tren CA HAI duong kho). `khach.ts.dung()` khong huy duoc khung `activated` DANG chay:
  ha day roi ho so van co the duoc ghi vai giay sau — vo doc lai kho sau khi het gio de khong bao that bai
  oan, nhung khoang do van la mot cua so nho. Khong co bo dong goi (electron-builder/forge), khong bieu tuong,
  khong ky so, khong tu cap nhat — `cauTuChoi("version_too_old")` bao nguoi ta "cai ban moi" ma chua co cho
  lay ban moi; `app.getVersion()` van la 0.0.1. Nhat ky chi nam trong bo nho (200 dong): dong cua so la mat,
  va nut "Chép nhật ký" phu thuoc `navigator.clipboard` (co danh sach trang mot quyen, nhung tren ban Electron
  khong ho tro thi chi con boi den + Ctrl+C). Chua co man Cai dat trong vo: sua cau hinh la sua tay tep JSON.
  Tang trang (`giao-dien/vo.js`) chua co bai CHAY that — chi co bai quet chu cam va bai doi chieu `el("id")`
  voi `id=` trong HTML; `nutHaiLan`, `soiSauKhiGo`, ve nhat ky deu chua co bai. Phien trinh duyet DIEU KHIEN
  (dang nhap Sapo/Supersports, chay an) KHONG nam trong B7 — do la viec cua manh `lien-ket`.

## 4b. Du lieu ca nhan trong tri nho hoi thoai

Bo nao giu 40 luot tin gan nhat de hieu ngu canh. Trong do co so dien thoai khach tu go.
Luat: **dung trong luot, che truoc khi ghi xuong**. `handleTurn` goi `redactPII` tren moi
luot va bo `slots.phone` truoc khi luu, roi `assertNoStoredPII` chan lai mot lan nua.
He qua chap nhan duoc: luot sau can so dien thoai thi phai hoi lai khach.

## 5. Bon loai lien ket

| Lien ket | Giu gi | Cach noi | Nam o dau |
|---|---|---|---|
| OMI - Brain | Khoa may do Xeon cap | May shop **chu dong goi ra**, giu duong mo | Thuong truc |
| Fanpage - Brain | Token trang | Cap quyen chinh thuc + webhook | **Tren Xeon** |
| OMI - Sapo, Supersports | Phien dang nhap | Dang nhap trong tool | **Chi may khach** |
| OMI - SPX, Viettel Post | Tai khoan shop | Khoa API | May khach |

Tat may shop thi bot **van nhan tin va van chao**, nhung khong khang dinh ton kho
va khong chot don — hen nhan vien. Tha im ve con so con hon noi sai.

## 6. Phan quyen

Ba lop tach roi: (1) xem/sua du lieu, (2) *dung* ket noi, (3) chi tien.
Sau vai tro: chu shop, quan ly, ban hang, kho, ke toan, cong tac vien.
**Nhan vien ban hang khong duoc thay gia von** — giau o tang du lieu, khong phai an o giao dien.
Bot cung la mot tai khoan, quyen han che: doc ton, tra don, tao don nhap; khong chi tien,
khong sua gia, khong xoa.

## 6b. Mon no hoi thoai — dong chuong phan bien hoi thoai (10/09/2026)

Muoi mot vong phan bien hoi thoai nhieu luot da day toan bo loi con lai sang huong
"hoi lai" — dung huong SPEC chon tu dau ("tha im con hon noi sai"). Thuoc do duy nhat
la "bot noi SAI con so voi khach that": vong cuoi khong con ca nao. Nhung gi con lai la
bai toan MAT KHACH (hoi lai oan, khoa phien), do duoc bang chat that chu khong do duoc
bang doc ma. Ghi thanh no, xep theo muc dau:

1. **Ngan sach hoi lai 1 lan / 30 phut + khoa phien vinh vien** (`ask_back_once`,
   `handedOff` khong bao gio duoc dat lai). Hai cau hoi lai lien tiep — du khac nhau va
   hop le — la chuyen nguoi that va hoi thoai do chet han voi bot. Day la HE SO NHAN
   cua moi muc duoi; neu chi sua duoc mot thu, sua thu nay.
2. **Bat ky tu noi dung nao cung xoa tam diem** (`coTuChuLa`): "mau den con khong",
   "con mau trang khong shop" -> hoi lai ten mau. Huong sua doi xung voi `soLaTenMon`:
   chi coi la doi mon khi tu do CO trong muc luc hoac la ten hang da biet.
3. **Ten mon ngan gom tu thuong** ("Air Force", ma `AIR`): "ship air toi ha noi" nhay
   tam diem. `ITEM_MATCH_THRESHOLD` chia theo so token cua ten nen ten hai token chi can
   trung mot chu.
4. **Bot khong co y dinh CHOT DON**: "em lay paracetamol 2 duoc khong" -> loi chao. Day la
   thieu mot y dinh trong ho so, viec cua dot ban hang that.
5. **Tu chung con thieu o ho so** phai la QUYET DINH chu khong phai so suat: nen co danh
   sach tu chung pho quat ma bo soi CANH BAO khi ho so khong phu (ho so duoc khai "tu nay
   la ten hang cua toi" de tat canh bao). Cung hinh dang voi `kiemTuDemVoiMucLuc`.
6. ~~**`kiemTuDemVoiMucLuc` chua co noi goi**~~ DA TRA (A4): goi trong `mucLucTrongBoNho.nap`, la noi duy
   nhat muc luc di vao Bo nao. Chinh sach: BAO chu khong TU CHOI (xem `engine/muc-luc.ts`).
7. "co paracetamol 2 khong shop" doc la hoi loai 2(ml) — chap nhan; muon kin tuyet doi
   thi ho so phai khai dai gia tri hop le cua truc, KHONG lam bay gio (moi co che moi o
   tang nay da hai lan sinh loi moi).

Nguyen tac rut ra tu chuong nay, ap cho moi sua doi hoi thoai sau nay:
- Moi cong tu choi mot gia tri MOI phai go gia tri CU cua cung truc — `slots` song dai.
- Danh sach TRANG (tu bao hieu) chu khong phai danh sach DEN.
- Bai ve tri nho hoi thoai phai dai BA luot; bo tim kiem gia phai tra theo thu tu kho.
- Commit chi chay khi doc thay `fail 0` VA ket qua dot bien trong CUNG mot lenh.

## 7. Lo trinh

1. **Khung du an + ban giao keo** — xong
2. Brain: bo may trung lap + mot bo luat nganh mau
3. OMI: lop du lieu + cong cu cho bot — xong (sau vong phan bien, 284 bai)
4. Noi hai khoi, chat thu tra ton that — xong (ong trong bo nho; chat thu that lo ra ba
   loi hoi thoai nhieu luot, da va: neu ten mon khong hoi gi, cau hoi tiep mang con so
   lam mat tam diem, o truc dinh tu luot truoc de len cau hoi moi)
5. Bo luat nganh thu hai — xong: `nha-thuoc` chay qua CUNG duong day va CUNG bo may,
   chi doi bo luat; hai luot "co paracetamol 500mg khong" / "loai 650 con khong" ra
   dung 500mg roi 650mg (317 bai)
