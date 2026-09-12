"use strict";
// BA MANG, MUOI BA MANH — anh Dung chot 09/09/2026.
//
// Manh nao bat thi bot thong minh them bay nhieu: moi manh mo them cong cu cho bot.
// Ba manh loi luon bat, khong ban roi. Tran tu dat: 15 manh.
//
// LUU Y quan trong ve gioi han cua ham kiem tra o cuoi tep: no doc BANG KHAI BAO
// (`dependsOn`), khong doc `import` that trong ma. Nghia la no chi bat duoc nguoi
// TRUNG THUC khai bao viec minh vua pha luat. Khi co `packages/omi`, phai them mot
// bai kiem tra doc `import` that va doi chieu — khong co buoc do thi luat so 1 van
// chi nam mot nua trong tai lieu. (Agent phan bien chi ra 09/09.)
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULE_CEILING = exports.CORE_MODULE_IDS = exports.MODULE_IDS = exports.MODULES = exports.GROUP_LABELS = exports.MODULE_GROUPS = void 0;
exports.isModuleId = isModuleId;
exports.modulesOfGroup = modulesOfGroup;
exports.assertModuleGraph = assertModuleGraph;
const events_1 = require("./events");
const tools_1 = require("./tools");
exports.MODULE_GROUPS = ["vanhanh", "content", "chatbot"];
exports.GROUP_LABELS = {
    vanhanh: "Van hanh ban hang",
    content: "Content",
    chatbot: "Chatbot"
};
exports.MODULES = {
    // ---------------------------------------------------------------- Van hanh
    "hang-kho": {
        id: "hang-kho", group: "vanhanh", name: "Hang hoa & kho", runsOn: "omi", core: true,
        tools: ["catalog.search", "stock.lookup", "variant.chart"],
        emits: ["stock.changed"], listens: [], dependsOn: []
    },
    "don-khach": {
        id: "don-khach", group: "vanhanh", name: "Don hang & khach", runsOn: "omi", core: true,
        tools: ["order.lookup", "order.draft", "policy.get", "customer.recognize"],
        emits: ["order.created", "order.status_changed", "order.cancelled", "order.paid"],
        listens: [], dependsOn: ["hang-kho"]
    },
    "lien-ket": {
        id: "lien-ket", group: "vanhanh", name: "Lien ket tai khoan", runsOn: "omi", core: true,
        tools: [],
        emits: ["link.session_expired"], listens: [], dependsOn: []
    },
    "van-chuyen": {
        id: "van-chuyen", group: "vanhanh", name: "Van chuyen", runsOn: "omi", core: false,
        tools: ["shipment.track"],
        emits: ["shipment.created"], listens: ["order.status_changed"],
        dependsOn: ["don-khach"]
    },
    tien: {
        id: "tien", group: "vanhanh", name: "Tien & doi soat", runsOn: "omi", core: false,
        tools: ["payment.status", "order.approve"],
        emits: [],
        // Nghe `partner.out_of_stock` vi chuoi hoan tien bat dau tu day — truoc do su kien
        // nay khong ai nghe, tuc la chuoi dut ngay mat dau tien.
        listens: ["order.paid", "order.cancelled", "partner.out_of_stock"],
        dependsOn: ["don-khach"]
    },
    "mua-ho": {
        id: "mua-ho", group: "vanhanh", name: "Mua ho & dat tu dong", runsOn: "omi", core: false,
        tools: ["purchase.eta"],
        emits: ["partner.out_of_stock"], listens: ["order.paid"],
        dependsOn: ["don-khach", "hang-kho"]
    },
    "gian-hang": {
        id: "gian-hang", group: "vanhanh", name: "Gian hang & cong tac vien", runsOn: "omi", core: false,
        tools: ["storefront.link"],
        emits: ["order.created"], listens: ["stock.changed", "order.paid"],
        dependsOn: ["hang-kho", "don-khach"]
    },
    // ---------------------------------------------------------------- Content
    "xuong-noi-dung": {
        id: "xuong-noi-dung", group: "content", name: "Xuong noi dung", runsOn: "omi", core: false,
        tools: [], emits: [], listens: ["stock.changed"], dependsOn: ["hang-kho"]
    },
    "xuong-video": {
        id: "xuong-video", group: "content", name: "Xuong video", runsOn: "omi", core: false,
        tools: [], emits: [], listens: [], dependsOn: ["hang-kho"]
    },
    "goi-noi-dung": {
        id: "goi-noi-dung", group: "content", name: "Goi noi dung theo thang", runsOn: "xeon", core: false,
        // Chay tren Xeon nen KHONG duoc phu thuoc ma nguon vao manh o may khach.
        // Du lieu hang hoa toi day qua muc luc va qua duong noi.
        tools: [], emits: [], listens: ["stock.changed"], dependsOn: []
    },
    // ---------------------------------------------------------------- Chatbot
    "hop-thu": {
        id: "hop-thu", group: "chatbot", name: "Hop thu da kenh", runsOn: "omi", core: false,
        tools: [], emits: [], listens: ["bot.handoff"], dependsOn: ["don-khach"]
    },
    "chatbot-cskh": {
        id: "chatbot-cskh", group: "chatbot", name: "Chatbot cham soc khach", runsOn: "xeon", core: false,
        // Bot chi tao don NHAP nen KHONG phat `order.created` — don that do nguoi duyet.
        tools: [], emits: ["bot.handoff"], listens: ["stock.changed"], dependsOn: []
    },
    "nhu-cau-cho": {
        id: "nhu-cau-cho", group: "chatbot", name: "Nhu cau cho & bao cao", runsOn: "xeon", core: false,
        tools: [], emits: [], listens: ["stock.changed", "order.created"], dependsOn: []
    }
};
exports.MODULE_IDS = Object.keys(exports.MODULES);
exports.CORE_MODULE_IDS = exports.MODULE_IDS.filter((id) => exports.MODULES[id].core);
/** Tran tu dat: tong so manh. Nhieu hon thi khach khong chon noi, minh khong va noi. */
exports.MODULE_CEILING = 15;
function isModuleId(v) {
    return typeof v === "string" && Object.prototype.hasOwnProperty.call(exports.MODULES, v);
}
function modulesOfGroup(group) {
    return exports.MODULE_IDS.map((id) => exports.MODULES[id]).filter((m) => m.group === group);
}
/** Do chu trinh trong do thi `dependsOn`. Tra ve duong di dau tien tim duoc, hoac rong. */
function findCycle() {
    const state = new Map();
    const stack = [];
    let found = [];
    const walk = (id) => {
        state.set(id, 1);
        stack.push(id);
        for (const dep of exports.MODULES[id].dependsOn) {
            if (!isModuleId(dep))
                continue;
            const st = state.get(dep) ?? 0;
            if (st === 1) {
                const from = stack.indexOf(dep);
                found = [...stack.slice(from >= 0 ? from : 0), dep];
                return true;
            }
            if (st === 0 && walk(dep))
                return true;
        }
        stack.pop();
        state.set(id, 2);
        return false;
    };
    for (const id of exports.MODULE_IDS) {
        if ((state.get(id) ?? 0) === 0 && walk(id))
            return found;
    }
    return [];
}
/**
 * MAY TU KIEM — chay luc dung ban va luc khoi dong, khong doi nguoi phat hien.
 *
 * Cai bay so 2 trong ban dac ta: "mot hom ai do cho manh nay goi thang manh kia cho nhanh,
 * tu do khong thao roi duoc nua". Ham nay lam cho viec do gay ngay lap tuc.
 */
