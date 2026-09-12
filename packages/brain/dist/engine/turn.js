"use strict";
// MOT LUOT TIN — tu luc nhan den luc quyet dinh gui hay goi nguoi.
//
// Thu tu co y nghia: LUAT CHAY TRUOC, AI CHAY SAU. Toan bo duong di duoi day la
// tat dinh — cung dau vao ra cung dau ra, khong goi mo hinh nao.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISPATCHABLE_TOOLS = exports.ITEM_MATCH_THRESHOLD = void 0;
exports.applyAliases = applyAliases;
exports.detectIntent = detectIntent;
exports.extractAxis = extractAxis;
exports.canonicalValue = canonicalValue;
exports.labelValue = labelValue;
exports.labelMatches = labelMatches;
exports.handleTurn = handleTurn;
const contract_1 = require("@sp/contract");
const memory_1 = require("./memory");
const gates_1 = require("./gates");
const text_1 = require("./text");
/** Nguong nhan ra mon hang: cau khach phu duoc bao nhieu phan ten san pham. */
exports.ITEM_MATCH_THRESHOLD = 0.5;
/**
 * O thay the mang DU LIEU. Neu mau cau dung mot trong nhung o nay ma gia tri rong
 * thi cau gui di se thung ("Da khung con suat:  a") — bo may phai coi do la loi.
 */
const BASE_DATA_VARS = [
    "tinhtrang", "ton", "gia", "giacao", "kho", "sokho", "bienthe", "chinhsach",
    "madon", "trangthai", "conphaitra", "songay", "link", "dsbienthe"
];
// ---------------------------------------------------------------- tu dien
function applyAliases(pack, text) {
    let out = (0, text_1.normalize)(text);
    for (const [wrong, right] of Object.entries(pack.lexicon.aliases)) {
        const w = (0, text_1.normalize)(wrong);
        if (w === "" || w === (0, text_1.normalize)(right))
            continue;
        out = out.split(w).join((0, text_1.normalize)(right));
    }
    return out;
}
// ---------------------------------------------------------------- y dinh
function detectIntent(pack, text) {
    const n = applyAliases(pack, text);
    let best = null;
    for (const intent of pack.intents) {
        let score = 0;
        for (const kw of intent.keywords)
            if ((0, text_1.hasWord)(n, kw))
                score += 2;
        for (const p of intent.patterns ?? []) {
            try {
                if (new RegExp(p).test(n))
                    score += 3;
            }
            catch { /* validatePack da bao */ }
        }
        for (const kw of intent.negativeKeywords ?? [])
            if ((0, text_1.hasWord)(n, kw))
                score -= 3;
        if (score > 0 && (best === null || score > best.score))
            best = { intent, score };
    }
    return best?.intent ?? null;
}
// ---------------------------------------------------------------- bien the
function extractAxis(axis, text) {
    try {
        const m = new RegExp(axis.pattern).exec((0, text_1.normalize)(text));
        return m?.[1]?.trim() ?? null;
    }
    catch {
        return null;
    }
}
/** Quy gia tri ve dang chuan de SO KHOP. */
function canonicalValue(axis, value) {
    let out = (0, text_1.normalize)(value);
    for (const rule of axis.canonical) {
        try {
            out = out.replace(new RegExp(rule.pattern), rule.replace);
        }
        catch { /* da bao */ }
    }
    return out.trim();
}
/**
 * Rut gia tri cua truc nay ra khoi NHAN KHO, roi moi quy chuan.
 *
 * Nhan kho hay viet ghep: "500 mg x 30 vien", "EU 42", "US 8.5 / EU 42".
 * Neu chi quy chuan ca chuoi thi cac luat neo `^...$` khong bao gio ap duoc,
 * va bot bao HET HANG trong khi kho dang co hang — loi nang nhat da gap.
 */
function labelValue(axis, rowLabel) {
    const direct = canonicalValue(axis, rowLabel);
    const extracted = extractAxis(axis, rowLabel);
    return extracted === null ? direct : canonicalValue(axis, extracted);
}
/** Nhan kho co khop gia tri khach hoi khong. */
function labelMatches(axis, requested, rowLabel) {
    const req = canonicalValue(axis, requested);
    if (req === "")
        return false;
    if (labelValue(axis, rowLabel) === req)
        return true;
    // KHONG dung so khop tien to nua: "42 2/3" bat dau bang "42 " nen size 42 bi coi
    // la con hang trong khi kho chi co he 1/3. `labelValue` da rut dung gia tri roi.
    return canonicalValue(axis, rowLabel) === req;
}
function render(template, vars, dataVars) {
    const set = dataVars ?? new Set(BASE_DATA_VARS);
    const missing = [];
    const text = template.replace(/\{(\w+)\}/g, (_m, key) => {
        const v = vars[key];
        if (v === undefined || (v === "" && set.has(key)))
            missing.push(key);
        return v ?? "";
    });
    return { text: text.replace(/\s{2,}/g, " ").trim(), missing };
}
function tpl(pack, key) {
    return pack.templates[key] ?? "";
}
/**
 * Bang dieu phoi cong cu. Them mot cong cu = them MOT dong o day.
 * `validatePack` doi chieu bang nay, nen ho so khong the khai mot cong cu
 * ma bo may khong biet chay — truoc day khai xong thi bot lang le hoi lai mai.
 */
/**
 * Goi mot cong cu KEM ngu canh luot goi. Moi cho goi cong cu deu phai di qua day.
 *
 * Ma hoi thoai la mot cai CONG o phia OMI, khong phai mot truong de trang tri: bot
 * khong mang theo thi khong mo duoc don nao. Khoa chong trung lay theo LUOT (hoi thoai
 * + moc gio cua luot) nen duong day gui lai cung luot se ra cung ket qua, khong sinh
 * them mot don nhap thu hai.
 */
function goiCongCu(c, tool, input) {
    return c.ports.tools.call(tool, input, {
        conversationId: c.conversationId,
        // Khoa gom CA TEN CONG CU: hai cong cu khac nhau trong cung mot luot phai co hai
        // khoa khac nhau, con goi lai DUNG cong cu do trong cung luot thi phai ra cung khoa.
        idempotencyKey: `${c.conversationId}:${c.luotLuc}:${tool}`
    });
}
/**
 * So TRAN trong cau — con so ma khach dung de chi MOT BIEN THE, khong phai so luong,
 * don vi, tien, thoi gian, dia chi.
 *
 * Hai lop, va lop thu hai la DANH SACH TRANG:
 *   1. Sau con so khong duoc la tu chi so luong / don vi / tien / thoi gian ("42 doi",
 *      "50 kg", "42.000d", "43 hom", "40 do").
 *   2. Truoc con so PHAI la mot tu bao hieu bien the ("size 42", "loai 650", "con 650",
 *      "het 650", "em di 42") — hoac con so dung dau tin ("42 thi sao").
 *
 * Vi sao danh sach trang: vong phan bien truoc dung danh sach den ("khong duoc dung sau
 * nang/cao/coc/...") va no khong bao gio du — "thu 5 em qua lay", "em o quan 3", "nha em
 * o toa 43", "troi 40 do" deu lot, va bot tra loi ton kho cua bien the 5ml / 3ml / 43 / 40
 * cho nhung cau khong he hoi ve bien the. Danh sach trang hong theo chieu "hoi lai";
 * danh sach den hong theo chieu "noi sai".
 */
