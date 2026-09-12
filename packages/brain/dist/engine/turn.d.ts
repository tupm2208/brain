import { type ConversationId, type TenantId, type ToolName } from "@sp/contract";
import type { IndustryPack, PackAxis, PackIntent } from "../pack/types";
import type { ConversationState, Ports } from "../ports/index";
import { type Fact, type GateVerdict } from "./gates";
export interface HandleInput {
    tenant: TenantId;
    conversationId: ConversationId;
    text: string;
    imageCount?: number | undefined;
    at?: string | undefined;
}
export interface HandleResult {
    action: "send" | "ask_back" | "handoff";
    reply: string;
    intentId: string | null;
    itemCode: string | null;
    slots: Record<string, string>;
    facts: Fact[];
    gates: GateVerdict[];
    /**
     * Gia tri bot duoc phep nhac lai ma khong bi coi la bia so.
     * Dua ra ngoai de kiem duoc: day PHAI la gia tri o thong tin, khong duoc la
     * moi con so khach tung go — neu khong thi khach hoi "shop con 500 doi khong"
     * la bot duoc phep khang dinh "con 500 doi".
     */
    echoed: string[];
    state: ConversationState;
}
/** Nguong nhan ra mon hang: cau khach phu duoc bao nhieu phan ten san pham. */
export declare const ITEM_MATCH_THRESHOLD = 0.5;
export declare function applyAliases(pack: IndustryPack, text: string): string;
export declare function detectIntent(pack: IndustryPack, text: string): PackIntent | null;
export declare function extractAxis(axis: PackAxis, text: string): string | null;
/** Quy gia tri ve dang chuan de SO KHOP. */
export declare function canonicalValue(axis: PackAxis, value: string): string;
/**
 * Rut gia tri cua truc nay ra khoi NHAN KHO, roi moi quy chuan.
 *
 * Nhan kho hay viet ghep: "500 mg x 30 vien", "EU 42", "US 8.5 / EU 42".
 * Neu chi quy chuan ca chuoi thi cac luat neo `^...$` khong bao gio ap duoc,
 * va bot bao HET HANG trong khi kho dang co hang — loi nang nhat da gap.
 */
export declare function labelValue(axis: PackAxis, rowLabel: string): string;
/** Nhan kho co khop gia tri khach hoi khong. */
export declare function labelMatches(axis: PackAxis, requested: string, rowLabel: string): boolean;
/** Cong cu bo may biet chay. `validatePack` doi chieu voi danh sach ho so khai. */
export declare const DISPATCHABLE_TOOLS: ToolName[];
export declare function handleTurn(pack: IndustryPack, ports: Ports, input: HandleInput): Promise<HandleResult>;
//# sourceMappingURL=turn.d.ts.map