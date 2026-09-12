import type { CatalogItemLite, StockRow } from "./catalog";
import type { ConversationId, ItemId, OrderId, VariantId } from "./ids";
import type { Money, MoneyOnOrder } from "./money";
import type { ModuleId } from "./modules";
/** Anh huong cua mot cong cu. `money` la vung cam voi bot. */
export type ToolEffect = "read" | "draft" | "money";
/** Ai duoc goi: con bot, hay nguoi that ngoi truoc man hinh. */
export type ToolAudience = "bot" | "human";
/** Tran cung cho ket qua tim kiem — chan viec model bat khong tham so roi keo ca kho ve. */
export declare const MAX_SEARCH_LIMIT = 20;
export declare const MAX_STOCK_ROWS = 60;
/** Bat buoc phai co it nhat ma san pham hoac ma noi bo — khong cho goi rong de dump ca kho. */
export type StockLookupInput = {
    code: string;
    variantLabel?: string | undefined;
} | {
    itemId: ItemId;
    variantLabel?: string | undefined;
};
export interface OrderBrief {
    orderId: OrderId;
    status: string;
    createdAt: string;
    /** Tien di qua mot goc duy nhat — xem money.ts. Cam tu tinh lai o bat ky dau. */
    money: MoneyOnOrder;
    /** Ten mon + bien the, du de tra loi khach. Khong kem dia chi nguoi nhan. */
    lines: {
        name: string;
        variantLabel: string;
        qty: number;
    }[];
}
export interface ToolMap {
    "catalog.search": {
        input: {
            q: string;
            limit?: number | undefined;
        };
        output: {
            items: CatalogItemLite[];
            truncated: boolean;
        };
    };
    "stock.lookup": {
        input: StockLookupInput;
        output: {
            rows: StockRow[];
            asOf: string;
            truncated: boolean;
        };
    };
    "variant.chart": {
        input: {
            itemId: ItemId;
        };
        output: {
            axis: string;
            rows: {
                label: string;
                note?: string | undefined;
            }[];
        };
    };
    /**
     * Tra don. Luat giu nguyen tu he cu: CHI tra don khop so dien thoai ma khach
     * da tu cung cap TRONG chinh hoi thoai do — khong bao gio tra don nguoi khac
     * du bot co doan ra ma don. Ten tham so dat dai co chu dich, de doc ma la thay luat.
     *
     * LUU Y ve QUYET DINH 3: day la cho duy nhat trong ban giao keo mang so dien thoai
     * sang Xeon. Khach tu go so do trong khung chat nen khong vi pham, NHUNG
     * Bo nao khong duoc LUU va khong duoc ghi nguyen khung nay vao nhat ky.
     */
    "order.lookup": {
        input: {
            conversationId: ConversationId;
            phoneGivenInConversation: string;
        };
        output: {
            orders: OrderBrief[];
        };
    };
    /** Tao don NHAP. Nguoi that duyet moi thanh don that. */
    "order.draft": {
        input: {
            conversationId: ConversationId;
            lines: {
                itemId: ItemId;
                variantId: VariantId;
                qty: number;
            }[];
        };
        output: {
            orderId: OrderId;
            money: MoneyOnOrder;
        };
    };
    /**
     * Chinh sach shop (doi tra, ship, bao hanh). Day la NGUON HOP LE DUY NHAT
     * de bot khang dinh ve chinh sach — bai hoc tu cong cam ket khong nguon ben he cu.
     */
    "policy.get": {
        input: {
            topic: string;
        };
        output: {
            found: boolean;
            text: string;
            updatedAt: string;
        };
    };
    "shipment.track": {
        input: {
            orderId: OrderId;
        };
        output: {
            carrier: string;
            tracking: string;
            status: string;
            history: {
                at: string;
                text: string;
            }[];
        };
    };
    /** Tinh trang tien cua don + anh QR dung so tien. Doc, khong ghi. */
    "payment.status": {
        input: {
            orderId: OrderId;
        };
        output: {
            money: MoneyOnOrder;
            qrUrl?: string | undefined;
            transferNote?: string | undefined;
        };
    };
    /** Hang phai order thi bao lau ve. */
    "purchase.eta": {
        input: {
            itemId: ItemId;
            variantId?: VariantId | undefined;
        };
        output: {
            available: boolean;
            days?: number | undefined;
            note?: string | undefined;
        };
    };
    /** Link dung mon hoac dung bo loc tren gian hang. */
    "storefront.link": {
        input: {
            q?: string | undefined;
            filters?: Record<string, string> | undefined;
        };
        output: {
            url: string;
        };
    };
    /**
     * Nhan ra khach cu. Tra ve dau hieu, KHONG tra ve so dien thoai hay dia chi —
     * Bo nao khong duoc thay nhung thu do (Quyet dinh 3).
     */
    "customer.recognize": {
        input: {
            conversationId: ConversationId;
        };
        output: {
            isReturning: boolean;
            orderCount: number;
            lastOrderAt?: string | undefined;
        };
    };
    /**
     * NGUOI duyet va chot mot don nhap thanh don that, dong thoi ghi nhan tien.
     * `audience: "human"` — bot khong bao gio thay cong cu nay.
     * Co mat o day de viec tieu tien nam TRONG ban giao keo thay vi lam chui ben ngoai.
     */
    "order.approve": {
        input: {
            orderId: OrderId;
            approvedBy: string;
            amount: Money;
        };
        output: {
            orderId: OrderId;
            money: MoneyOnOrder;
        };
    };
}
export type ToolName = keyof ToolMap;
export type ToolInput<K extends ToolName> = ToolMap[K]["input"];
export type ToolOutput<K extends ToolName> = ToolMap[K]["output"];
export interface ToolMeta {
    name: ToolName;
    /** Manh nao mo cong cu nay. Manh tat = cong cu bien mat. */
    module: ModuleId;
    effect: ToolEffect;
    audience: ToolAudience;
    /** Cau mo ta ngan, dung luon lam mo ta cho mo hinh AI. */
    describe: string;
}
export declare const TOOLS: {
    readonly [K in ToolName]: ToolMeta;
};
export declare const TOOL_NAMES: ToolName[];
export declare function isToolName(v: unknown): v is ToolName;
/** Cong cu bot duoc phep nhin thay, truoc khi loc tiep theo giay phep. */
export declare const BOT_TOOL_NAMES: (keyof ToolMap)[];
/**
 * Chan ngay luc dung ban va luc khoi dong:
 *  - khong cong cu nao cua BOT duoc mang `effect: "money"`;
 *  - khong cong cu nao co ten mang dong tu tieu tien ma lai mo cho bot.
 */
export declare function assertToolsSafeForBot(): void;
/** Tra ve cau mo ta loi, hoac `null` neu dau vao dung hinh dang cho cong cu nay. */
export declare function kiemInput(tool: ToolName, input: unknown): string | null;
/**
 * Tra ve cau mo ta loi, hoac `null` neu ket qua dung hinh dang Bo nao se doc.
 *
 * Kiem ca RUOT, khong chi VO: `rows` la mang chua du — tung dong phai co `qty` la so
 * huu han, `variantLabel` la chuoi. Chi kiem vo thi `rows` thieu `qty` cho ra "Con NaN
 * doi size 42" (gui di that), `rows: ["rac"]` cho ra "het hang" (khang dinh tren rac), va
 * `orders` thieu `money` lam `o.money.remaining` nem chet ca luot tin.
 */
export declare function kiemOutput(tool: ToolName, data: unknown): string | null;
//# sourceMappingURL=tools.d.ts.map