const SAU_SO_KHONG_DUOC = /^\s*(?:doi|cai|chiec|hop|vien|goi|chai|tuyp|lo|thung|bo|vi|ong|don|be|tep|bich|cap|tui|set|hu|kg|gr|gam|cm|km|nghin|ngan|tr|trieu|ty|vnd|tuoi|nam|thang|ngay|hom|bua|buoi|tuan|gio|phut|lan|nguoi|ng|do|k|g|m|d|%)(?![\p{L}])/u;
/** Tu bao hieu bien the, dung chung moi nganh. Ho so bo sung bang ten/ma truc cua no. */
/**
 * Tu bao hieu MANH: dung truoc so la gan nhu chac chan dang noi ve bien the.
 */
const CUE_MANH = new Set([
    "size", "loai", "kieu", "mau", "dong", "het", "chon", "di", "mang", "chan",
    "ham", "luong", "quy", "cach", "kich", "thuoc"
]);
/**
 * Tu bao hieu YEU: sau khi bo dau, chung DONG AM voi tu thuong ("co" = co/co, "la" =
 * loai-la/la, "con" = con/con). "em CO 2 be nho", "em CON 2 don chua nhan", "cai nay LA
 * 5 phai khong" deu la cau doi thuong. Voi nhom nay con so phai dung CUOI CAU hoac ngay
 * truoc dau ngat / tu hoi ("con 650 KHONG", "can 650 NHE") moi tinh.
 */
const CUE_YEU = new Set(["co", "con", "la", "nay", "em", "anh", "chi", "minh"]);
/**
 * DONG TU DAT HANG. Tan ngu cua chung gan nhu luon la SO LUONG ("minh lay 2 nhe", "cho em
 * 2", "em mua 2 duoc khong", "em can 2 thoi"), con tan ngu cua "co/con/het" la BIEN THE.
 * Vong truoc gop hai nhom lam mot, va cau chot don pho bien nhat o quay thuoc — "minh lay
 * 2 nhe" — duoc tra loi bang ton kho cua lo 2ml. Co mot dong tu dat hang dung TRUOC con so
 * thi khong tu bao hieu yeu nao con tinh; con so do la so luong.
 */
const DONG_TU_DAT_HANG = /(?:^|[^\p{L}])(?:lay|mua|can|cho|xin|dat|order|goi)(?:[^\p{L}]|$)/u;
/** Lien tu liet ke: so dung sau no thua huong tu bao hieu cua so truoc ("650 hay 700"). */
const LIEN_TU_LIET_KE = new Set(["hay", "hoac", "va", "voi"]);
/**
 * Sau con so phai la dau ngat hoac tu NGHI VAN. KHONG co tieu tu khang dinh (nhe, nha,
 * thoi, luon, a, di): "2 nhe", "2 thoi", "2 luon" la tieu tu cua cau CHOT DON, khong phai
 * cau hoi — de chung o day thi "paracetamol 2 nhe shop" ra "Con 4 hop 2ml".
 */
const SAU_LA_HOI = /^\s*(?:$|[?.!,;)]|con\b|khong\b|ko\b|k\b|thi\b|het\b|nua\b|duoc\b|dc\b|chua\b|hay\b|hoac\b|va\b|voi\b|nhi\b|ha\b|hong\b)/u;
/** Dong tu dat hang chi veto khi no cach con so KHONG QUA chung nay token. */
const CUA_SO_DAT_HANG = 3;
/**
 * So MO DAU TIN ma bot khong dang hoi gi: chi tinh la bien the khi theo sau la tu hoi TON
 * KHO ("650 con khong", "42 het chua", "42 thi sao"). "2 duoc khong shop", "2 nhe" khi
 * khong ai hoi gi la so luong — hoi lai van hon doan.
 */
const SAU_LA_HOI_TON = /^\s*(?:con\b|khong\b|ko\b|het\b|chua\b|thi\b|nua\b)/u;
function soTranTrongCau(pack, text, tuyChon = {}) {
    const cueThem = tuyChon.cueThem ?? new Set();
    const soTenMon = tuyChon.soTenMon ?? new Set();
    const dangTraLoi = tuyChon.dangTraLoi === true;
    // Ten mon la tu bao hieu, nhung KHONG phai tu bao hieu manh: "cho em paracetamol 2 nhe"
    // la chot don, con so dung ngay sau ten mon van phai qua chot cau hoi nhu nhanh yeu.
    const manh = new Set(CUE_MANH);
    for (const a of pack.itemShape.axes) {
        manh.add((0, text_1.normalize)(a.id));
        for (const t of (0, text_1.tokens)((0, text_1.normalize)(a.label)))
            manh.add(t);
    }
    const ra = [];
    // Dau `,` `.` chi la PHAN LE khi theo sau la chu so: "650, gio 700" co hai so tran,
    // khong phai mot.
    for (const m of text.matchAll(/(?<!\d|\d[.,])(\d+(?:[.,]\d+)?)(?!\d|[.,]\d)/g)) {
        const i = m.index ?? 0;
        if (soTenMon.has(m[1] ?? ""))
            continue;
        const truoc = text.slice(0, i).replace(/[\s:,.\-]+$/u, "");
        const sau = text.slice(i + m[0].length);
        if (SAU_SO_KHONG_DUOC.test(sau))
            continue;
        const tuTruoc = /(\p{L}+)$/u.exec(truoc)?.[1];
        const dauTin = truoc === "";
        // "650 HAY 700", "42 HOAC 43": so sau lien tu liet ke thua huong tu bao hieu cua so
        // truoc. Khong co dong nay thi "loai 650 hay 700 con khong" chi con MOT so tran (700
        // bi loai vi "hay" khong phai tu bao hieu), bot doan 650 va tra loi mot nua cau hoi
        // nhu the khach chi hoi 650.
        const noiTiep = tuTruoc !== undefined && LIEN_TU_LIET_KE.has(tuTruoc) && ra.length > 0;
        // Veto dat hang chi trong CUA SO gan: "minh lay 2" (cach 1), "cho em 2" (cach 2) thi
        // veto; "cho em hoi paracetamol con 650 khong" (cach 4) thi khong — "cho em hoi" va
        // "xin hoi" la cau mo dau pho bien nhat trong hop thu, quet ca cau la hoi lai oan.
        const gan = (0, text_1.tokens)(truoc).slice(-CUA_SO_DAT_HANG).join(" ");
        const dangDatHang = DONG_TU_DAT_HANG.test(gan);
        const laHoi = SAU_LA_HOI.test(sau);
        const qua = noiTiep
            || (dauTin && (dangTraLoi || SAU_LA_HOI_TON.test(sau)))
            || (tuTruoc !== undefined && manh.has(tuTruoc))
            || (tuTruoc !== undefined && cueThem.has(tuTruoc) && !dangDatHang && laHoi)
            || (tuTruoc !== undefined && CUE_YEU.has(tuTruoc) && !dangDatHang && laHoi);
        if (!qua)
            continue;
        ra.push(Number((m[1] ?? "").replace(",", ".")));
    }
    return ra;
}
/**
 * Doan gia tri truc tu mot SO TRAN trong cau khach, doi chieu voi nhan kho that.
 *
 * "loai 650 con khong" — mau nhan dang cua truc ham luong doi don vi (650mg), nen "650"
 * tran khong duoc rut ra, va bot hoi lai ten thuoc trong khi vua tra loi ve chinh thuoc
 * do. Nhung kho chi co 500mg va 650mg: "650" chi co the la 650mg.
 *
 * Ba cai chot, ca ba deu THU HEP:
 *   - trong cau chi co DUNG MOT so tran (xem `soTranTrongCau`); hai so la mo ho;
 *   - so do khop DUNG MOT nhan kho; khop hai nhan hay khong nhan nao la khong doan;
 *   - gia tri doan chi song trong luot nay — khong luu sang luot sau (xem cho goi).
 * Hoi lai van hon doan sai.
 */
