/**
 * @file Three groups, thirteen modules (decided 09/09/2026).
 *
 * Every enabled module makes the bot a little smarter, because every module opens tools to it.
 * The three core modules are always on and are not sold separately. Hard ceiling: 15 modules.
 *
 * An important limit of `assertModuleGraph`: it reads the DECLARATION (`dependsOn`), not the
 * real `import`s in the code, so it only catches people HONEST enough to declare the dependency
 * they just introduced. A second test reading real imports must accompany it in the console
 * package; without it rule 1 is only half enforced. (Review, 09/09.)
 */

import { EXTERNALLY_CONSUMED_EVENTS, type EventName } from "./events";
import { TOOLS, type ToolName } from "./tools";

export const MODULE_GROUPS = ["vanhanh", "content", "chatbot"] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

export const GROUP_LABELS: Record<ModuleGroup, string> = {
  vanhanh: "Vận hành bán hàng",
  content: "Content",
  chatbot: "Chatbot"
};

/** Module ids are part of the wire protocol (licence keys list them); they stay in Vietnamese. */
export type ModuleId =
  | "hang-kho"
  | "don-khach"
  | "lien-ket"
  | "van-chuyen"
  | "tien"
  | "mua-ho"
  | "gian-hang"
  | "xuong-noi-dung"
  | "xuong-video"
  | "goi-noi-dung"
  | "hop-thu"
  | "chatbot-cskh"
  | "nhu-cau-cho";

export interface ModuleDef {
  id: ModuleId;
  group: ModuleGroup;
  /** Display name, shown to the licence administrator. */
  name: string;
  /** Runs on the merchant's machine or on our Xeon. */
  runsOn: "omi" | "xeon";
  /** Core module: always on, not sold separately, and the only kind others may depend on. */
  core: boolean;
  /** Tools this module opens. */
  tools: ToolName[];
  emits: EventName[];
  /** Events it listens to, from either side; events cross the link when machines differ. */
  listens: EventName[];
  /**
   * SOURCE-LEVEL dependencies. Only core modules on the SAME machine are allowed: a module on
   * Xeon cannot depend on one on the merchant's machine, because between them there is only a
   * link, and a link can drop at any moment.
   */
  dependsOn: ModuleId[];
}

export const MODULES: { readonly [K in ModuleId]: ModuleDef } = {
  // ---------------------------------------------------------------- Operations
  "hang-kho": {
    id: "hang-kho", group: "vanhanh", name: "Hàng hoá & kho", runsOn: "omi", core: true,
    tools: ["catalog.search", "stock.lookup", "variant.chart", "catalog.find"],
    emits: ["stock.changed"], listens: [], dependsOn: []
  },
  "don-khach": {
    id: "don-khach", group: "vanhanh", name: "Đơn hàng & khách", runsOn: "omi", core: true,
    tools: ["order.lookup", "order.draft", "policy.get", "customer.recognize", "shop.bankAccount"],
    emits: ["order.created", "order.status_changed", "order.cancelled", "order.paid"],
    listens: [], dependsOn: ["hang-kho"]
  },
  "lien-ket": {
    id: "lien-ket", group: "vanhanh", name: "Liên kết tài khoản", runsOn: "omi", core: true,
    tools: [],
    emits: ["link.session_expired"], listens: [], dependsOn: []
  },
  "van-chuyen": {
    id: "van-chuyen", group: "vanhanh", name: "Vận chuyển", runsOn: "omi", core: false,
    tools: ["shipment.track"],
    emits: ["shipment.created"], listens: ["order.status_changed"],
    dependsOn: ["don-khach"]
  },
  tien: {
    id: "tien", group: "vanhanh", name: "Tiền & đối soát", runsOn: "omi", core: false,
    tools: ["payment.status", "order.approve"],
    emits: [],
    // Listens to `partner.out_of_stock` because the refund chain starts there; before this was
    // added, nobody listened and the chain was broken at its first link.
    listens: ["order.paid", "order.cancelled", "partner.out_of_stock"],
    dependsOn: ["don-khach"]
  },
  "mua-ho": {
    id: "mua-ho", group: "vanhanh", name: "Mua hộ & đặt tự động", runsOn: "omi", core: false,
    tools: ["purchase.eta"],
    emits: ["partner.out_of_stock"], listens: ["order.paid"],
    dependsOn: ["don-khach", "hang-kho"]
  },
  "gian-hang": {
    id: "gian-hang", group: "vanhanh", name: "Gian hàng & cộng tác viên", runsOn: "omi", core: false,
    tools: ["storefront.link"],
    emits: ["order.created"], listens: ["stock.changed", "order.paid"],
    dependsOn: ["hang-kho", "don-khach"]
  },

  // ---------------------------------------------------------------- Content
  "xuong-noi-dung": {
    id: "xuong-noi-dung", group: "content", name: "Xưởng nội dung", runsOn: "omi", core: false,
    tools: [], emits: [], listens: ["stock.changed"], dependsOn: ["hang-kho"]
  },
  "xuong-video": {
    id: "xuong-video", group: "content", name: "Xưởng video", runsOn: "omi", core: false,
    tools: [], emits: [], listens: [], dependsOn: ["hang-kho"]
  },
  "goi-noi-dung": {
    id: "goi-noi-dung", group: "content", name: "Gói nội dung theo tháng", runsOn: "xeon", core: false,
    // Runs on Xeon, so it must NOT depend on source code of a module on the merchant's machine.
    // Product data reaches it through the catalog and the link.
    tools: [], emits: [], listens: ["stock.changed"], dependsOn: []
  },

  // ---------------------------------------------------------------- Chatbot
  "hop-thu": {
    id: "hop-thu", group: "chatbot", name: "Hộp thư đa kênh", runsOn: "omi", core: false,
    tools: ["conversation.recent", "training.knowledge"], emits: [], listens: ["bot.handoff"], dependsOn: ["don-khach"]
  },
  "chatbot-cskh": {
    id: "chatbot-cskh", group: "chatbot", name: "Chatbot chăm sóc khách", runsOn: "xeon", core: false,
    // The bot only creates DRAFT orders, so it does not emit `order.created`; real orders are approved by humans.
    tools: [], emits: ["bot.handoff"], listens: ["stock.changed"], dependsOn: []
  },
  "nhu-cau-cho": {
    id: "nhu-cau-cho", group: "chatbot", name: "Nhu cầu chờ & báo cáo", runsOn: "xeon", core: false,
    tools: [], emits: [], listens: ["stock.changed", "order.created"], dependsOn: []
  }
};

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];
export const CORE_MODULE_IDS: ModuleId[] = MODULE_IDS.filter((id) => MODULES[id].core);
/** Self-imposed ceiling. More than this and customers cannot choose, nor can we maintain. */
export const MODULE_CEILING = 15;

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MODULES, value);
}