function assertModuleGraph() {
    const problems = [];
    if (exports.MODULE_IDS.length > exports.MODULE_CEILING) {
        problems.push(`Dang co ${exports.MODULE_IDS.length} manh, vuot tran ${exports.MODULE_CEILING}. ` +
            `Muon them manh moi thi phai gop hai manh cu lai.`);
    }
    for (const id of exports.MODULE_IDS) {
        const m = exports.MODULES[id];
        if (m.id !== id)
            problems.push(`Manh "${id}" khai id lech: "${m.id}".`);
        // --- phu thuoc ma nguon ---
        for (const dep of m.dependsOn) {
            if (!isModuleId(dep)) {
                problems.push(`Manh "${id}" phu thuoc vao manh khong ton tai: "${dep}".`);
                continue;
            }
            if (dep === id) {
                problems.push(`Manh "${id}" phu thuoc chinh no.`);
                continue;
            }
            if (!exports.MODULES[dep].core) {
                problems.push(`Manh "${id}" phu thuoc thang vao "${dep}" — ma "${dep}" khong phai manh loi. ` +
                    `Hai manh ngang hang phai noi nhau qua bang tin su kien.`);
            }
            if (exports.MODULES[dep].runsOn !== m.runsOn) {
                problems.push(`Manh "${id}" (${m.runsOn}) phu thuoc ma nguon vao "${dep}" (${exports.MODULES[dep].runsOn}). ` +
                    `Hai may khac nhau chi noi duoc qua duong day, ma duong day thi dut duoc bat cu luc nao.`);
            }
        }
        // --- cong cu: hai chieu, tranh hai nguon su that ---
        for (const t of m.tools) {
            if (tools_1.TOOLS[t] === undefined) {
                problems.push(`Manh "${id}" khai cong cu khong ton tai: "${t}".`);
            }
            else if (tools_1.TOOLS[t].module !== id) {
                problems.push(`Manh "${id}" khai cong cu "${t}", nhung so dang ky noi cong cu do thuoc "${tools_1.TOOLS[t].module}".`);
            }
        }
    }
    // --- cong cu mo coi: co trong so dang ky ma manh chu khong khai ---
    for (const name of Object.keys(tools_1.TOOLS)) {
        const owner = tools_1.TOOLS[name].module;
        if (!exports.MODULES[owner].tools.includes(name)) {
            problems.push(`Cong cu "${name}" khai thuoc manh "${owner}" nhung manh do khong liet ke no.`);
        }
    }
    // --- chu trinh ---
    const cycle = findCycle();
    if (cycle.length > 0) {
        problems.push(`Vong tron phu thuoc: ${cycle.join(" -> ")}. Hai manh khoa nhau thi khong tach roi duoc nua.`);
    }
    // --- su kien: phat ma khong ai nghe, hoac nghe ma khong ai phat ---
    const emitted = new Set();
    const listened = new Set();
    for (const id of exports.MODULE_IDS) {
        exports.MODULES[id].emits.forEach((e) => emitted.add(e));
        exports.MODULES[id].listens.forEach((e) => listened.add(e));
    }
    for (const e of emitted) {
        if (!listened.has(e) && events_1.EXTERNALLY_CONSUMED_EVENTS[e] === undefined) {
            problems.push(`Su kien "${e}" duoc phat nhung khong manh nao nghe, va cung khong khai la ` +
                `duoc tieu thu ben ngoai. Hoac no thua, hoac mot chuoi xu ly dang dut.`);
        }
    }
    for (const e of listened) {
        if (!emitted.has(e)) {
            problems.push(`Su kien "${e}" co manh nghe nhung khong manh nao phat.`);
        }
    }
    if (problems.length > 0) {
        throw new Error("Do thi manh sai:\n- " + problems.join("\n- "));
    }
}
//# sourceMappingURL=modules.js.map