function doanTrucTuSoTran(pack, axis, rows, text, tuyChon) {
    const so = soTranTrongCau(pack, text, tuyChon);
    if (so.length !== 1)
        return null;
    const khop = new Set();
    for (const x of rows) {
        const v = labelValue(axis, x.variantLabel);
        const dau = /^\d+(?:[.,]\d+)?/.exec(v)?.[0];
        if (dau === undefined)
            continue;
        if (Number(dau.replace(",", ".")) === so[0])
            khop.add(v);
    }
    return khop.size === 1 ? ([...khop][0] ?? null) : null;
}
const DISPATCH = {
    "stock.lookup": async (c) => {
        if (c.itemCode === null)
            return { facts: [], vars: {}, answered: false };
        const r = await goiCongCu(c, "stock.lookup", { code: c.itemCode });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        // Ket qua bi cat thi con so nao cung co the sai: kho that con 20 doi size 42
        // nam ngoai trang dau, bot se bao "het size". Tha im con hon noi sai.
        if (r.data.truncated)
            return { facts: [], vars: {}, answered: false, partial: true };
        const axes = c.pack.itemShape.axes;
        let rows = r.data.rows;
        // Chi tinh la "da loc" khi loc theo truc BAT BUOC. Truoc day khach noi quy cach
        // (truc khong bat buoc) la co bat len, vo hieu luon cong doi ham luong —
        // roi bot cong don hai ham luong khac nhau lai voi nhau.
        // Truc bat buoc KHONG duoc rut ra trong chinh cau nay: thu doan tu so tran, doi
        // chieu voi nhan kho THAT (truoc khi loc, de nhin thay moi bien the).
        //
        // Va doan duoc thi duoc phep THAY gia tri dinh tu luot truoc. "co paracetamol 500mg
        // khong" roi "loai 650 con khong": o ham luong con dinh 500mg, khong thay thi bot
        // tra loi ton cua 500mg cho cau hoi ve 650 — noi mot con so DUNG cho mot cau hoi
        // KHAC, dung loai loi ma khong cong nao bat duoc vi moi con so deu co nguon.
        const slots = { ...c.slots };
        let slotsFound;
        const slotsGo = [];
        for (const axis of axes) {
            if (!axis.requiredForStock || c.slotsThisTurn.has(axis.id))
                continue;
            const doan = doanTrucTuSoTran(c.pack, axis, rows, c.text, c.soTuyChon);
            if (doan !== null) {
                slots[axis.id] = doan;
                slotsFound = { ...(slotsFound ?? {}), [axis.id]: doan };
                continue;
            }
            // Cau CO so tran ma khong doan duoc (hai so, hoac khop hai nhan): gia tri ghim tu
            // luot truoc cung phai bi GO. Tu choi mot con so moi ma van tra loi bang con so cu
            // khong phai la im lang — do la noi mot con so DUNG cho mot cau hoi KHAC.
            if (soTranTrongCau(c.pack, c.text, c.soTuyChon).length > 0 && slots[axis.id] !== undefined) {
                delete slots[axis.id];
                slotsGo.push(axis.id);
            }
        }
        let filteredRequired = false;
        for (const axis of axes) {
            const want = slots[axis.id];
            if (want === undefined)
                continue;
            const loc = rows.filter((x) => labelMatches(axis, want, x.variantLabel));
            if (axis.requiredForStock) {
                rows = loc;
                filteredRequired = true;
            }
            else if (loc.length > 0) {
                rows = loc;
            }
            // Truc KHONG bat buoc ma loc ra rong ("cho em 2 vien" khi nhan kho khong ghi quy
            // cach): BO bo loc do. Giu la `total = 0` va bot bao HET HANG trong khi kho dang co
            // 12 hop — loi nang nhat trong SPEC, tren cau noi thuong ngay nhat o quay thuoc.
        }
        const facts = rows.map((x) => ({
            source: "stock.lookup",
            text: `${x.variantLabel}: con ${x.qty} tai ${x.warehouseName}, gia ${x.price}`,
            numbers: [x.qty, x.price, ...(0, gates_1.numbersIn)(x.variantLabel)]
        }));
        // CHUA loc theo truc bat buoc ma kho co nhieu bien the: KHONG duoc cong don roi
        // gan nhan cua dong dau tien. Lam vay la bot noi "con 5 doi size 42" trong khi
        // size 42 con 0 — moi con so deu "co nguon" nen khong cong nao bat duoc.
        const mainAxis = axes[0];
        const labels = new Set(rows.map((x) => (mainAxis === undefined ? x.variantLabel : labelValue(mainAxis, x.variantLabel))));
        const needAxis = axes.find((a) => a.requiredForStock && slots[a.id] === undefined);
        if (!filteredRequired && needAxis !== undefined && labels.size > 1) {
            return {
                facts, answered: false, needAxis: needAxis.id,
                vars: { dsbienthe: [...labels].join(", ") },
                ...(slotsGo.length === 0 ? {} : { slotsGo })
            };
        }
        const total = rows.reduce((s, x) => s + x.qty, 0);
        const prices = [...new Set(rows.map((x) => x.price))].sort((a, b) => a - b);
        const warehouses = new Set(rows.map((x) => x.warehouseId));
        const first = rows[0];
        if (rows.length > 0) {
            facts.push({
                source: "stock.lookup",
                text: `tong ton ${total} tai ${warehouses.size} kho`,
                numbers: [total, warehouses.size, ...prices]
            });
        }
        const vars = {
            // Khong huu han (dong kho thieu `qty`) thi de RONG cho cong "o rong" bat — in ra
            // "Con NaN doi" la mot cau khong co chu so nao de cong chong bia so soi.
            ton: Number.isFinite(total) ? String(total) : "",
            // TIEN doc cho khach di qua dung mot goc — xem `dinhDangTien`. Cong chong bia so
            // doc lai duoc dang nay (`scanNumbers` go dau tien te truoc khi bo dau), nen doi
            // cach viet o day khong lam bot bi chinh cong cua no chan.
            gia: prices[0] === undefined ? "" : (0, contract_1.dinhDangTien)(prices[0]),
            giacao: prices[prices.length - 1] === undefined
                ? "" : (0, contract_1.dinhDangTien)(prices[prices.length - 1]),
            kho: first?.warehouseName ?? "",
            sokho: String(warehouses.size),
            dsbienthe: [...labels].join(", ")
        };
        if (mainAxis !== undefined && slots[mainAxis.id] === undefined && labels.size === 1) {
            const only = [...labels][0] ?? "";
            vars[mainAxis.id] = only;
            vars["bienthe"] = only;
        }
        // Nhieu muc gia trong cung mot cau tra loi: neu ho so co mau rieng thi dung,
        // khong thi bao gia thap nhat — nhung van de lai `giacao` de ho so tu chon.
        const key = total <= 0
            ? "out_of_stock"
            : (prices.length > 1 && tpl(c.pack, "in_stock_range") !== "" ? "in_stock_range" : "in_stock");
        // Cau ban hang that duoc dung O DAY, nen phai canh o thay the rong ngay tai day.
        // Truoc do vong ngoai chi thay `{tinhtrang}` da day nen khong con gi de bao,
        // va cau thung kieu "Con 5 hop , gia 25000 a" di thang toi khach.
        const cau = render(tpl(c.pack, key), { ...c.vars, ...vars, ...(slotsFound ?? {}) }, c.dataVars);
        vars["tinhtrang"] = cau.text;
        return {
            facts, vars, answered: true, missing: cau.missing,
            ...(slotsFound === undefined ? {} : { slotsFound }),
            ...(slotsGo.length === 0 ? {} : { slotsGo })
        };
    },
    "policy.get": async (c) => {
        const topic = c.slots["topic"] ?? "";
        const r = await goiCongCu(c, "policy.get", { topic });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        if (!r.data.found)
            return { facts: [], vars: {}, answered: false };
        return {
            facts: [{ source: "policy.get", text: r.data.text, numbers: (0, gates_1.numbersIn)(r.data.text) }],
            vars: { chinhsach: r.data.text, tinhtrang: r.data.text },
            answered: true,
            hasPolicySource: true
        };
    },
    "order.lookup": async (c) => {
        const phone = c.slots["phone"];
        if (phone === undefined)
            return { facts: [], vars: {}, answered: false };
        const r = await goiCongCu(c, "order.lookup", {
            conversationId: c.conversationId,
            phoneGivenInConversation: phone
        });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        const o = r.data.orders[0];
        if (o === undefined)
            return { facts: [], vars: {}, answered: false };
        return {
            facts: [{
                    source: "order.lookup",
                    text: `don ${o.orderId} trang thai ${o.status}, con phai tra ${o.money.remaining}`,
                    // So nam trong TRANG THAI don ("con 2 ngay nua toi") cung la su that do shop
                    // viet ra — khong dua vao nguon thi cau tra loi dung lai bi chan.
                    numbers: [
                        o.money.total, o.money.paid, o.money.remaining,
                        ...(0, gates_1.numbersIn)(String(o.orderId)), ...(0, gates_1.numbersIn)(o.status)
                    ]
                }],
            vars: {
                madon: String(o.orderId), trangthai: o.status,
                conphaitra: (0, contract_1.dinhDangTien)(o.money.remaining)
            },
            answered: true
        };
    },
    "purchase.eta": async (c) => {
        if (c.itemId === null)
            return { facts: [], vars: {}, answered: false };
        const r = await goiCongCu(c, "purchase.eta", { itemId: c.itemId });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        const days = r.data.days;
        return {
            facts: days === undefined ? [] : [{ source: "purchase.eta", text: `ve trong ${days} ngay`, numbers: [days] }],
            vars: { songay: days === undefined ? "" : String(days) },
            answered: r.data.available
        };
    },
    "storefront.link": async (c) => {
        const r = await goiCongCu(c, "storefront.link", { q: c.itemCode ?? "" });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        return { facts: [], vars: { link: r.data.url }, answered: true };
    },
    "variant.chart": async (c) => {
        if (c.itemId === null)
            return { facts: [], vars: {}, answered: false };
        const r = await goiCongCu(c, "variant.chart", { itemId: c.itemId });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        const labels = r.data.rows.map((x) => x.label);
        return {
            facts: [{ source: "variant.chart", text: labels.join(", "), numbers: labels.flatMap((l) => (0, gates_1.numbersIn)(l)) }],
            vars: { dsbienthe: labels.join(", ") },
            answered: labels.length > 0
        };
    },
    "customer.recognize": async (c) => {
        const r = await goiCongCu(c, "customer.recognize", { conversationId: c.conversationId });
        if (!r.ok)
            return { facts: [], vars: {}, answered: false, failed: true };
        return { facts: [], vars: {}, answered: false };
    }
};
/** Cong cu bo may biet chay. `validatePack` doi chieu voi danh sach ho so khai. */
exports.DISPATCHABLE_TOOLS = Object.keys(DISPATCH);
// ---------------------------------------------------------------- luot
async function handleTurn(pack, ports, input) {
    const now = ports.clock.now();
    const at = input.at ?? now.toISOString();
    const nap = await ports.memory.load(input.tenant, input.conversationId);
    // Doi chieu nha ban hang: kho tri nho khoa nham theo mot minh ma hoi thoai la
    // shop B nhan duoc cau tra loi ton kho cua shop A. Bo nao phuc vu nhieu khach,
    // nen khong duoc tin ket qua tra ve chi vi da hoi dung khoa.
    const loaded = nap !== null && nap.tenant === input.tenant ? nap : null;
    const base = loaded ?? (0, memory_1.emptyState)(input.tenant, input.conversationId);
    let state = (0, memory_1.appendTurn)(base, { role: "customer", text: input.text, at, imageCount: input.imageCount }, now);
    const online = ports.tools.online();
    const available = new Set(ports.tools.available());
    const axes = pack.itemShape.axes;
    const normText = applyAliases(pack, input.text);
    // --- nhan dien mon hang ---------------------------------------------------
    const specific = (0, text_1.specificTokens)(normText, pack.lexicon.genericTerms, pack.lexicon.fillerWords ?? []);
    // Bot vua hoi mot truc, khach tra loi bang MOT CON SO: "650" cho cau hoi ham luong.
    // Tinh o day vi khoi nhan dien mon ben duoi can biet dieu nay: con so do khong duoc
    // bi coi la ten mot mon khac (Vitamin C 500) — no la cau tra loi cho o vua hoi.
    const traLoiBangSo = state.lastAskedSlot !== undefined
        && state.lastAskedSlot !== "item" && state.lastAskedSlot !== "topic"
        && /^\s*\d+(?:[.,]\d+)?\s*\p{L}{0,4}\s*$/u.test(normText);
    let itemCode = state.focusItemCode ?? null;
    let itemId = state.focusItemId ?? null;
    let candidates = [];
    let itemNamedThisTurn = false;
    /** Cac tu trong ten/ma cua mon vua nhan ra — de biet cau con noi gi NGOAI ten mon. */
    let tuTenMon = new Set();
    // Chay ca khi cau chi co mot SO HAI CHU SO: "con 90 khong" (Air Max 90) — `specificTokens`
    // doi >= 3 ky tu nen "90" khong vao `specific`, va khong chay khoi nay la khong bao gio
    // biet khach vua goi ten mot mon khac.
    const coSoHaiChuSo = (0, text_1.tokens)(normText).some((t) => /^\d{2,}$/.test(t));
    if (specific.length > 0 || coSoHaiChuSo) {
        candidates = await ports.catalog.search(input.tenant, normText, 5);
        const top = candidates[0];
        const second = candidates[1];
        const topScore = top === undefined ? 0 : (0, text_1.coverage)(normText, `${top.code} ${top.name}`);
        const secondScore = second === undefined ? 0 : (0, text_1.coverage)(normText, `${second.code} ${second.name}`);
        if (top !== undefined && topScore >= exports.ITEM_MATCH_THRESHOLD && topScore > secondScore) {
            itemCode = top.code;
            itemId = top.id;
            itemNamedThisTurn = true;
            tuTenMon = new Set((0, text_1.tokens)(`${top.code} ${top.name}`));
        }
        else if (state.focusItemCode !== undefined) {
            // Luot nay mang tu rieng ma khop mot mon KHAC: khach da chuyen mon. Giu tam diem
            // cu la bot tra ton kho cua mon A cho cau hoi ve mon B.
            //
            // Nhung KHONG TIM THAY MON NAO thi khong phai bang chung doi mon. "size 43 thi sao"
            // hay "loai 650 con khong" mang mot con so — con so bi coi la tu rieng, tim trong
            // muc luc khong ra, va truoc day the la tam diem bi xoa: bot quen mat mon vua noi,
            // hoi lai qua so lan, roi chuyen nguoi that — ca phien dong lai chi vi mot cau
            // hoi tiep rat binh thuong.
            // "boston con size 43 khong": goi bang ten ngan, ma so khop khong du nguong, nhung
            // ung vien dau bang CHINH LA mon dang noi — do khong phai doi mon.
            const stillAboutFocus = (0, text_1.coverage)(normText, state.focusItemCode) >= exports.ITEM_MATCH_THRESHOLD
                || (top !== undefined && top.code === state.focusItemCode);
            // Khong khi con so la CAU TRA LOI cho o vua hoi: "500" khop 1/3 ten "Vitamin C 500"
            // la du vuot nguong nay, va tam diem nhay sang mot mon khach khong he nhac.
            // Va phai khop it nhat MOT TU CHU cua mon do: "41 con khong" khop 1/3 ten "Pegasus 41"
            // chi bang con so — ma 41 la mot size. Khop thuan so thi de `soLaTenMon` xet, vi no
            // biet loai tru so nam trong dai cua mot truc.
            const khopChu = top !== undefined
                && (0, text_1.tokens)(`${top.code} ${top.name}`).some((t) => /^\p{L}/u.test(t) && (0, text_1.hasWord)(normText, t));
            const coMonKhac = !traLoiBangSo && top !== undefined && top.code !== state.focusItemCode
                && topScore >= exports.ITEM_MATCH_THRESHOLD * 0.6 && khopChu;
            // Tu CHU la ("salomon", "speedcross") la khach dang noi ve hang khac, du muc luc
            // khong co — bot khong duoc tra ton kho adidas cho cau hoi ve Salomon. Con mot con
            // so tran ("650", "43") hay so kem don vi ("650mg") thi khong phai ten mon.
            const coTuChuLa = specific.some((t) => /^\p{L}/u.test(t));
            // Mot con so LA ten mon khi muc luc co mon mang dung so do trong ten/ma: New
            // Balance 574, 1080, 990. "con 574 khong shop" la doi mon that — khong nhan ra thi
            // bot tra ton cua doi cu cho cau hoi ve doi moi. Con "650" (khong mon nao mang) thi
            // van la mot con so, khong phai ten mon.
            // Xet CA so 2 chu so ("Air Max 90") — `specificTokens` doi >= 3 ky tu nen bo sot.
            // Khong xet ung vien CHINH LA mon cu ("Boston 13" mang "13"), va khong xet khi con
            // so la CAU TRA LOI cho o bot vua hoi ("500" cho ham luong, du co Vitamin C 500).
            // Va khong xet con so ma mau cua mot truc trong ho so nhan ("41" la size 35-52):
            // shop ban ca Pegasus 41 thi "41 con khong" ve mon dang noi la hoi size 41, khong
            // phai doi sang Pegasus — huong an toan la giu tam diem.
            const soLaTenMon = !traLoiBangSo && (0, text_1.tokens)(normText).some((t) => /^\d{2,}$/.test(t)
                && !axes.some((a) => extractAxis(a, t) !== null)
                && candidates.some((it) => it.code !== state.focusItemCode && (0, text_1.tokens)(`${it.code} ${it.name}`).includes(t)));
            if (!stillAboutFocus && (coMonKhac || coTuChuLa || soLaTenMon)) {
                itemCode = null;
                itemId = null;
            }
        }
    }
    const itemIdentified = itemCode !== null;
    // Chi coi la DOI mon khi truoc do da co mon. Neu truoc do chua biet mon nao thi
    // day la khach dang tra loi cau hoi cua bot — khong duoc xoa gia tri truc da co.
    const itemChanged = state.focusItemCode !== undefined && itemCode !== state.focusItemCode;
    // --- o thong tin ----------------------------------------------------------
    // Doi mon thi bo gia tri truc cua mon cu: hoi Boston size 42 roi chuyen sang Hoka
    // thi khong duoc mac dinh van la size 42.
    const slots = itemChanged ? {} : { ...(state.focusSlots ?? {}) };
    const echoed = [];
    /** Truc nao co gia tri rut ra tu CHINH cau nay — khac voi gia tri dinh tu luot truoc. */
    const slotsThisTurn = new Set();
    /** So tran hop le trong cau — cong chung cho ca mau cua ho so lan `doanTrucTuSoTran`. */
    // Tu trong ten/ma mon dang noi: mon vua nhan ra o luot nay, hoac ung vien dau bang
    // chinh la mon cu, hoac chi la ma mon cu. "boston 43", "paracetamol 650".
    const dau = candidates[0];
    const cueThem = new Set([
        ...(dau !== undefined && (itemNamedThisTurn || dau.code === state.focusItemCode)
            ? (0, text_1.tokens)(`${dau.code} ${dau.name}`) : []),
        ...(state.focusItemCode === undefined ? [] : (0, text_1.tokens)(state.focusItemCode))
    ]);
    const soTenMon = new Set(itemNamedThisTurn ? [...tuTenMon].filter((t) => /^\d/.test(t)) : []);
    const soTuyChon = {
        cueThem, soTenMon,
        dangTraLoi: state.lastAskedSlot !== undefined && axes.some((a) => a.id === state.lastAskedSlot)
    };
    const soHopLe = new Set(soTranTrongCau(pack, normText, soTuyChon));
    /**
     * Gia tri truc cong cu DOAN ra trong luot nay (so tran + nhan kho). Du de tra loi luot
     * nay va de cong "con thieu o" khong bat nham, nhung KHONG duoc tron vao `slots` — vi
     * `slots` duoc luu sang luot sau, va gia tri doan bam dinh la bot "Con 3 doi size 42"
     * suot ba luot cho mot size khach chua tung noi.
     */
    const slotsDoan = {};
    for (const axis of axes) {
        // Doc CUNG chuoi voi `soHopLe`: mot ben doc cau tho, mot ben doc cau da qua bang tu
        // dong nghia, la phan quyet doi theo mot dong du lieu trong bang alias.
        const v = extractAxis(axis, normText);
        if (v === null)
            continue;
        // Gia tri THUAN SO phai qua cung mot cong voi so tran. Mau size cua ho so doc
        // "em chuyen 42.000d tien ship" thanh size 42, va gia tri do bi LUU sang cac luot
        // sau — bot "Con 3 doi size 42" mai cho mot size khach chua tung noi. Gia tri co
        // chu ("42 ruoi", "500mg", "42 2/3") thi mau cua ho so da tu chiu trach nhiem.
        if (/^\d+(?:[.,]\d+)?$/.test(v) && !soHopLe.has(Number(v.replace(",", ".")))) {
            // Tu choi gia tri moi thi phai GO ca gia tri ghim cua truc nay. Khong go thi "the 43
            // con khong" duoc tra loi bang size 42 cua luot truoc — mot con so DUNG cho mot cau
            // hoi KHAC, va khong cong nao bat duoc vi no co nguon that. Bay trong bay cach hoi
            // thuong ngay roi vao dung cho nay.
            delete slots[axis.id];
            continue;
        }
        slots[axis.id] = v;
        echoed.push(v);
        slotsThisTurn.add(axis.id);
    }
    const phone = /(?:^|\D)(0\d{9})(?:\D|$)/.exec(input.text.replace(/[.\s-]/g, ""))?.[1];
    if (phone !== undefined) {
        slots["phone"] = phone;
        echoed.push(phone);
    }
    // --- y dinh ---------------------------------------------------------------
    let intent = detectIntent(pack, input.text);
    const answeringPrevious = intent === null &&
        state.lastAskedSlot !== undefined &&
        (slots[state.lastAskedSlot] !== undefined
            || (state.lastAskedSlot === "item" && itemIdentified)
            || traLoiBangSo);
    if (answeringPrevious && state.lastIntentId !== undefined) {
        intent = pack.intents.find((i) => i.id === state.lastIntentId) ?? null;
    }
    // Khach CHI NEU TEN MON, khong co tu khoa nao: ho so quyet dinh do nghia la gi.
    // Khong co dong nay thi "shop oi co Adizero Boston 13 khong" chi duoc mot cau chao.
    // ...nhung CHI khi cau khong noi gi khac ngoai ten mon. "adizero boston 13 bi bong keo
    // roi shop" la khieu nai, "em nhan duoc adizero boston 13 roi cam on" la loi cam on —
    // tra loi bang bang ton kho la lac de, va moi cau nhu vay con cong mot lan hoi lai.
    // "Noi dung khac" = tu CHU nam ngoai ten mon. Mot con so ("650", "43") khong phai
    // noi dung khac — no la gia tri cua mot truc.
    const conGiNgoaiTenMon = specific.some((t) => /^\p{L}/u.test(t) && !tuTenMon.has(t));
    const yDinhMacDinh = pack.intentWhenItemNamed === undefined
        ? null : (pack.intents.find((i) => i.id === pack.intentWhenItemNamed) ?? null);
    if (intent === null && itemNamedThisTurn && !conGiNgoaiTenMon) {
        intent = yDinhMacDinh;
    }
    // Cau hoi tiep ve mon dang noi ma chi mang MOT gia tri truc ("loai 650 thi sao", "42"):
    // khong co tu khoa nao, nhung ro rang la hoi ve bien the do. Chi khi khong co noi dung
    // nao khac va cau co dung mot con so hoac mot gia tri truc rut ra duoc.
    if (intent === null && !itemNamedThisTurn && itemCode !== null && !conGiNgoaiTenMon
        && (slotsThisTurn.size > 0 || soTranTrongCau(pack, normText, soTuyChon).length === 1)) {
        intent = yDinhMacDinh;
    }
    // O "chu de" do chinh y dinh quyet dinh — khong co dong nay thi moi y dinh doi tra
    // deu thieu o vinh vien, va chinh sach lay duoc roi van khong toi duoc khach.
    if (intent?.requiredSlots.includes("topic") === true)
        slots["topic"] = intent.id;
    const brandNotCarried = itemIdentified
        ? null
        : pack.lexicon.knownBrandsNotCarried.find((b) => (0, text_1.mentionsBrand)(normText, b) && !pack.lexicon.brands.some((c) => (0, text_1.tight)(c) === (0, text_1.tight)(b))) ?? null;
    const catalogSize = await ports.catalog.size(input.tenant);
    // O mang du lieu phai gom ca ten truc do HO SO dat va o ho so tu khai, neu khong
    // cau thung kieu "Con 7 hop , gia ..." se duoc gui cho khach.
    const dataVars = new Set([...BASE_DATA_VARS, ...axes.map((a) => a.id)]);
    // --- o thay the -----------------------------------------------------------
    const vars = {
        khach: pack.identity.customerPronoun,
        shop: pack.identity.selfPronoun,
        mon: itemCode ?? "",
        hang: brandNotCarried ?? "",
        tinhtrang: "", ton: "", gia: "", giacao: "", kho: "", sokho: "", dsbienthe: "",
        chinhsach: "", madon: "", trangthai: "", conphaitra: "", songay: "", link: "",
        truc: axes[0]?.label ?? "",
        bienthe: axes[0] === undefined ? "" : (slots[axes[0].id] ?? ""),
        // O rieng cua ho so, gia tri do chinh ho so cap.
        ...(pack.extraValues ?? {})
    };
    for (const axis of axes) {
        vars[axis.id] = slots[axis.id] ?? "";
        vars[`nhan_${axis.id}`] = axis.label;
    }
    // --- goi cong cu ----------------------------------------------------------
    const facts = [];
    const toolText = [];
    let hasPolicySource = false;
    let answered = false;
    let toolFailed = false;
    let needAxis;
    const toolMissing = [];
    if (intent !== null && online) {
        for (const tool of intent.tools) {
            if (!available.has(tool) || !pack.allowedTools.includes(tool))
                continue;
            const run = DISPATCH[tool];
            if (run === undefined)
                continue;
            const out = await run({
                pack, ports, tenant: input.tenant, conversationId: input.conversationId,
                luotLuc: at,
                text: normText, slotsThisTurn, soTuyChon,
                itemCode, itemId, slots, state, vars, dataVars
            });
            facts.push(...out.facts);
            // Gia tri cong cu DOAN ra tu so tran + nhan kho: duoc phep nhac lai trong luot nay,
            // nhung KHONG luu sang luot sau. Luu la no bam dinh vinh vien: khach chua tung noi
            // size 42 ma ba luot sau bot van "Con 3 doi size 42", va vi da vao danh sach duoc
            // nhac lai nen cong chong bia so khong con soi no nua.
            if (out.slotsFound !== undefined) {
                for (const [k, v] of Object.entries(out.slotsFound)) {
                    slotsDoan[k] = v;
                    echoed.push(v);
                }
            }
            for (const k of out.slotsGo ?? [])
                delete slots[k];
            toolText.push(...out.facts.map((x) => x.text));
            Object.assign(vars, out.vars);
            if (out.answered)
                answered = true;
            if (out.hasPolicySource === true)
                hasPolicySource = true;
            if (out.failed === true || out.partial === true)
                toolFailed = true;
            if (out.needAxis !== undefined)
                needAxis = out.needAxis;
            if (out.missing !== undefined)
                toolMissing.push(...out.missing);
        }
    }
    // --- o con thieu ----------------------------------------------------------
    // Khach hoi ve mot HANG shop khong kinh doanh: cau tra loi dung la "ben em khong
    // co hang do", khong phai "cho em xin ten mau". Nen bo qua cac o cua y dinh.
    const intentForGates = brandNotCarried === null ? intent : null;
    const missing = intentForGates === null ? [] : intentForGates.requiredSlots.filter((s) => {
        if (s === "item")
            return !itemIdentified;
        return slots[s] === undefined && slotsDoan[s] === undefined;
    });
    if (needAxis !== undefined && !missing.includes(needAxis))
        missing.push(needAxis);
    // --- soan cau -------------------------------------------------------------
    let draft;
    if (!online) {
        draft = render(tpl(pack, "offline"), vars, dataVars);
    }
    else if (toolFailed) {
        draft = render(tpl(pack, "tool_failed") === "" ? tpl(pack, "handoff") : tpl(pack, "tool_failed"), vars, dataVars);
    }
    else if (brandNotCarried !== null) {
        draft = render(tpl(pack, "brand_not_carried"), vars, dataVars);
    }
    else if (intent === null) {
        draft = render(tpl(pack, "greeting"), vars, dataVars);
    }
    else if (answered && missing.length === 0) {
        draft = render(intent.template, vars, dataVars);
    }
    else {
        draft = render(intent.askBackTemplate, vars, dataVars);
    }
    // Mot cau con lo o thay the rong la cau hong — khong duoc gui cho khach.
    const brokenTemplate = draft.missing.length > 0 || toolMissing.length > 0;
    // Hoi nguoc khach: dung cho MOI duong, ke ca duong khong qua y dinh (hang khong
    // kinh doanh, muc luc qua nho). Neu chi tinh khi co y dinh thi se co vong lap
    // bot hoi mai mot cau ma cong `ask_back_once` khong bao gio bung.
    const brandRule = pack.gates.find((g) => g.kind === "brand_not_carried_needs_catalog");
    const brandBlocked = brandNotCarried !== null && brandRule !== undefined &&
        catalogSize < brandRule.minItems;
    const wouldAskBack = online && !toolFailed &&
        ((intentForGates !== null && (missing.length > 0 || !answered)) || brandBlocked);
    // --- cong an toan ---------------------------------------------------------
    // Ma san pham den tu muc luc — do la nguon that, khong phai bot bia ra.
    const allowedEchoes = [...new Set([...echoed, ...Object.values(slots), ...(itemCode === null ? [] : [itemCode])])];
    const gate = (0, gates_1.runGates)({
        pack, state, now, draft: draft.text, facts, intent: intentForGates,
        itemIdentified, wouldAskBack, online, catalogSize,
        claimsBrandNotCarried: brandNotCarried !== null,
        hasPolicySource, toolText,
        echoedValues: allowedEchoes
    });
    // Luot "khong hieu duoc": bot chi biet chao lai. Dem lai, den nguong thi goi
    // nguoi that — neu khong thi khach go "alo", "ok", "co ai khong" la bot lap
    // loi chao vo han. Day la duong hoi lai duy nhat khong qua y dinh.
    const luotTrong = online && intentForGates === null && brandNotCarried === null && !toolFailed;
    const demTrong = luotTrong ? (state.idleCount ?? 0) + 1 : 0;
    const QUA_NHIEU_LUOT_TRONG = 3;
    let action = "send";
    let reply = draft.text;
    let askedSlot;
    let replyMissing = [];
    if (state.handedOff === true || intent?.handoff === true || brokenTemplate ||
        demTrong >= QUA_NHIEU_LUOT_TRONG) {
        action = "handoff";
        reply = render(tpl(pack, "handoff"), vars).text;
        // Chi khoa phien khi that su giao viec cho nguoi — mau cau hong la loi cua minh,
        // khong phai ly do de bot cam ca phien voi khach.
        if (intent?.handoff === true || state.handedOff === true || demTrong >= QUA_NHIEU_LUOT_TRONG) {
            state = { ...state, handedOff: true };
        }
    }
    else if (gate.verdict.action === "ask_back" || (wouldAskBack && gate.verdict.action === "send")) {
        action = "ask_back";
        askedSlot = missing[0] ?? (itemIdentified ? undefined : "item");
        const axis = axes.find((a) => a.id === askedSlot);
        // Khach vua gui anh thi dung xin anh — nhung chi khi cai dang thieu la MON HANG.
        // Truoc day nhanh nay de len moi cau hoi lai, nen dang can so dien thoai
        // ma bot lai di hoi ma san pham.
        if (askedSlot === "item" || askedSlot === undefined) {
            // Khach vua gui anh thi hoi ten mau, khong xin anh lan nua — neu ho so co cau rieng.
            const key = (0, memory_1.hasRecentImageEvidence)(state, now) && tpl(pack, "ask_item_has_image") !== ""
                ? "ask_item_has_image"
                : "ask_item";
            const c1 = render(tpl(pack, key), vars, dataVars);
            reply = c1.text;
            replyMissing = c1.missing;
            askedSlot = "item";
        }
        else if (axis !== undefined) {
            const c2 = render(tpl(pack, "ask_slot"), { ...vars, truc: axis.label }, dataVars);
            reply = c2.text;
            replyMissing = c2.missing;
        }
        state = {
            ...state,
            lastAskBackAt: now.toISOString(),
            askBackCount: (state.askBackCount ?? 0) + 1
        };
    }
    else if (gate.verdict.action === "handoff") {
        action = "handoff";
        reply = render(tpl(pack, "handoff"), vars).text;
        state = { ...state, handedOff: true };
    }
    else if (gate.verdict.action === "block") {
        // Cau nay khong duoc gui, nhung chan mot cau KHONG co nghia la bo cuoc ca phien.
        action = "handoff";
        reply = render(tpl(pack, "handoff"), vars).text;
    }
    // SOI LAN HAI tren cau THAT SU GUI DI.
    // Cac nhanh tren thay `reply` bang mot cau khac SAU khi cong da phan, nen cau du
    // phong (`ask_item`, `ask_slot`, `handoff`) truoc day khong qua cong nao ca —
    // mot cum bi cam nam trong may cau do se di thang toi khach.
    const gate2 = reply === draft.text
        ? { verdict: { action: "send", reason: "" }, all: [] }
        : (0, gates_1.runGates)({
            pack, state, now, draft: reply, facts, intent: intentForGates,
            itemIdentified, wouldAskBack: false, online, catalogSize,
            claimsBrandNotCarried: brandNotCarried !== null,
            hasPolicySource, echoedValues: allowedEchoes
        });
    const cauDuPhongHong = gate2.verdict.action === "block" || gate2.verdict.action === "handoff";
    if (cauDuPhongHong || replyMissing.length > 0) {
        action = "handoff";
        const cuoi = render(tpl(pack, "handoff"), vars, dataVars);
        // Neu chinh cau chuyen nguoi that cung hong thi khong con gi de gui — im lang
        // va de nguoi that xu ly con hon gui mot cau sai. `validatePack` chan tu luc
        // dung ban de chuyen nay khong xay ra voi ho so hop le.
        reply = cuoi.missing.length > 0 || (0, gates_1.runGates)({
            pack, state, now, draft: cuoi.text, facts, intent: null,
            itemIdentified, wouldAskBack: false, online, catalogSize,
            claimsBrandNotCarried: false, hasPolicySource, echoedValues: allowedEchoes
        }).verdict.action !== "send" ? "" : cuoi.text;
    }
    // QUYET DINH 3: Xeon KHONG duoc luu du lieu ca nhan cua khach. So dien thoai duoc
    // dung trong luot nay de tra don, nhung phai che truoc khi ghi xuong. Luot sau can
    // lai thi hoi lai khach — cham hon mot nhip, doi lai giu dung dieu da hua voi shop.
    const { phone: _boPhone, ...slotsLuu } = slots;
    // Tra loi duoc mot luot thi bo dem hoi lai ve 0 — neu khong, mot lan hoi lai
    // khong duoc dap se khoa ca phien du sau do khach da noi du thong tin.
    const demHoiLai = action === "ask_back" ? (state.askBackCount ?? 0) : 0;
    state = {
        ...state,
        askBackCount: demHoiLai,
        // Bot da TRA LOI DUOC (cong cu co ket qua) thi lan hoi nguoc truoc coi nhu da xong:
        // xoa moc, de cau hoi tiep theo duoc phep hoi lai mot lan nua. Khong xoa thi "hoi ham
        // luong" -> "650" -> "con 4 hop 650mg" -> "the con hang khong" bi chuyen nguoi that
        // vi cong `ask_back_once` van nho lan hoi da duoc khach tra loi xong. Chi xoa khi
        // THAT SU tra loi duoc — mot cau chao suong khong tinh, khong thi vong "hoi -> alo ->
        // chao -> hoi" khong bao gio bung.
        lastAskBackAt: action === "send" && answered ? undefined : state.lastAskBackAt,
        idleCount: demTrong,
        // Tin cua KHACH luu voi noi dung RONG. Bo may khong doc lai noi dung do
        // (no chi dung moc gio va so anh), nen giu lam gi cho ro. Thu khong luu thi
        // khong can che — het luon chuyen dia chi, ten nguoi nhan khong che duoc.
        turns: state.turns.map((t) => (t.role === "customer" ? { ...t, text: "" } : t)),
        focusItemCode: itemCode ?? undefined,
        focusItemId: itemId ?? undefined,
        focusSlots: slotsLuu,
        lastIntentId: intent?.id ?? state.lastIntentId,
        lastAskedSlot: askedSlot
    };
    state = (0, memory_1.appendShopTurn)(state, { role: "shop", text: (0, contract_1.redactPII)(reply), at: now.toISOString() });
    // CHI quet phan do khach sinh ra. Quet ca trang thai la ma hoi thoai Messenger
    // (16 chu so) va ma hang EAN-13 bi coi la du lieu ca nhan, roi luot nao cung chet.
    // CHI truyen VAN BAN TU DO. Ma hoi thoai, ma hang, ma khach thue deu la day so
    // hop le — dua chung vao bo do la moi luot deu chet.
    (0, contract_1.assertNoStoredPII)([...state.turns.map((t) => t.text), ...Object.values(slotsLuu)]);
    await ports.memory.save(state);
    return {
        action, reply, intentId: intent?.id ?? null, itemCode, slots,
        facts, gates: gate.all, echoed: allowedEchoes, state
    };
}
//# sourceMappingURL=turn.js.map