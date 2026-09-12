"use strict";
// MAY CHU DUONG DAY — dau Xeon. May shop goi vao, Xeon phat thu thach, kiem chu ky, roi
// giu day.
//
// Tang nay KHONG biet gi ve socket la TCP hay TLS: no nhan mot `Duplex` (net.Socket hay
// tls.TLSSocket deu duoc). Bai kiem tra dung TCP noi bo; may that boc TLS ben ngoai.
//
// Bon luat:
//  1. Chua qua bat tay thi KHONG nhan khung nao khac. Khung `call`/`event` den truoc
//     `hello` hop le la dong day.
//  2. Thu thach co han, va moi day mot nonce. Khung `hello` phat lai (nonce cu) bi tu choi.
//  3. Su kien phai den DUNG THU TU: seq = seq cuoi + 1. Trung thi ack lai (OMI gui lai
//     sau khi noi lai la chuyen binh thuong), nhay coc thi dong day — mat su kien o giua.
//  4. Khung qua tran la dong day, khong thuong luong.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_CO_PINS = exports.HAN_DONG_MS = void 0;
exports.taoMayChuDay = taoMayChuDay;
exports.mayChuTcp = mayChuTcp;
exports.mayChuTls = mayChuTls;
const node_net_1 = require("node:net");
const node_tls_1 = require("node:tls");
const node_crypto_1 = require("node:crypto");
const contract_1 = require("@sp/contract");
/** Sau `end()` bay nhieu ms ma ben kia chua dong thi `destroy()`. */
exports.HAN_DONG_MS = 2000;
/** Ban giao keo tu do OMI hieu khung `pins` / `activated`. OMI cu hon nhan `pins` la mat day. */
exports.CONTRACT_CO_PINS = "0.3.0";
function taoMayChuDay(cfg) {
    if (cfg.khoKhoa === undefined && cfg.traKhoaMay === undefined) {
        throw new Error("taoMayChuDay can `khoKhoa` (may that) hoac `traKhoaMay` (bai thu).");
    }
    if (cfg.khoKhoa !== undefined && cfg.traKhoaMay !== undefined) {
        throw new Error("taoMayChuDay nhan MOT trong hai `khoKhoa` / `traKhoaMay`, khong nhan ca hai.");
    }
    const traKhoaMay = cfg.khoKhoa !== undefined
        ? (keyId) => cfg.khoKhoa.tra(keyId)
        : cfg.traKhoaMay;
    const khoKichHoatCfg = cfg.khoKichHoat;
    const congCuCua = cfg.congCuCua
        ?? (khoKichHoatCfg !== undefined ? (t) => khoKichHoatCfg.congCuCua(t, now0()) : undefined)
        ?? (() => { throw new Error("taoMayChuDay can `congCuCua` hoac `khoKichHoat` (giay phep da kich hoat)."); })();
    function now0() { return (cfg.now ?? (() => new Date()))(); }
    const now = cfg.now ?? (() => new Date());
    const ghi = cfg.ghi ?? (() => undefined);
    const heartbeatSec = cfg.heartbeatSec ?? 20;
    const tranKhung = cfg.maxFrameBytes ?? contract_1.MAX_FRAME_BYTES_MAC_DINH;
    const hanBatTay = cfg.hanBatTayMs ?? 10_000;
    const phien = new Map();
    const socketDangMo = new Set();
    /** Cach TU CHOI DUT KHOAT tung phien dang song, theo sessionId — de cat khi thu hoi khoa. */
    const tuChoiPhien = new Map();
    // Thu hoi khoa (ke ca do thay khoa) la cat NGAY phien dang dung khoa do. Khong cat thi ban
    // OMI bi lay trom van noi cho toi luc dut day.
    // `khoaDaThuHoi` ghi DONG BO trong nguoi nghe: mot cai bat tay dang doi DB giay phep thi
    // chua co trong `phien`, nguoi nghe khong thay — sau `phien.set` may chu soi lai tap nay
    // (khong co await o giua) nen thu hoi den truoc hay sau deu bi bat.
    const khoaDaThuHoi = new Set();
    const goNgheThuHoi = cfg.khoKhoa?.khiThuHoi((tin) => {
        khoaDaThuHoi.add(tin.keyId);
        for (const p of [...phien.values()]) {
            if (p.keyId === tin.keyId)
                tuChoiPhien.get(p.sessionId)?.(tin.lyDo);
        }
    });
    // Thu hoi MA la thu hoi KHOA da nhan bang ma do: khong thi ban OMI kich hoat bang ma bi lo van noi.
    const goNgheThuHoiMa = cfg.khoKichHoat?.khiThuHoi((tin) => {
        if (tin.keyId === undefined || cfg.khoKhoa === undefined)
            return;
        void cfg.khoKhoa.thuHoi(tin.keyId, `ma kich hoat ${tin.licenseId} bi thu hoi: ${tin.lyDo}`)
            .then((ok) => { if (!ok)
            ghi(`[day] thu hoi ma ${tin.licenseId}: khoa ${tin.keyId} khong con song trong kho khoa (da thu hoi, hay kho khoa phuc hoi tu ban cu?)`); })
            .catch((e) => ghi(`[day] thu hoi khoa ${tin.keyId} theo ma that bai: ${String(e?.message ?? e)}`));
    });
    // MOT hang doi cho toan bo doan kich hoat (kiem ma -> nhan khoa -> danh dau): hai OMI cung ma cung
    // luc thi OMI sau moi thay "ma da dung", khong xen vao giua lam ca hai chet.
    let hangKichHoat = Promise.resolve();
    const xepHangKichHoat = (viec) => {
        const p = hangKichHoat.then(viec, viec);
        hangKichHoat = p.catch(() => undefined);
        return p;
    };
    /**
     * Ghim cua chinh Xeon = `cacGhim` (chinh + du phong). KHONG doc tu chung chi cua socket: socket chi
     * biet khoa chinh, OMI kich hoat xong se khong co ghim du phong va lan xoay khoa dau tien la khoa
     * ngoai — `mayChuTls` bat buoc `cacGhim` khi co kho kich hoat (`thieuCacGhim`).
     */
    const ghimCuaXeon = (socket) => {
        if (cfg.cacGhim !== undefined)
            return [...cfg.cacGhim()];
        // TLS ma khong co cacGhim: khong den duoc day (mayChuTls nem). TCP: khong co ghim.
        const s = socket;
        if (typeof s.getCertificate === "function")
            ghi("[day] CANH BAO: socket TLS nhung khong co cacGhim — OMI se khong co ghim du phong");
        return [];
    };
    let daDong = false;
    const khungGhim = async (ghim, reason) => {
        const issuedAt = now().toISOString();
        if (cfg.khoKichHoat === undefined)
            return { t: "pins", v: contract_1.LINK_PROTOCOL_VERSION, ghim: [...ghim], reason, seq: 0, issuedAt };
        const ky = await cfg.khoKichHoat.kyGhim(ghim, reason);
        return { t: "pins", v: contract_1.LINK_PROTOCOL_VERSION, ghim: [...ghim], reason, seq: ky.seq, issuedAt, signature: ky.signature };
    };
    function ganSocket(socket) {
        // Sau `dong()` nguoi nghe thu hoi da bi go: nhan them ket noi la mot phien khong ai cat duoc.
        if (daDong) {
            socket.destroy();
            return;
        }
        socketDangMo.add(socket);
        const tach = new contract_1.BoTachKhung(tranKhung);
        const nonce = (0, contract_1.sinhNonce)();
        const phatLuc = now().getTime();
        let trangThai = "cho-hello";
        let tenant;
        let machine;
        let sessionId = "";
        let seqCuoi = 0;
        let lanCuoiNghe = now().getTime();
        const nguoiNghe = new Set();
        let nhipTim;
        let hanHello;
        const gui = (f) => {
            if (trangThai === "dong")
                return;
            socket.write((0, contract_1.dongKhung)(f));
        };
        const dong = (lyDo) => {
            if (trangThai === "dong")
                return;
            trangThai = "dong";
            ghi(`[day] dong ${tenant ?? "?"}/${machine ?? "?"}: ${lyDo}`);
            if (nhipTim !== undefined)
                clearInterval(nhipTim);
            if (hanHello !== undefined)
                clearTimeout(hanHello);
            if (tenant !== undefined && phien.get(tenant)?.sessionId === sessionId)
                phien.delete(tenant);
            tuChoiPhien.delete(sessionId);
            if (socket.destroyed) {
                socketDangMo.delete(socket);
                return;
            }
            // `end()` de khung reject vua ghi di het ra mang. Nhung ben kia co the KHONG BAO GIO tra
            // FIN — NAT da nuot (dut day im lang), hay mot khach co y giu — khong co du phong
            // `destroy()` thi socket TLS nam lai tren Xeon vo han, moi phien "mat nhip tim" la mot
            // socket, va `socketDangMo` phai giu no toi luc dong THAT de `mayChu.dong()` con don duoc.
            const duPhong = setTimeout(() => socket.destroy(), exports.HAN_DONG_MS);
            duPhong.unref();
            socket.once("close", () => { clearTimeout(duPhong); socketDangMo.delete(socket); });
            socket.end();
        };
        const tuChoi = (code, message, retryAfterSec) => {
            gui({ t: "reject", v: contract_1.LINK_PROTOCOL_VERSION, error: (0, contract_1.linkError)(code, message), retryAfterSec });
            dong(`tu choi: ${message}`);
        };
        // 1. Thu thach truoc. Chua co hello hop le trong han thi dong.
        gui({ t: "challenge", v: contract_1.LINK_PROTOCOL_VERSION, nonce, expiresAt: new Date(phatLuc + hanBatTay).toISOString() });
        hanHello = setTimeout(() => { if (trangThai === "cho-hello")
            dong("khong chao trong han"); }, hanBatTay);
        const xuLyHello = async (f) => {
            if (now().getTime() > phatLuc + hanBatTay) {
                tuChoi("bad_input", "Thu thach da het han.", 1);
                return;
            }
            if (f.nonce !== nonce) {
                tuChoi("forbidden", "Thu thach khong khop — khung chao bi phat lai?", 0);
                return;
            }
            if (!(0, contract_1.isCompatible)(f.contract, cfg.minContract)) {
                tuChoi("version_too_old", `Ban giao keo ${f.contract} qua cu, can toi thieu ${cfg.minContract}. Cap nhat OMI.`, 0);
                return;
            }
            const khoa = await traKhoaMay(f.keyId);
            // Han chao co the no trong luc dang cho kho/DB: `dong()` da chay, khong duoc hoi sinh.
            if (trangThai !== "cho-hello")
                return;
            if (khoa === null) {
                tuChoi("forbidden", "Khoa may khong duoc cap.", 0);
                return;
            }
            if (khoa.tenant !== f.tenant || khoa.machine !== f.machine) {
                tuChoi("forbidden", "Khoa may khong thuoc ve shop/may nay.", 0);
                return;
            }
            const chuoi = (0, contract_1.chuoiDeKy)({ nonce, tenant: f.tenant, machine: f.machine, contract: f.contract });
            if (!(0, contract_1.kiemChuKy)(khoa.publicKeyPem, chuoi, f.proof)) {
                tuChoi("forbidden", "Chu ky sai.", 0);
                return;
            }
            const tools = await congCuCua(f.tenant);
            if (trangThai !== "cho-hello")
                return;
            if (tools.length === 0) {
                tuChoi("license_invalid", "Giay phep het han hoac bi thu hoi.", 3600);
                return;
            }
            const seqCuoiCuaShop = await cfg.seqCuoi(f.tenant);
            if (trangThai !== "cho-hello")
                return;
            // Kiem lai khoa SAU await cuoi: thu hoi co the den trong luc dang cho DB giay phep.
            if ((await traKhoaMay(f.keyId)) === null || khoaDaThuHoi.has(f.keyId)) {
                tuChoi("forbidden", "Khoa may da bi thu hoi.", 0);
                return;
            }
            if (trangThai !== "cho-hello")
                return;
            // Bat tay xong. Mot shop chi co MOT phien: phien cu (neu con) bi thay.
            tenant = f.tenant;
            machine = f.machine;
            sessionId = (0, node_crypto_1.randomUUID)();
            seqCuoi = seqCuoiCuaShop;
            const cu = phien.get(f.tenant);
            if (cu !== undefined)
                cu.dong("phien moi thay the");
            const p = {
                tenant: f.tenant, machine: f.machine, keyId: f.keyId, contract: f.contract, sessionId,
                kenh: {
                    gui: (fr) => gui(fr),
                    nghe: (fn) => { nguoiNghe.add(fn); return () => { nguoiNghe.delete(fn); }; }
                },
                dong,
                song: () => trangThai === "da-noi" && now().getTime() - lanCuoiNghe < heartbeatSec * 2000
            };
            phien.set(f.tenant, p);
            // Ly do thu hoi la chu cua nguoi quan tri ("may bi mat", ghi chu noi bo) — khong gui
            // nguyen van cho mot ban OMI co the da bi lay trom. Ghi nhat ky, gui cau chung.
            tuChoiPhien.set(sessionId, (lyDo) => {
                ghi(`[day] cat phien ${f.tenant}/${f.machine}: khoa ${f.keyId} bi thu hoi (${lyDo})`);
                tuChoi("forbidden", "Khoa may da bi thu hoi.", 0);
            });
            trangThai = "da-noi";
            // Thu hoi den giua luc doi `traKhoaMay` o tren va `phien.set` (ca hai deu la microtask):
            // nguoi nghe chua thay phien, ban doc cua `tra` thi da cu. Tu day den `phien.set` khong
            // co await, nen soi tap nay la kin.
            if (khoaDaThuHoi.has(f.keyId)) {
                tuChoiPhien.get(sessionId)?.("thu hoi trong luc bat tay");
                return;
            }
            if (hanHello !== undefined)
                clearTimeout(hanHello);
            gui({
                t: "welcome", v: contract_1.LINK_PROTOCOL_VERSION, sessionId, tools, heartbeatSec,
                maxFrameBytes: tranKhung, maxInflight: contract_1.MAX_INFLIGHT, lastEventSeq: seqCuoi
            });
            nhipTim = setInterval(() => {
                if (now().getTime() - lanCuoiNghe > heartbeatSec * 2000) {
                    dong("mat nhip tim");
                    return;
                }
                gui({ t: "ping", v: contract_1.LINK_PROTOCOL_VERSION, at: now().toISOString() });
            }, heartbeatSec * 1000);
            ghi(`[day] noi ${f.tenant}/${f.machine} phien ${sessionId}, gui tiep tu seq ${seqCuoi}`);
            // Ghim hien tai NGAY SAU welcome: OMI tat may luc xoay khoa van nhan duoc danh sach moi;
            // OMI bo qua neu khong doi. OMI cu (truoc 0.3.0) khong hieu khung nay.
            const ghimHienTai = ghimCuaXeon(socket);
            if (ghimHienTai.length > 0 && (0, contract_1.isCompatible)(f.contract, exports.CONTRACT_CO_PINS)) {
                const khung = await khungGhim(ghimHienTai, "ghim hien tai cua Xeon");
                if (trangThai === "da-noi" && phien.get(f.tenant)?.sessionId === sessionId)
                    gui(khung);
            }
            cfg.onPhien?.(p);
        };
        // KICH HOAT (A5): OMI chua co khoa. Thu tu kiem: thu thach -> ban giao keo -> co kho khong ->
        // ma doc duoc -> proof (OMI giu khoa rieng cua khoa cong khai no khai) -> ma con dung duoc ->
        // NHAN khoa vao kho -> danh dau ma da dung -> `activated` -> dong (OMI chao lai bang hello).
        // Nhan khoa TRUOC, danh dau SAU: danh dau that bai (ma vua bi dung o noi khac) thi thu hoi khoa
        // vua nhan — khong bao gio co khoa song ma khong co ma nao chung minh.
        const xuLyKichHoat = async (f) => {
            if (now().getTime() > phatLuc + hanBatTay) {
                tuChoi("bad_input", "Thu thach da het han.", 1);
                return;
            }
            if (f.nonce !== nonce) {
                tuChoi("forbidden", "Thu thach khong khop — khung kich hoat bi phat lai?", 0);
                return;
            }
            if (!(0, contract_1.isCompatible)(f.contract, cfg.minContract)) {
                tuChoi("version_too_old", `Ban giao keo ${f.contract} qua cu, can toi thieu ${cfg.minContract}. Cap nhat OMI.`, 0);
                return;
            }
            const khoKichHoat = cfg.khoKichHoat;
            const khoKhoa = cfg.khoKhoa;
            if (khoKichHoat === undefined || khoKhoa === undefined) {
                tuChoi("forbidden", "Xeon nay khong nhan kich hoat (khong co kho kich hoat).", 0);
                return;
            }
            const giai = (0, contract_1.giaiMaMaKichHoat)(f.code);
            if (!giai.ok) {
                tuChoi("bad_input", `Ma kich hoat khong doc duoc: ${giai.reason}`, 0);
                return;
            }
            const chuoi = (0, contract_1.chuoiDeKyKichHoat)({ nonce, licenseId: giai.license.licenseId, machine: f.machine, contract: f.contract });
            if (!(0, contract_1.kiemChuKy)(f.publicKeyPem, chuoi, f.proof)) {
                tuChoi("forbidden", "Chu ky kich hoat sai: khoa cong khai khong khop khoa da ky.", 0);
                return;
            }
            // Thu tu: danh dau ma TRUOC (ma chi tieu duoc mot lan, ke ca hai OMI dua nhau), NHAN khoa
            // moi ma KHONG thu hoi khoa cu, roi moi thu hoi khoa cu cua ca shop khi chac chan xong. Bo do
            // o bat ky buoc nao: tra lai ma, thu hoi khoa vua nhan, KHOA CU CUA MAY VAN SONG (OMI dang
            // chay khong bi cat oan vi mot lan DB cham).
            // Han chao DUNG tu day: doan kich hoat tu ket thuc (activated + dong, hay reject); OMI co han rieng va
            // se dong day — luc do day dong duoc soi o tung buoc. Han chao no giua chung chi de lai "bo do".
            if (hanHello !== undefined) {
                clearTimeout(hanHello);
                hanHello = undefined;
            }
            const kq = await xepHangKichHoat(async () => {
                const kiem = await khoKichHoat.kiemMa(f.code, now());
                if (!kiem.ok)
                    return { ok: false, code: kiem.code, reason: kiem.reason };
                if (trangThai !== "cho-hello")
                    return { ok: false, code: "internal", reason: "day dong" };
                const payload = kiem.license.payload;
                const licenseId = kiem.license.licenseId;
                const daDung = await khoKichHoat.dungMa(licenseId, f.machine);
                if (!daDung)
                    return { ok: false, code: "forbidden", reason: "Ma kich hoat da dung roi. Can ma moi." };
                const boDo = async (viSao, keyId) => {
                    await khoKichHoat.traLaiMa(licenseId);
                    if (keyId !== undefined)
                        await khoKhoa.thuHoi(keyId, `kich hoat bo do: ${viSao}`);
                    ghi(`[day] kich hoat ${payload.tenant}/${f.machine} bo do (${viSao}); ma ${licenseId} tra lai`);
                    return { ok: false, code: "internal", reason: viSao };
                };
                let keyId;
                try {
                    ({ keyId } = await khoKhoa.nhan(payload.tenant, f.machine, f.publicKeyPem, { giuKhoaCu: true }));
                }
                catch (e) {
                    await khoKichHoat.traLaiMa(licenseId);
                    return { ok: false, code: "bad_input", reason: `Khoa cong khai khong nhan duoc: ${String(e?.message ?? e)}` };
                }
                // Ghi keyId vao so ma (thu hoi ma = thu hoi khoa nay); so ma doi giua chung (thu hoi dung luc) la bo do.
                if (!(await khoKichHoat.dungMa(licenseId, f.machine, keyId, { ghiDe: true }))) {
                    await khoKhoa.thuHoi(keyId, "kich hoat that bai: ma bi thu hoi giua chung");
                    return { ok: false, code: "forbidden", reason: "Ma kich hoat da bi thu hoi." };
                }
                if (trangThai !== "cho-hello")
                    return boDo("day dong truoc khi bao OMI", keyId);
                // Mot shop MOT khoa song: may cu (ke ca ten khac — laptop bi mat) chet cung luc.
                const daThuHoi = await khoKhoa.thuHoiKhac(payload.tenant, keyId, "kich hoat bang ma moi: khoa cu cua shop bi thu hoi");
                if (daThuHoi.length > 0)
                    ghi(`[day] kich hoat ${payload.tenant}: thu hoi ${daThuHoi.length} khoa cu (${daThuHoi.join(", ")})`);
                // Soi lai SAU lan ghi cuoi: day dong trong luc thu hoi khoa cu thi ma tra lai, khoa moi thu hoi —
                // khoa cu khong hoi sinh (shop dang kich hoat lai, may cu la may bi thay), ghi ro.
                if (trangThai !== "cho-hello") {
                    if (daThuHoi.length > 0)
                        ghi(`[day] kich hoat ${payload.tenant} bo do SAU khi da thu hoi ${daThuHoi.length} khoa cu — khoa cu khong hoi sinh; shop dung lai ma`);
                    return boDo("day dong sau khi thu hoi khoa cu", keyId);
                }
                return { ok: true, keyId, licenseId, payload };
            });
            if (trangThai !== "cho-hello")
                return;
            if (!kq.ok) {
                tuChoi(kq.code, kq.reason, 0);
                return;
            }
            const ghim = ghimCuaXeon(socket);
            gui({
                t: "activated", v: contract_1.LINK_PROTOCOL_VERSION, tenant: kq.payload.tenant, tenantName: kq.payload.tenantName, keyId: kq.keyId,
                packId: kq.payload.packId, modules: (0, contract_1.enabledModules)(kq.payload), expiresAt: kq.payload.expiresAt, ghim,
                khoaCongKy: khoKichHoat.khoaCongKy()[0] ?? "", ghimSeq: ghim.length > 0 ? (await khoKichHoat.kyGhim(ghim, "kich hoat")).seq : 0,
                issuedAt: now().toISOString()
            });
            ghi(`[day] kich hoat ${kq.payload.tenant}/${f.machine}: khoa ${kq.keyId}, giay phep ${kq.licenseId}, ${ghim.length} ghim`);
            dong("da kich hoat; OMI chao lai bang khoa may");
        };
        const xuLyKhung = async (khung) => {
            const kiem = (0, contract_1.parseLinkFrame)(khung);
            if (!kiem.ok) {
                dong(`khung hong: ${kiem.reason}`);
                return;
            }
            const f = kiem.frame;
            lanCuoiNghe = now().getTime();
            if (trangThai === "cho-hello") {
                if (f.t === "activate") {
                    await xuLyKichHoat(f);
                    return;
                }
                if (f.t !== "hello") {
                    dong(`khung "${f.t}" truoc khi chao`);
                    return;
                }
                await xuLyHello(f);
                return;
            }
            if (trangThai !== "da-noi")
                return;
            switch (f.t) {
                case "ping":
                    gui({ t: "pong", v: contract_1.LINK_PROTOCOL_VERSION, at: now().toISOString() });
                    return;
                case "pong": return;
                case "event": {
                    // Luat 3: dung thu tu. Trung thi ack lai; nhay coc thi dong.
                    if (f.seq <= seqCuoi) {
                        gui({ t: "ack", v: contract_1.LINK_PROTOCOL_VERSION, seq: seqCuoi });
                        return;
                    }
                    if (f.seq !== seqCuoi + 1) {
                        dong(`su kien nhay coc: nhan ${f.seq}, cho ${seqCuoi + 1}`);
                        return;
                    }
                    if (f.event.tenant !== tenant) {
                        dong("su kien mang tenant khac");
                        return;
                    }
                    await cfg.nhanSuKien(tenant, f.seq, f.event);
                    seqCuoi = f.seq;
                    gui({ t: "ack", v: contract_1.LINK_PROTOCOL_VERSION, seq: seqCuoi });
                    return;
                }
                case "result":
                case "cancel":
                case "call":
                case "ack":
                    for (const fn of nguoiNghe)
                        fn(f);
                    return;
                default:
                    dong(`khung "${f.t}" khong hop le o phia nay`);
            }
        };
        let hangDoi = Promise.resolve();
        socket.on("data", (mau) => {
            let khungs;
            try {
                khungs = tach.nap(mau);
            }
            catch (e) {
                dong(e instanceof contract_1.VuotTranKhung ? e.message : `loi tach khung: ${String(e)}`);
                return;
            }
            for (const k of khungs) {
                if ("loi" in k) {
                    dong(k.loi);
                    return;
                }
                // Xu ly tuan tu: su kien phai den dung thu tu, nen khong duoc chay chen nhau.
                hangDoi = hangDoi.then(() => xuLyKhung(k.khung)).catch((e) => dong(`loi xu ly: ${String(e?.message ?? e)}`));
            }
        });
        socket.on("error", (e) => dong(`socket loi: ${e.message}`));
        // Dong TRUOC KHI CHAO la dau hieu rieng: OMI vua kiem ghim va tu choi Xeon nay (Xeon doi
        // khoa ma OMI chua co ghim moi?), hay mot may quet cong. Khong ghi rieng thi sau su co doi
        // khoa nhat ky Xeon chi toan "socket dong" — vo dung.
        socket.on("close", () => dong(trangThai === "cho-hello" ? "socket dong TRUOC KHI CHAO (OMI tu choi ghim? quet cong?)" : "socket dong"));
    }
    return {
        ganSocket,
        phienCua: (tenant) => phien.get(tenant),
        lamMoi: (tenant, what, reason) => {
            // Kiem khung TRUOC khi gui: nguoi goi JS dua chuoi thay vi mang thi OMI se bo day vi
            // "khung hong tu Xeon" — loi cua minh ma lai lam shop mat day.
            const khung = { t: "refresh", v: contract_1.LINK_PROTOCOL_VERSION, what, reason };
            const kiem = (0, contract_1.parseLinkFrame)(khung);
            if (!kiem.ok)
                throw new Error(`lamMoi: ${kiem.reason}`);
            const p = phien.get(tenant);
            if (p === undefined || !p.song())
                return false;
            p.kenh.gui(khung);
            ghi(`[day] bao ${tenant} lam moi ${what.join(",")}: ${reason}`);
            return true;
        },
        dayGhim: async (ghim, reason) => {
            // Kiem TRUOC khi ky (ky la tang so ben khi danh sach doi).
            const thu = (0, contract_1.parseLinkFrame)({ t: "pins", v: contract_1.LINK_PROTOCOL_VERSION, ghim: [...ghim], reason, seq: 0, issuedAt: now().toISOString() });
            if (!thu.ok)
                throw new Error(`dayGhim: ${thu.reason}`);
            if (cfg.cacGhim !== undefined) {
                const dangDung = cfg.cacGhim()[0];
                if (dangDung !== undefined && !ghim.includes(dangDung)) {
                    throw new Error(`dayGhim: danh sach khong chua ghim DANG DUNG cua Xeon (${dangDung}) — OMI nhan xong se bi khoa ngoai. Xoay khoa va cho OMI noi lai truoc, day sau.`);
                }
            }
            const khung = await khungGhim(ghim, reason);
            let n = 0;
            for (const p of [...phien.values()]) {
                if (!p.song() || !(0, contract_1.isCompatible)(p.contract, exports.CONTRACT_CO_PINS))
                    continue;
                p.kenh.gui(khung);
                n += 1;
            }
            ghi(`[day] day ${ghim.length} ghim toi ${n} phien: ${reason}`);
            return n;
        },
        catMoiPhien: (lyDo) => {
            let n = 0;
            for (const p of [...phien.values()]) {
                p.dong(`cat moi phien: ${lyDo}`);
                n += 1;
            }
            ghi(`[day] cat ${n} phien: ${lyDo}`);
            return n;
        },
        thieuCacGhim: cfg.khoKichHoat !== undefined && cfg.cacGhim === undefined,
        dong: () => { daDong = true; goNgheThuHoi?.(); goNgheThuHoiMa?.(); for (const s of [...socketDangMo])
            s.destroy(); phien.clear(); tuChoiPhien.clear(); }
    };
}
/** May chu TCP thuan — cho bai kiem tra va cho mang noi bo tin cay. */
function mayChuTcp(mayChu) {
    return (0, node_net_1.createServer)((socket) => mayChu.ganSocket(socket));
}
/**
 * May chu TLS — cho Internet. `opts` lay tu `tuyChonTlsXeon(chungChi)`. Ket noi hong truoc
 * khi bat tay TLS xong (khach im lang qua han, gui rac, TLS qua cu) khong bao gio toi
 * `ganSocket`: ghi nhat ky va cat, de socket khong nam lai.
 */
function mayChuTls(mayChu, opts, ghi = () => undefined) {
    if (mayChu.thieuCacGhim) {
        throw new Error("mayChuTls: may chu co kho kich hoat thi PHAI co `cacGhim: () => cc.cacGhim` (chinh + du phong) — khong thi OMI kich hoat xong chi co mot ghim, lan xoay khoa dau tien la khoa ngoai moi OMI.");
    }
    const server = (0, node_tls_1.createServer)(opts, (socket) => mayChu.ganSocket(socket));
    server.on("tlsClientError", (e, socket) => {
        ghi(`[tls] bat tay hong tu ${socket.remoteAddress ?? "?"}: ${e.message}`);
        socket.destroy();
    });
    return server;
}
//# sourceMappingURL=may-chu.js.map