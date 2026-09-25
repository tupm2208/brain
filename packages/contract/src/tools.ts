/**
 * @file Tools the brain may call on the merchant server.
 *
 * Three rules from the specification are enforced here:
 *  1. The bot can only call tools of modules that are ENABLED. A disabled module's tools do not
 *     exist for the bot, and the bot must say "let me hand you to staff" rather than guess.
 *  2. The bot NEVER moves money.
 *  3. Spending money still needs a declared tool, but for HUMANS, not for the bot.
 *     (The first draft had no `audience`, so a human-only money tool could not be declared;
 *     review pointed out that rule 3 would be stuck here.)
 *
 * `assertToolsSafeForBot` does not merely trust the declared `effect`: it also inspects the VERB
 * in the tool name, so that someone adding `payment.refund` with `effect: "read"` is caught.
 */

import type { CatalogItemLite, StockRow } from "./catalog";
import type { ConversationId, ItemId, OrderId, VariantId } from "./ids";
import type { Money, MoneyOnOrder } from "./money";
import type { ModuleId } from "./modules";
import type { ShopProfile } from "./shop-profile";

/** Effect of a tool. `money` is forbidden territory for the bot. */
export type ToolEffect = "read" | "draft" | "money";
/** Who may call it: the bot, or a human sitting at the console. */
export type ToolAudience = "bot" | "human";

/** Hard cap on search results; stops a model from calling without parameters and pulling the whole store. */
export const MAX_SEARCH_LIMIT = 20;
export const MAX_STOCK_ROWS = 60;

/** At least a product code or an internal id is required; an empty call must not dump the store. */
export type StockLookupInput =
  | { code: string; variantLabel?: string | undefined }
  | { itemId: ItemId; variantLabel?: string | undefined };

/**
 * 25/09/2026 (tier-1 Desk rebuild): may the customer still change size on this order? Copied from
 * Desk `orderExchangeState`: "made-to-order goods cannot be exchanged" is only true AFTER the
 * warehouse has bought; an order the warehouse has not bought yet can still change size.
 */
export interface OrderExchangeState {
  allowed: boolean;
  /** `don_da_dong` · `da_gui_hang` · `da_mua` · `chua_mua`. */
  reason: string;
  note?: string | undefined;
  /** Lines still open for exchange, as "name size X". */
  openItems?: string[] | undefined;
  /** Code / name / size of each open line, so the exchange checks stock of the EXACT item ordered. */
  openLines?: { code: string; name: string; size: string }[] | undefined;
}

/** 25/09/2026: the waybill of an order. `url` is built by the MERCHANT SERVER from its carrier configuration — the brain never composes one. */
export interface OrderTracking {
  carrier?: string | undefined;
  code?: string | undefined;
  url?: string | undefined;
  /** The parcel is still on its way (not delivered / cancelled / returned) AND there is a link to send. */
  active: boolean;
}

export interface OrderBrief {
  orderId: OrderId;
  status: string;
  createdAt: string;
  /** Money passes through a single origin (money.ts). Never recomputed anywhere. */
  money: MoneyOnOrder;
  /** Item name + variant, enough to answer the customer. No recipient address. `code` since 25/09/2026. */
  lines: { name: string; variantLabel: string; qty: number; code?: string | undefined }[];
  /** 25/09/2026: Vietnamese status label. Older landings omit it. */
  statusLabel?: string | undefined;
  exchange?: OrderExchangeState | undefined;
  tracking?: OrderTracking | undefined;
}

/**
 * One item as the AI agent's finder returns it (`catalog.find` / `catalog.resolveStock`). Field
 * names are Vietnamese on purpose: the agent's prompt reads them. `so_luong` / `kho` / `dk` /
 * `dieu_kien` were added 25/09/2026 and 24/09/2026; older landings omit them.
 */
