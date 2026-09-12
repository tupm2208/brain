"use strict";
// BO LUAT NGANH: NHA THUOC.
//
// Bo luat nay ton tai de CHUNG MINH loi hua ban hang cua nen tang: doi nganh la doi
// ho so, khong dung vao bo may. No khac giay chay o ba cho co y:
//   - HAI truc bien the (ham luong + quy cach) thay vi mot
//   - mot cong an toan RIENG cua nganh (`forbidden_patterns`) chan tu van lieu dung
//   - mau cau va tu dien hoan toan khac
//
// Neu mot ngay nao do phai sua `engine/` de bo luat nay chay duoc, thi loi hua da thung.
Object.defineProperty(exports, "__esModule", { value: true });
exports.nhaThuocPack = void 0;
exports.nhaThuocPack = {
    id: "nha-thuoc",
    name: "Nha thuoc",
    identity: {
        customerPronoun: "anh chị",
        selfPronoun: "nhà thuốc",
        tone: ["Nói ngắn, chính xác.", "Không suy đoán về bệnh."],
        neverSay: [
            "thuốc này chữa khỏi hoàn toàn",
            "không có tác dụng phụ",
            "dùng thay thuốc kê đơn"
        ]
    },
    lexicon: {
        brands: ["traphaco", "dhg", "imexpharm", "stada", "sanofi", "gsk", "pymepharco"],
        knownBrandsNotCarried: ["bayer", "abbott"],
        categories: ["thuoc ho", "vitamin", "thuc pham chuc nang", "dung cu y te"],
        aliases: { parasetamol: "paracetamol", efe: "efferalgan" },
        // Tu dem cua cau hoi tiep. KHONG co "cam" (thuoc cam) va KHONG co "moi" (son moi
        // trong quay my pham) — chung la noi dung.
        fillerWords: ["thi", "sao", "hay", "hoac", "roi", "dang", "cung", "them", "nua",
            "luon", "chua", "het", "kia", "oke"],
        genericTerms: ["thuoc", "vien", "hop", "loai", "hang", "cai", "san pham", "kieu", "chai", "tuyp", "goi", "ong", "do"]
    },
    itemShape: {
        axes: [
            {
                id: "hamluong",
                label: "hàm lượng",
                pattern: "(?:^|[^a-z0-9])(\\d+(?:[.,]\\d+)?\\s*(?:mg|mcg|ml|g|ui))(?:[^a-z0-9]|$)",
                canonical: [
                    { pattern: "^(\\d+(?:[.,]\\d+)?)\\s*(mg|mcg|ml|g|ui)$", replace: "$1$2" },
                    { pattern: "^(\\d+),(\\d+)(mg|mcg|ml|g|ui)$", replace: "$1.$2$3" }
                ],
                examples: [
                    { text: "co paracetamol 500mg khong", expect: "500mg" },
                    { text: "loai 500 mg a", expect: "500 mg" },
                    { text: "vitamin d3 1000 ui", expect: "1000 ui" },
                    { text: "hop bao nhieu tien", expect: null }
                ],
                requiredForStock: true
            },
            {
                id: "quycach",
                label: "quy cách",
                pattern: "(?:^|[^a-z0-9])(\\d+\\s*(?:vien|goi|ong|chai|tuyp))(?:[^a-z0-9]|$)",
                canonical: [{ pattern: "^(\\d+)\\s*(vien|goi|ong|chai|tuyp)$", replace: "$1 $2" }],
                examples: [
                    { text: "hop 30 vien gia bao nhieu", expect: "30 vien" },
                    { text: "loai 10 goi a", expect: "10 goi" },
                    { text: "co paracetamol khong", expect: null }
                ],
                requiredForStock: false
            }
        ]
    },
    intents: [
        {
            id: "hoi_ton_kho",
            name: "Hoi con thuoc khong",
            keywords: ["con", "co", "het", "con khong", "co khong", "con hang"],
            patterns: ["\\bcon\\b.{0,40}\\b(khong|ko|k)\\b"],
            requiredSlots: ["item", "hamluong"],
            tools: ["stock.lookup"],
            template: "{tinhtrang}",
            askBackTemplate: "{khach} cho {shop} xin tên thuốc và {nhan_hamluong} với ạ.",
            examples: ["co paracetamol 500mg khong a"]
        },
        {
            id: "hoi_gia",
            name: "Hoi gia",
            keywords: ["gia", "bao nhieu", "nhieu tien"],
            requiredSlots: ["item"],
            tools: ["stock.lookup"],
            template: "{tinhtrang}",
            askBackTemplate: "{khach} cho {shop} xin tên thuốc ạ.",
            examples: ["thuoc nay gia bao nhieu"]
        },
        {
            id: "hoi_lieu_dung",
            name: "Hoi lieu dung — phai chuyen duoc si",
            keywords: ["uong may vien", "lieu dung", "uong the nao", "ngay may lan", "uong bao lau"],
            requiredSlots: ["topic"],
            tools: [],
            template: "{chinhsach}",
            askBackTemplate: "{khach} chờ {shop} chuyển dược sĩ tư vấn trực tiếp ạ.",
            examples: ["thuoc nay uong may vien mot ngay"],
            // Bo may khong biet gi ve nganh duoc; ho so noi ro cau nay khong duoc tu tra loi.
            handoff: true
        }
    ],
    // Khach chi neu ten mon: hieu la hoi con hang khong.
    intentWhenItemNamed: "hoi_ton_kho",
    allowedTools: ["catalog.search", "stock.lookup", "policy.get", "customer.recognize"],
    gates: [
        { kind: "no_facts_when_offline" },
        { kind: "require_item_before_stock" },
        { kind: "ask_back_once", windowMinutes: 30 },
        { kind: "no_unsourced_numbers" },
        { kind: "brand_not_carried_needs_catalog", minItems: 100 },
        { kind: "forbidden_phrases" },
        {
            // Cong RIENG cua nganh duoc — bo may khong biet gi ve chuyen nay,
            // no chi chay mau regex ho so khai.
            kind: "forbidden_patterns",
            patterns: [
                "(uống|dùng)\\s+\\d+\\s*(viên|gói|ml|lần)",
                "ngày\\s+\\d+\\s*lần",
                "liều (dùng|lượng)"
            ],
            reason: "Khong duoc tu van lieu dung qua khung chat — phai chuyen duoc si."
        }
    ],
    templates: {
        greeting: "Dạ {shop} nghe {khach} ạ.",
        ask_item: "{khach} cho {shop} xin tên thuốc hoặc ảnh vỏ hộp ạ.",
        ask_slot: "{khach} cho {shop} xin {truc} ạ.",
        handoff: "{shop} chuyển dược sĩ trả lời {khach} ngay ạ.",
        offline: "{shop} đang kiểm lại hàng, {shop} nhắn lại {khach} ngay ạ.",
        brand_not_carried: "Dạ {shop} không có hàng {hang} ạ.",
        out_of_stock: "Hiện {shop} hết {nhan_hamluong} này rồi ạ.",
        in_stock: "Còn {ton} hộp {hamluong}, giá {gia} ạ.",
        in_stock_range: "Còn {ton} hộp {hamluong}, giá từ {gia} đến {giacao} ạ.",
        tool_failed: "{shop} chưa tra được kho lúc này, {shop} nhắn lại {khach} ngay ạ."
    }
};
//# sourceMappingURL=index.js.map