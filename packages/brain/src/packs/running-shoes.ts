/**
 * @file Industry pack: RUNNING SHOES, converted from the legacy TopRun rules into a profile.
 *
 * Everything here is DATA, not code. The shop owner can edit it without a developer.
 * For comparison: the same rules in the legacy system were spread across ai_router.js (289 KB).
 *
 * The pack id "giay-chay" is part of the wire protocol (licences carry it) and stays as is.
 */

import type { IndustryPack } from "../pack/types";

export const runningShoesPack: IndustryPack = {
  id: "giay-chay",
  name: "Giay chay & do the thao",

  identity: {
    customerPronoun: "bác",
    selfPronoun: "em",
    tone: [
      "Nói ngắn, đi thẳng vào việc.",
      "Không kể lể, không dùng khung 'Em hỏi lại...' hay 'lựa chọn hợp lý'.",
      "Mỗi món tối đa hai ba câu."
    ],
    neverSay: [
      "bảo hành trọn đời",
      "bảo hành vĩnh viễn",
      "cam kết chính hãng 100%",
      "rẻ nhất thị trường",
      "rẻ nhất trên thị trường",
      "ship toàn quốc miễn phí"
    ]
  },

  lexicon: {
    brands: ["adidas", "asics", "nike", "hoka", "puma", "mizuno", "columbia", "wilson"],
    knownBrandsNotCarried: ["salomon", "brooks", "new balance", "saucony", "skechers", "converse", "vans"],
    categories: ["giay chay", "giay tap", "giay san", "dep", "ao gio", "tat", "quan chay"],
    aliases: {
      newbalance: "new balance",
      niubalan: "new balance",
      adidat: "adidas",
      atics: "asics",
      hocka: "hoka",
      bostom: "boston"
    },
    // Filler words of follow-up questions. NO colour names ("den", "trang", "vang", "cam",
    // "lam") and NOT "day" (shoelace): those are content.
    // NOT "moi": "giay moi" (loafers) is a real product.
    fillerWords: ["thi", "sao", "hay", "hoac", "roi", "dang", "cung", "them", "nua",
      "luon", "chua", "het", "kia", "oke"],
    // "doi", "mau", "kieu" must be generic: customers say "doi nay con 43 khong"; treating those
    // as specific words sends the engine to the catalog, finds nothing, DROPS the focus and asks
    // for the product code the customer named one turn earlier.
    genericTerms: ["giay", "dep", "ao", "quan", "tat", "do the thao", "hang", "doi", "mau", "kieu", "cai", "san pham"]
  },

  itemShape: {
    axes: [
      {
        id: "size",
        label: "size",
        // VN shoe sizes 35-52, with half sizes ("42.5", "42 ruoi") and adidas thirds ("42 2/3").
        // The `(?!...)` part stops QUANTITIES and other units from being read as a size:
        // "shop con 40 doi", "em nang 50 kg", "bao hanh 36 thang", "gia 45k".
        pattern:
          "(?:^|[^0-9])((?:3[5-9]|4[0-9]|5[0-2])(?:[.,]5|\\s+ruoi|\\s+[12]\\s*/\\s*3)?)" +
          // `(?![a-z])` is mandatory: without it the unit "k" also matches the "k" of "khong",
          // and "42.5 khong" is read as size 42.
          "(?!\\s*(?:doi|cai|chiec|hop|thang|tuan|ngay|kg|k|nghin|ngan|trieu|tr)(?![a-z]))(?:[^0-9]|$)",
        canonical: [
          { pattern: "^(\\d+)\\s+ruoi$", replace: "$1.5" },
          { pattern: "^(\\d+),5$", replace: "$1.5" },
          { pattern: "^(\\d+)\\s+([12])\\s*/\\s*3$", replace: "$1 $2/3" }
        ],
        examples: [
          { text: "cho em hoi size 42 con khong", expect: "42" },
          { text: "doi nay con 42.5 khong shop", expect: "42.5" },
          { text: "em di 41 ruoi", expect: "41 ruoi" },
          { text: "size 42 2/3 con hang khong", expect: "42 2/3" },
          { text: "hom nay shop co ban tat khong", expect: null },
          { text: "gia bao nhieu vay shop", expect: null },
          { text: "shop con 40 doi loai nay khong", expect: null },
          { text: "em nang 50 kg cao 1m70 nen di size nao", expect: null },
          { text: "bao hanh 36 thang a", expect: null },
          { text: "gia 45k ship a", expect: null }
        ],
        requiredForStock: true
      }
    ]
  },

  intents: [
    {
      id: "hoi_ton_kho",
      name: "Hoi con hang khong",
      keywords: ["con hang", "het", "size", "co san", "con khong", "co khong"],
      patterns: ["\\bcon\\b.{0,40}\\b(khong|ko|k)\\b", "\\bsize\\b"],
      negativeKeywords: ["doi tra", "doi size", "tra hang", "bao hanh"],
      requiredSlots: ["item", "size"],
      tools: ["stock.lookup"],
      template: "{tinhtrang}",
      askBackTemplate: "{khach} cho {shop} xin mã hoặc tên mẫu với ạ, {shop} tra đúng {truc} cho {khach} ngay.",
      examples: ["con size 42 khong shop", "mau nay con hang khong a"]
    },
    {
      id: "hoi_gia",
      name: "Hoi gia",
      keywords: ["gia", "bao nhieu", "nhieu tien"],
      requiredSlots: ["item"],
      tools: ["stock.lookup"],
      template: "{tinhtrang}",
      askBackTemplate: "{khach} cho {shop} xin mã hoặc tên mẫu, {shop} báo giá đúng mẫu đó ạ.",
      examples: ["doi nay gia bao nhieu"]
    },
    {
      id: "tra_don",
      name: "Tra don hang",
      keywords: ["don hang", "van don", "toi dau", "khi nao nhan", "ship den dau", "don cua em"],
      requiredSlots: ["phone"],
      tools: ["order.lookup"],
      template: "Đơn {madon} đang {trangthai} ạ.",
      askBackTemplate: "{khach} cho {shop} xin số điện thoại đặt hàng để {shop} tra đơn ạ.",
      examples: ["don hang cua em toi dau roi"]
    },
    {
      id: "doi_tra",
      name: "Doi tra, bao hanh",
      // NOT the bare word "doi": in Vietnamese "doi" is also the counter for a pair of shoes,
      // so "doi nay dep qua" would read as an exchange request.
      keywords: ["doi tra", "doi size", "tra hang", "bao hanh", "khong vua", "doi hang"],
      // This pattern lets "doi + (size|hang|tra)" beat the stock intent outright, because
      // "shop cho doi size khong a" also contains "size" and the two intents tie otherwise.
      patterns: ["\\bdoi\\s+(size|hang|tra)\\b"],
      requiredSlots: ["topic"],
      tools: ["policy.get"],
      template: "{chinhsach}",
      askBackTemplate: "{khach} cho {shop} biết {khach} muốn đổi hay trả, và mua cách đây bao lâu ạ.",
      examples: ["shop cho doi size khong a", "hang bao hanh the nao"]
    }
  ],

  // A customer who only names an item is asking whether it is in stock.
  intentWhenItemNamed: "hoi_ton_kho",

  allowedTools: [
    "catalog.search", "stock.lookup", "variant.chart",
    "order.lookup", "policy.get", "storefront.link", "customer.recognize", "purchase.eta"
  ],

  gates: [
    { kind: "no_facts_when_offline" },
    { kind: "require_item_before_stock" },
    { kind: "ask_back_once", windowMinutes: 30 },
    { kind: "no_unsourced_numbers" },
    // Below 200 items the catalog does not represent the whole shop yet.
    { kind: "brand_not_carried_needs_catalog", minItems: 200 },
    {
      kind: "require_source_for_claims",
      topics: ["đổi trả", "bảo hành", "phí ship", "hoàn tiền"],
      // Catches other phrasings too: "doi size thoai mai", "khong phai tra them dong nao".
      patterns: [
        "đổi\\s+(size|hàng|trả)",
        "(miễn phí|không (phải )?trả thêm|không mất phí)",
        "trong (vòng )?\\d+\\s*(ngày|tuần|tháng)"
      ]
    },
    { kind: "forbidden_phrases" }
  ],

  templates: {
    greeting: "Dạ {shop} nghe {khach} ạ.",
    ask_item: "{khach} cho {shop} xin mã hoặc tên mẫu với ạ.",
    ask_slot: "{khach} cho {shop} xin {truc} với ạ.",
    handoff: "{shop} nhờ nhân viên kiểm lại rồi trả lời {khach} ngay ạ.",
    offline: "{shop} đang kiểm lại hàng, {shop} nhắn lại {khach} ngay ạ.",
    brand_not_carried: "Dạ {shop} chưa kinh doanh hàng {hang} ạ.",
    out_of_stock: "Mẫu này hiện {shop} hết {truc} {khach} hỏi rồi ạ.",
    in_stock: "Còn {ton} đôi {truc} {size}, giá {gia} ạ.",
    in_stock_range: "Còn {ton} đôi {truc} {size}, giá từ {gia} đến {giacao} ạ.",
    tool_failed: "{shop} chưa tra được kho lúc này, {shop} kiểm rồi nhắn lại {khach} ngay ạ.",
    ask_item_has_image: "{shop} xem ảnh rồi ạ, {khach} cho {shop} xin tên mẫu hoặc mã trên tem với ạ."
  }
};