export interface FoundCatalogItem {
  ma: string;
  ten: string;
  loai?: string;
  cac_size: {
    size: string;
    gia: number;
    loai?: string;
    /** Real remaining quantity of this size, all warehouses added up (Desk `so_luong`). */
    so_luong?: number;
    /** Expected warehouse id of the size (the same ids `shop.profile.kho[].ma` lists). */
    kho?: string;
    /** Key into `dieu_kien`: the selling terms of the warehouse this size ships from. */
    dk?: string;
  }[];
  anh: string;
  link: string;
  nhom?: string;
  dieu_kien?: Record<string, string>;
}

/** One rung entry of `catalog.resolveStock`: a found item plus whether it has the size asked. */
export interface ResolvedStockEntry extends FoundCatalogItem {
  hasRequestedSize: boolean;
  /** Version read from the name ("12", "13"); empty when the name carries none. */
  doi: string;
}

export interface ToolMap {
  "catalog.search": {
    input: { q: string; limit?: number | undefined };
    output: { items: CatalogItemLite[]; truncated: boolean };
  };
  "stock.lookup": {
    input: StockLookupInput;
    output: { rows: StockRow[]; asOf: string; truncated: boolean };
  };
  "variant.chart": {
    input: { itemId: ItemId };
    output: { axis: string; rows: { label: string; note?: string | undefined }[] };
  };
  /**
   * Order lookup. Rule kept from the legacy system: ONLY orders matching the phone number the
   * customer typed IN THIS CONVERSATION are returned; never someone else's order even if the bot
   * could guess the id. The long parameter name is deliberate: reading the code shows the rule.
   *
   * Note on DECISION 3: this is the only place in the contract carrying a phone number to Xeon.
   * The customer typed it in the chat so it is allowed, BUT the brain must not STORE it and must
   * not log this frame verbatim.
   */
  "order.lookup": {
    input: { conversationId: ConversationId; phoneGivenInConversation: string };
    output: { orders: OrderBrief[] };
  };
  /** Creates a DRAFT order. A human approves it before it becomes real. */
  "order.draft": {
    input: {
      conversationId: ConversationId;
      lines: { itemId: ItemId; variantId: VariantId; qty: number }[];
    };
    output: { orderId: OrderId; money: MoneyOnOrder };
  };
  /**
   * Merchant policy (returns, shipping, warranty). The ONLY legitimate source for the bot to
   * assert anything about policy; a lesson from the unsourced-promise gate of the legacy system.
   */
  "policy.get": {
    input: { topic: string };
    output: { found: boolean; text: string; updatedAt: string };
  };
  "shipment.track": {
    input: { orderId: OrderId };
    output: { carrier: string; tracking: string; status: string; history: { at: string; text: string }[] };
  };
  /** Payment status of an order plus a QR image for the exact amount. Read only. */
  "payment.status": {
    input: { orderId: OrderId };
    output: { money: MoneyOnOrder; qrUrl?: string | undefined; transferNote?: string | undefined };
  };
  /** How long a made-to-order item takes to arrive. */
  "purchase.eta": {
    input: { itemId: ItemId; variantId?: VariantId | undefined };
    output: { available: boolean; days?: number | undefined; note?: string | undefined };
  };
  /** Link to the exact item or filter on the storefront. */
  "storefront.link": {
    input: { q?: string | undefined; filters?: Record<string, string> | undefined };
    output: { url: string };
  };
  /**
   * Recognises a returning customer. Returns signals only, NEVER phone or address:
   * the brain must not see those (DECISION 3).
   */
  "customer.recognize": {
    /**
     * 25/09/2026: `phoneGivenInConversation` — the number the customer typed THEMSELVES; without it
     * the landing answers "unknown" (RULE 2 of the gateway, same as `order.lookup`).
     */
    input: { conversationId: ConversationId; phoneGivenInConversation?: string | undefined };
    output: {
      isReturning: boolean;
      orderCount: number;
      lastOrderAt?: string | undefined;
      /** 25/09/2026 (Desk `buildCustomerPortrait`): the two sizes bought most often in the last five orders. */
      usualSizes?: string[] | undefined;
      lastOrder?: { status: string; statusLabel?: string | undefined; productName: string; size: string; createdAt: string } | null | undefined;
      /** An address is on file — the bot may ASK to reuse it, but never sees it. */
      hasSavedAddress?: boolean | undefined;
    };
  };
  /**
   * The AI agent's stock finder (Sales Desk `tra_kho`, moved 16/09/2026): in-stock items by name,
   * code, size, purpose and gender, the way the shop's customers describe them. `ketQua` is a list,
   * or a sentence telling the agent not to invent anything. Field names are Vietnamese on purpose:
   * the agent's prompt reads them.
   */
  "catalog.find": {
    input: { ten?: string; ma?: string; size?: string; chi_hang_san?: boolean; muc_dich?: string; gioi_tinh?: string; phan_khuc?: string };
    output: { ketQua: FoundCatalogItem[] | string };
  };
  /**
   * THE STOCK LADDER (Desk `resolve_stock`, moved 25/09/2026): when a customer asks for one model
   * in one size, the answer is the FIRST rung that serves it — exact code, another variant of the
   * same line and version (men's / women's / colour), another version of the line (only opened once
   * the same version cannot serve the size), an equivalent line, or nothing. The industry's line
   * aliases go IN (`dongTuongDuong`, `dongNguoiMoi`): the merchant server knows no industry.
   * Every entry has the shape of a `catalog.find` result, with real quantities.
   */
  "catalog.resolveStock": {
    input: {
      ma?: string; ten?: string; doiSo?: string; size?: string; loaiHang?: string;
      /** Aliases of the lines of the SAME segment (may replace the one asked). */
      dongTuongDuong?: string[];
      /** Aliases of "beginner alternative" lines (another segment — a hint, never called equivalent). */
      dongNguoiMoi?: string[];
    };
    output: {
      resolvedLevel: "exact" | "same_line_same_version" | "same_line_other_version" | "equivalent" | "none";
      anchor: { ma: string; ten: string } | null;
      exact: { hasRequestedSize: boolean; rows: ResolvedStockEntry[]; otherKho: string[] } | null;
      sameLineSameVersion: ResolvedStockEntry[];
      sameLineOtherVersion: ResolvedStockEntry[];
      equivalents: ResolvedStockEntry[];
      note: string;
    };
  };
  /**
   * WHICH CODE A CUSTOMER'S PHOTO IS (21/09/2026). The merchant server matches the picture against
   * the fingerprints of its OWN catalogue photos and puts that beside the code the brain's vision
   * model read off the label. `chot.ket`: `tu_tin` (one code), `hoi_lai` (ask the customer — a photo
   * shared by several codes, or label text that disagrees with the picture), `khong_biet`.
   * Only the ADDRESS of the customer's photo goes in; the catalogue photos never leave the merchant.
   */
  "catalog.matchImage": {
    input: { anh: string; maDocDuoc?: string };
    output: {
      chot: { ket: "tu_tin" | "hoi_lai" | "khong_biet"; ma?: string; viSao?: string; luaChon?: string[]; loiNhan?: string };
      ungVien: { ma: string; ten: string }[];
      khoangCach: number | null;
      loiNhan: string;
    };
  };
  /** The shop's bank account — already public on the storefront; the agent checks a transfer screenshot against it. */
  "shop.bankAccount": {
    input: Record<string, never>;
    output: { nganHang: string; maNganHang: string; soTaiKhoan: string; chuTaiKhoan: string };
  };
  /** The recent messages of THIS conversation, oldest first. Read per turn, never kept on Xeon. */
  "conversation.recent": {
    input: { conversationId: ConversationId; limit?: number };
    output: {
      tin: {
        /** Message id on its channel (Meta `mid`, OMI id, or the landing's own for what it sent). Older landings omit it. */
        maTin?: string;
        chieu: "den" | "di";
        /**
         * Who produced it: `khach` on the way in; on the way out `bo-nao`, `omi`, a person's name
         * (web admin session or the shop's own people in a Zalo group). `""` = the landing does not
         * know (a message filed before the field existed).
         */
        boi: string;
        chu: string;
        soAnh: number;
        luc: string;
        /** Image addresses kept in the thread (https or the shop's own media path). Absent when none. */
        anh?: string[];
        /** 24/09/2026: the message this one is a "Reply" to (Meta `reply_to.mid`). Absent on a plain message. */
        traLoiTin?: string;
      }[];
      /** 24/09/2026 (tier-1 Desk rebuild): conversation-level facts. Older landings omit the whole object. */
      hoiThoai?: {
        /** The landing already sent the AI greeting for this conversation. */
        daChaoAi: boolean;
        /** The customer typed a Vietnamese phone number THEMSELVES in one of their messages. */
        dienThoaiDaCho: boolean;
        /**
         * 25/09/2026 (Giai đoạn 7): product codes whose card the landing sent in this conversation
         * within the last 6 hours — asking for them again is refused as `da-gui-6h`. Older landings omit it.
         */
        theDaGui?: string[];
      };
    };
  };
  /**
   * 25/09/2026 (Giai đoạn 7, Desk m-order card): the ORDER FORM LINK for what the customer settled
   * on. The LANDING builds it — pre-fills name / phone / address from the customer's own messages
   * (`chat`, regex, may be wrong) or from their last order (`don-cu`), refuses while the thread is
   * still about a live order (`chan`), and prices the card face from LIVE web stock. No phone or
   * address is in the output except inside the URL itself. The brain passes `url` / `loiMoi` / `the`
   * to `/api/hop-thu/gui` as `phieuDatHang`; the landing sends the card.
   */
  "order.formLink": {
    input: {
      conversationId: ConversationId;
      /** Code + size the customer settled on (at most 5). */
      items: { ma: string; size: string }[];
      /** Pre-fill level the brain ASKS for; the landing answers with the level it could really do. */
      dienSan?: "khong" | "chat" | "don-cu";
    };
    output: {
      /** Empty when refused (`chan`). */
      url: string;
      dienSan: "khong" | "chat" | "don-cu";
      /** The invitation sentence for that level (neutral Vietnamese; the shop may reword on the landing). */
      loiMoi: string;
      chan?: { lyDo: "dang_ban_don_cu" | "thieu_mon"; maDon?: string };
      /** Face of the "Đặt đơn ngay" card: title, subtitle, image of the first item. */
      the?: { tieuDe: string; phuDe: string; anh: string };
    };
  };
  /**
   * What the shop TAUGHT the AI (Đ7): approved Q&A and rules from the review queue, style examples,
   * product fit notes, knowledge libraries, sample customer profiles, and the external product the
   * customer settled on in this conversation. Only APPROVED items are returned — the queue itself
   * never reaches the model. Read per turn, never kept on Xeon.
   */
  "training.knowledge": {
    input: { q?: string; conversationId?: string };
    output: {
      hoiDap: { intent: string; cauHoi: string; traLoi: string }[];
      quyTac: { tieuDe: string; noiDung: string; loai: string }[];
      cauMau: { cauKhach: string; traLoi: string; lyDo: string }[];
      kienThuc: { ma: string; ten: string; form: string; phuHop: string; tuVanSize: string; luuY: string }[];
      thuVien: { ten: string; dungKhi: string[]; noiDung: string }[];
      hoSoMau: { ten: string; tomTat: string }[];
      spNgoai: { ma: string; ten: string; size: string; gia: number } | null;
      cauHinh: { tatHangDoiTac: boolean };
    };
  };
  /**
   * THE SHOP PROFILE (tier 3, 24/09/2026): what is true of this shop only — pronouns, what it sells,
   * how it sells, when a person must take over, and the industry blocks it switched off or rewrote.
   * Bundled with the three policy texts and the warehouses' selling policies, so one call gives the
   * brain everything that is the shop's to decide. Read per turn, never kept on Xeon.
   */
  "shop.profile": {
    input: Record<string, never>;
    output: {
      hoSo: ShopProfile;
      chinhSach: { doiTra: string; ship: string; baoHanh: string };
      /** The shop's warehouses with the selling policy each one declared (empty = none declared). */
      kho: { ma: string; ten: string; loai: "ready" | "order"; uuTien: number; chinhSach: string }[];
    };
  };
  /**
   * A HUMAN approves a draft order and records the payment.
   * `audience: "human"`: the bot never sees this tool. It exists so that spending money is
   * declared INSIDE the contract rather than done off the books.
   */
  "order.approve": {
    input: { orderId: OrderId; approvedBy: string; amount: Money };
    output: { orderId: OrderId; money: MoneyOnOrder };
  };
}