export function modulesOfGroup(group: ModuleGroup): ModuleDef[] {
  return MODULE_IDS.map((id) => MODULES[id]).filter((m) => m.group === group);
}

/** Finds a cycle in the `dependsOn` graph. Returns the first path found, or an empty array. */
function findCycle(): ModuleId[] {
  const state = new Map<ModuleId, 0 | 1 | 2>();
  const stack: ModuleId[] = [];
  let found: ModuleId[] = [];

  const walk = (id: ModuleId): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of MODULES[id].dependsOn) {
      if (!isModuleId(dep)) continue;
      const st = state.get(dep) ?? 0;
      if (st === 1) {
        const from = stack.indexOf(dep);
        found = [...stack.slice(from >= 0 ? from : 0), dep];
        return true;
      }
      if (st === 0 && walk(dep)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };

  for (const id of MODULE_IDS) {
    if ((state.get(id) ?? 0) === 0 && walk(id)) return found;
  }
  return [];
}

/**
 * SELF-CHECK of the module graph, run at build time and at start-up rather than waiting for a
 * person to notice.
 *
 * Trap number 2 of the specification: "one day somebody lets module A call module B directly
 * because it is quicker, and from then on they can never be separated again". This function
 * makes that break immediately.
 */
export function assertModuleGraph(): void {
  const problems: string[] = [];

  if (MODULE_IDS.length > MODULE_CEILING) {
    problems.push(
      `There are ${MODULE_IDS.length} modules, above the ceiling of ${MODULE_CEILING}. ` +
        `To add one, merge two existing modules first.`
    );
  }

  for (const id of MODULE_IDS) {
    const m = MODULES[id];
    if (m.id !== id) problems.push(`Module "${id}" declares a different id: "${m.id}".`);

    // --- source dependencies ---
    for (const dep of m.dependsOn) {
      if (!isModuleId(dep)) {
        problems.push(`Module "${id}" depends on a module that does not exist: "${dep}".`);
        continue;
      }
      if (dep === id) {
        problems.push(`Module "${id}" depends on itself.`);
        continue;
      }
      if (!MODULES[dep].core) {
        problems.push(
          `Module "${id}" depends directly on "${dep}", which is not a core module (khong phai manh loi). ` +
            `Peer modules must talk through the event board.`
        );
      }
      if (MODULES[dep].runsOn !== m.runsOn) {
        problems.push(
          `Module "${id}" (${m.runsOn}) has a source dependency on "${dep}" (${MODULES[dep].runsOn}). ` +
            `Two different machines (hai may khac nhau) can only talk over the link, and a link can drop at any time.`
        );
      }
    }

    // --- tools: both directions, so there is no second source of truth ---
    for (const t of m.tools) {
      if (TOOLS[t] === undefined) {
        problems.push(`Module "${id}" declares a tool that does not exist: "${t}".`);
      } else if (TOOLS[t].module !== id) {
        problems.push(
          `Module "${id}" declares tool "${t}", but the registry says that tool belongs to (so dang ky noi cong cu do thuoc) "${TOOLS[t].module}".`
        );
      }
    }
  }

  // --- orphan tools: in the registry but not listed by the owning module ---
  for (const name of Object.keys(TOOLS) as ToolName[]) {
    const owner = TOOLS[name].module;
    if (!MODULES[owner].tools.includes(name)) {
      problems.push(`Tool "${name}" claims to belong to module "${owner}" but that module does not list it.`);
    }
  }

  // --- cycles ---
  const cycle = findCycle();
  if (cycle.length > 0) {
    problems.push(
      `Dependency cycle (Vong tron phu thuoc): ${cycle.join(" -> ")}. Two modules locked together can never be separated.`
    );
  }

  // --- events: emitted with no listener, or listened to with no emitter ---
  const emitted = new Set<EventName>();
  const listened = new Set<EventName>();
  for (const id of MODULE_IDS) {
    MODULES[id].emits.forEach((e) => emitted.add(e));
    MODULES[id].listens.forEach((e) => listened.add(e));
  }
  for (const e of emitted) {
    if (!listened.has(e) && EXTERNALLY_CONSUMED_EVENTS[e] === undefined) {
      problems.push(
        `Event "${e}" is emitted but no module listens, and it is not declared as consumed externally. ` +
          `Either it is redundant or a processing chain is broken.`
      );
    }
  }
  for (const e of listened) {
    if (!emitted.has(e)) {
      problems.push(`Event "${e}" has a listener but no module emits it.`);
    }
  }

  if (problems.length > 0) {
    throw new Error("Module graph is invalid:\n- " + problems.join("\n- "));
  }
}
