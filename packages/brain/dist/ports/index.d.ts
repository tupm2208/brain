import type { CatalogItemLite, ConversationId, LinkError, TenantId, ToolInput, ToolName, ToolOutput } from "@sp/contract";
export type ToolResult<K extends ToolName> = {
    ok: true;
    tool: K;
    data: ToolOutput<K>;
} | {
    ok: false;
    tool: K;
    error: LinkError;
};
/**
 * Ngu canh cua MOT luot goi cong cu. Hai truong nay khong phai tuy chon ve mat y nghia:
 *
 * - `conversationId`: OMI dung no lam CONG. Bot khong mang theo hoi thoai thi khong mo
 *   duoc don nao — day la cho luat "moi luot goi phai gan voi mot hoi thoai that" duoc
 *   cuong che, chu khong phai mot loi hua trong tai lieu.
 * - `idempotencyKey`: duong day gui lai khi rot mang. Thieu no la khach nhan HAI ma don
 *   cho mot don.
 */
export interface CallCtx {
    conversationId: ConversationId;
    idempotencyKey?: string | undefined;
}
/** Goi cong cu sang OMI qua duong noi. */
export interface ToolPort {
    /** Cong cu nao dang thuc su goi duoc (giao cua giay phep va bo luat nganh). */
    available(): ToolName[];
    call<K extends ToolName>(tool: K, input: ToolInput<K>, nguCanh?: CallCtx | undefined): Promise<ToolResult<K>>;
    /** May shop co dang noi duoc khong. Mat ket noi thi bot chuyen sang che do han che. */
    online(): boolean;
}
/** Muc luc hang hoa Bo nao giu — chi ten, ma, thuoc tinh. Khong co du lieu khach. */
export interface CatalogPort {
    search(tenant: TenantId, query: string, limit: number): Promise<CatalogItemLite[]>;
    /** Tong so mon trong muc luc. Cong "khong kinh doanh hang X" can con so nay. */
    size(tenant: TenantId): Promise<number>;
}
export interface Clock {
    now(): Date;
}
export declare const systemClock: Clock;
/** Mot dong trong hoi thoai. */
export interface Turn {
    role: "customer" | "shop";
    text: string;
    at: string;
    /** So anh khach gui trong luot do — cong "da co anh" doc con so nay. */
    imageCount?: number | undefined;
}
/** Trang thai hoi thoai luu giua cac luot. */
export interface ConversationState {
    conversationId: ConversationId;
    tenant: TenantId;
    turns: Turn[];
    /** Mon hang dang la tam diem cua phien mua hien tai. */
    focusItemCode?: string | undefined;
    /** Ma noi bo cua mon do — cong cu nao doi `ItemId` thi phai dung cai nay, khong dung ma shop. */
    focusItemId?: string | undefined;
    /** Gia tri da biet cua tung truc bien the: { size: "42" }, { thoiluong: "60 phut" }. */
    focusSlots?: Record<string, string> | undefined;
    /** Y dinh cua luot truoc — de doc duoc tin cut ("42", "ok") nhu cau tra loi tiep. */
    lastIntentId?: string | undefined;
    /** O thong tin bot vua hoi. Tin cut ngay sau do duoc hieu la dang tra loi o nay. */
    lastAskedSlot?: string | undefined;
    /** Moc bat dau phien mua hien tai (ISO). */
    episodeStartedAt?: string | undefined;
    /** Lan gan nhat bot hoi nguoc khach (ISO) — cong `ask_back_once` doc moc nay. */
    lastAskBackAt?: string | undefined;
    /**
     * Da hoi nguoc khach may lan trong phien nay.
     * Chi co moc thoi gian thi khong du: khach tra loi cham hon cua so 30 phut —
     * chuyen rat thuong tren Fanpage — la bot hoi mai ma khong bao gio goi nguoi that.
     */
    askBackCount?: number | undefined;
    /**
     * So luot lien tiep bot chi biet chao lai vi khong ra y dinh nao.
     * Khong dem thi khach go "alo", "ok", "co ai khong" la bot lap loi chao vo han
     * va khong bao gio goi nguoi that.
     */
    idleCount?: number | undefined;
    /** So dien thoai khach TU GO trong hoi thoai nay. Khong lay tu bat ky nguon nao khac. */
    phoneGivenInConversation?: string | undefined;
    handedOff?: boolean | undefined;
}
export interface MemoryPort {
    load(tenant: TenantId, conversationId: ConversationId): Promise<ConversationState | null>;
    save(state: ConversationState): Promise<void>;
}
/**
 * Cua goi mo hinh AI. CO Y de tuy chon: bo may chay tron ven khong can no.
 * Luat chay truoc, AI chay sau — va AI chi duoc dien dat trong pham vi bo may dua ra.
 */
export interface AdvisorPort {
    /** Viet lai cau cho tu nhien hon, KHONG duoc them so lieu hay cam ket moi. */
    rephrase(input: {
        draft: string;
        tone: string[];
        facts: string[];
    }): Promise<string>;
}
export interface Ports {
    tools: ToolPort;
    catalog: CatalogPort;
    memory: MemoryPort;
    clock: Clock;
    advisor?: AdvisorPort | undefined;
}
//# sourceMappingURL=index.d.ts.map