export type ToolName = keyof ToolMap;
export type ToolInput<K extends ToolName> = ToolMap[K]["input"];
export type ToolOutput<K extends ToolName> = ToolMap[K]["output"];

export interface ToolMeta {
  name: ToolName;
  /** Module that provides the tool. Module off = tool gone. */
  module: ModuleId;
  effect: ToolEffect;
  audience: ToolAudience;
  /** Short description, also usable as a tool description for an AI model. */
  describe: string;
}

export const TOOLS: { readonly [K in ToolName]: ToolMeta } = {
  "catalog.search": {
    name: "catalog.search", module: "hang-kho", effect: "read", audience: "bot",
    describe: "Find items by name, code or the keywords the customer typed."
  },
  "stock.lookup": {
    name: "stock.lookup", module: "hang-kho", effect: "read", audience: "bot",
    describe: "Real remaining quantity by code + variant + warehouse."
  },
  "variant.chart": {
    name: "variant.chart", module: "hang-kho", effect: "read", audience: "bot",
    describe: "Variant chart of an item (for example a size chart) to help choose."
  },
  "order.lookup": {
    // `effect: "draft"` rather than `"read"`: this tool WRITES. It records that the customer proved
    // ownership of some orders, and appends an audit line. Declaring it "read" would make the
    // contract lie about itself.
    name: "order.lookup", module: "don-khach", effect: "draft", audience: "bot",
    describe: "Look up orders by the phone number the customer gave in this conversation."
  },
  "order.draft": {
    name: "order.draft", module: "don-khach", effect: "draft", audience: "bot",
    describe: "Create a DRAFT order from the conversation; a human approves it."
  },
  "policy.get": {
    name: "policy.get", module: "don-khach", effect: "read", audience: "bot",
    describe: "Merchant policy (returns, shipping, warranty). Only legitimate source for policy claims."
  },
  "shipment.track": {
    name: "shipment.track", module: "van-chuyen", effect: "read", audience: "bot",
    describe: "Track the shipment of an order."
  },
  "payment.status": {
    name: "payment.status", module: "tien", effect: "read", audience: "bot",
    describe: "Paid so far, still owed, with a QR image for the exact amount."
  },
  "purchase.eta": {
    name: "purchase.eta", module: "mua-ho", effect: "read", audience: "bot",
    describe: "How long a made-to-order item takes to arrive."
  },
  "storefront.link": {
    name: "storefront.link", module: "gian-hang", effect: "read", audience: "bot",
    describe: "Build a link to the exact item or filter on the storefront."
  },
  "customer.recognize": {
    name: "customer.recognize", module: "don-khach", effect: "read", audience: "bot",
    describe: "Whether this customer bought before, how many orders, when the last one was."
  },
  "catalog.find": {
    name: "catalog.find", module: "hang-kho", effect: "read", audience: "bot",
    describe: "Find in-stock items the way customers describe them: name, code, size, purpose, gender."
  },
  "catalog.matchImage": {
    name: "catalog.matchImage", module: "hang-kho", effect: "read", audience: "bot",
    describe: "Which catalogue code a customer's photo matches, by the picture itself; may answer 'ask the customer'."
  },
  "catalog.resolveStock": {
    name: "catalog.resolveStock", module: "hang-kho", effect: "read", audience: "bot",
    describe: "Stock ladder for one model + size: exact code, same line same version, other version, equivalent line, none."
  },
  "shop.bankAccount": {
    name: "shop.bankAccount", module: "don-khach", effect: "read", audience: "bot",
    describe: "The shop's bank account, to check a customer's transfer screenshot."
  },
  "conversation.recent": {
    name: "conversation.recent", module: "hop-thu", effect: "read", audience: "bot",
    describe: "Recent messages of this conversation, to answer in context."
  },
  "training.knowledge": {
    name: "training.knowledge", module: "hop-thu", effect: "read", audience: "bot",
    describe: "What the shop approved for the AI: Q&A, rules, style examples, fit notes, knowledge, the external product settled on."
  },
  "shop.profile": {
    name: "shop.profile", module: "hop-thu", effect: "read", audience: "bot",
    describe: "The shop's own profile: pronouns, what and how it sells, handoff topics, policy texts, warehouse policies."
  },
  "order.formLink": {
    name: "order.formLink", module: "don-khach", effect: "read", audience: "bot",
    describe: "Link to the order form for the items the customer settled on, pre-filled by the landing; refused while a live order is being discussed."
  },
  "order.approve": {
    name: "order.approve", module: "tien", effect: "money", audience: "human",
    describe: "A HUMAN approves a draft order and records payment. The bot must not call this."
  }
};

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOOLS, value);
}

/** Tools the bot may see at all, before licence filtering. */
export const BOT_TOOL_NAMES = TOOL_NAMES.filter((n) => TOOLS[n].audience === "bot");

/**
 * Money verbs inside tool names. Used to catch a WRONG declaration, not only a right one,
 * because `effect` is a word typed by whoever adds the tool.
 */
const MONEY_VERB_RE = /(^|[._-])(pay|payment|refund|transfer|payout|withdraw|charge|capture|settle|chi|hoan|thanhtoan)([._-]|$)/i;
/** Tools that only READ payment state are not money movement. */
const READ_ONLY_MONEY_TOOLS = new Set<ToolName>(["payment.status"]);

/**
 * Checked at build time and at start-up:
 *  - no BOT tool may carry `effect: "money"`;
 *  - no tool whose name carries a money verb may be open to the bot.
 */
export function assertToolsSafeForBot(): void {
  const problems: string[] = [];

  // Read the REGISTRY at call time, not `TOOL_NAMES`: that constant is a snapshot taken at module
  // load, so a tool added afterwards would escape the check. A test covers exactly this.
  for (const name of Object.keys(TOOLS) as ToolName[]) {
    const meta = TOOLS[name];
    if (meta === undefined) continue;
    if (meta.audience !== "bot") continue;
    if (meta.effect === "money") {
      problems.push(`"${name}" declares effect "money" but is open to the bot.`);
    }
    if (MONEY_VERB_RE.test(name) && !READ_ONLY_MONEY_TOOLS.has(name)) {
      problems.push(
        `"${name}" has a money verb in its name (dong tu tieu tien) but is open to the bot with effect "${meta.effect}". ` +
          `If it really only reads, add it to READ_ONLY_MONEY_TOOLS with a reason.`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error("The bot must not move money (specification part 14):\n- " + problems.join("\n- "));
  }
}

// ---------------------------------------------------------------------------
// Shape validation at the network edge. Anything from the wire is untrusted.
// The frame parser only knows "input is an object"; these two know EACH tool.
// ---------------------------------------------------------------------------

type ShapeKind = "string" | "number" | "boolean" | "array" | "object";

const isKind = (value: unknown, kind: ShapeKind): boolean =>
  kind === "array" ? Array.isArray(value)
  : kind === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
  : typeof value === kind;

/** Returns a problem description for one field, or `null` when the field is acceptable. */
function field(obj: Record<string, unknown>, name: string, kind: ShapeKind, required = true): string | null {
  const value = obj[name];
  if (value === undefined) return required ? `missing '${name}'` : null;
  if (!isKind(value, kind)) return `'${name}' must be ${kind}`;
  if (kind === "string" && required && (value as string).trim() === "") return `'${name}' is empty`;
  return null;
}

/** Returns a problem description, or `null` when the input has the right shape for the tool. */
export function validateToolInput(tool: ToolName, input: unknown): string | null {
  if (!isKind(input, "object")) return "input must be an object";
  const o = input as Record<string, unknown>;
  switch (tool) {
    case "catalog.search": return field(o, "q", "string") ?? field(o, "limit", "number", false);
    case "stock.lookup": {
      const hasCode = typeof o["code"] === "string" && o["code"].trim() !== "";
      const hasId = typeof o["itemId"] === "string" && o["itemId"].trim() !== "";
      if (!hasCode && !hasId) return "stock.lookup needs 'code' or 'itemId'";
      return field(o, "variantLabel", "string", false);
    }
    case "variant.chart": return field(o, "itemId", "string");
    case "order.lookup":
      return field(o, "conversationId", "string") ?? field(o, "phoneGivenInConversation", "string");
    case "order.draft": {
      const problem = field(o, "conversationId", "string", false) ?? field(o, "lines", "array");
      if (problem !== null) return problem;
      for (const [i, line] of (o["lines"] as unknown[]).entries()) {
        if (!isKind(line, "object")) return `lines[${i}] must be an object`;
        const r = line as Record<string, unknown>;
        const e = field(r, "itemId", "string") ?? field(r, "variantId", "string") ?? field(r, "qty", "number");
        if (e !== null) return `lines[${i}]: ${e}`;
      }
      return null;
    }
    case "policy.get": return field(o, "topic", "string");
    case "shipment.track":
    case "payment.status": return field(o, "orderId", "string");
    case "purchase.eta": return field(o, "itemId", "string") ?? field(o, "variantId", "string", false);
    case "storefront.link": return field(o, "q", "string", false) ?? field(o, "filters", "object", false);
    case "customer.recognize": return field(o, "conversationId", "string") ?? field(o, "phoneGivenInConversation", "string", false);
    case "catalog.resolveStock":
      return field(o, "ma", "string", false) ?? field(o, "ten", "string", false) ?? field(o, "doiSo", "string", false)
        ?? field(o, "size", "string", false) ?? field(o, "loaiHang", "string", false)
        ?? field(o, "dongTuongDuong", "array", false) ?? field(o, "dongNguoiMoi", "array", false);
    case "training.knowledge": return field(o, "q", "string", false) ?? field(o, "conversationId", "string", false);
    case "shop.profile": return null;
    case "order.formLink":
      return field(o, "conversationId", "string") ?? field(o, "dienSan", "string", false)
        ?? eachElement(o, "items", (x) => field(x, "ma", "string") ?? field(x, "size", "string", false));
    case "order.approve":
      return field(o, "orderId", "string") ?? field(o, "approvedBy", "string") ?? field(o, "amount", "number");
    default: return null;
  }
}

/** A number must exist and be finite; a missing `qty` makes the bot say "Con NaN doi". */
function finiteNumber(obj: Record<string, unknown>, name: string, required = true): string | null {
  const problem = field(obj, name, "number", required);
  if (problem !== null) return problem;
  if (obj[name] === undefined) return null;
  return Number.isFinite(obj[name]) ? null : `'${name}' is not finite`;
}

/** Every element must be an object that passes `check`. */
function eachElement(
  obj: Record<string, unknown>, name: string,
  check: (element: Record<string, unknown>) => string | null
): string | null {
  const arr = obj[name];
  if (!Array.isArray(arr)) return `'${name}' must be array`;
  for (const [i, element] of arr.entries()) {
    if (!isKind(element, "object")) return `${name}[${i}] must be an object`;
    const problem = check(element as Record<string, unknown>);
    if (problem !== null) return `${name}[${i}]: ${problem}`;
  }
  return null;
}

/** Money on an order: three finite numbers. The engine reads `money.remaining` directly. */
function moneyShape(obj: Record<string, unknown>): string | null {
  const problem = field(obj, "money", "object");
  if (problem !== null) return problem;
  const m = obj["money"] as Record<string, unknown>;
  return finiteNumber(m, "total") ?? finiteNumber(m, "paid") ?? finiteNumber(m, "remaining");
}

/**
 * Returns a problem description, or `null` when the output has the shape the brain will read.
 *
 * Checks the INSIDE, not only the envelope: `rows` being an array is not enough; every row must
 * have a finite `qty` and a string `variantLabel`. Checking only the envelope let `rows` without
 * `qty` produce "Con NaN doi size 42" (really sent), `rows: ["junk"]` produce "out of stock"
 * (asserted on junk), and `orders` without `money` crash the whole turn at `o.money.remaining`.
 */
export function validateToolOutput(tool: ToolName, data: unknown): string | null {
  if (!isKind(data, "object")) return "data must be an object";
  const o = data as Record<string, unknown>;
  switch (tool) {
    case "catalog.search":
      return field(o, "truncated", "boolean") ?? eachElement(o, "items", (x) =>
        field(x, "id", "string") ?? field(x, "code", "string") ?? field(x, "name", "string"));
    case "stock.lookup":
      return field(o, "asOf", "string") ?? field(o, "truncated", "boolean") ?? eachElement(o, "rows", (x) =>
        field(x, "variantLabel", "string", false) ?? finiteNumber(x, "qty") ?? finiteNumber(x, "price")
        ?? field(x, "warehouseId", "string") ?? field(x, "warehouseName", "string", false));
    case "variant.chart":
      return field(o, "axis", "string", false) ?? eachElement(o, "rows", (x) => field(x, "label", "string", false));
    case "order.lookup":
      return eachElement(o, "orders", (x) =>
        field(x, "orderId", "string") ?? field(x, "status", "string", false) ?? moneyShape(x)
        ?? field(x, "lines", "array"));
    case "order.draft":
    case "order.approve": return field(o, "orderId", "string") ?? moneyShape(o);
    case "policy.get": return field(o, "found", "boolean") ?? field(o, "text", "string", false);
    case "shipment.track":
      return field(o, "status", "string", false) ?? eachElement(o, "history", (x) => field(x, "text", "string", false));
    case "payment.status": return moneyShape(o);
    case "purchase.eta": return field(o, "available", "boolean") ?? finiteNumber(o, "days", false);
    case "storefront.link": return field(o, "url", "string", false);
    case "customer.recognize": return field(o, "isReturning", "boolean") ?? finiteNumber(o, "orderCount");
    case "catalog.resolveStock": {
      const rung = (x: Record<string, unknown>): string | null => field(x, "ma", "string") ?? field(x, "cac_size", "array") ?? field(x, "hasRequestedSize", "boolean");
      return field(o, "resolvedLevel", "string") ?? field(o, "note", "string", false)
        ?? (o["exact"] === null || o["exact"] === undefined ? null : field(o, "exact", "object") ?? eachElement(o["exact"] as Record<string, unknown>, "rows", rung))
        ?? eachElement(o, "sameLineSameVersion", rung) ?? eachElement(o, "sameLineOtherVersion", rung) ?? eachElement(o, "equivalents", rung);
    }
    case "training.knowledge":
      return field(o, "hoiDap", "array") ?? field(o, "quyTac", "array") ?? field(o, "cauMau", "array") ?? field(o, "kienThuc", "array")
        ?? field(o, "thuVien", "array") ?? field(o, "hoSoMau", "array") ?? field(o, "cauHinh", "object");
    case "shop.profile": return field(o, "hoSo", "object") ?? field(o, "chinhSach", "object") ?? field(o, "kho", "array");
    case "order.formLink":
      return field(o, "url", "string", false) ?? field(o, "dienSan", "string") ?? field(o, "loiMoi", "string", false)
        ?? field(o, "chan", "object", false) ?? field(o, "the", "object", false);
    default: return null;
  }
}
