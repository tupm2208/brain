import { type EventName } from "./events";
import { type ToolName } from "./tools";
export declare const MODULE_GROUPS: readonly ["vanhanh", "content", "chatbot"];
export type ModuleGroup = (typeof MODULE_GROUPS)[number];
export declare const GROUP_LABELS: Record<ModuleGroup, string>;
export type ModuleId = "hang-kho" | "don-khach" | "lien-ket" | "van-chuyen" | "tien" | "mua-ho" | "gian-hang" | "xuong-noi-dung" | "xuong-video" | "goi-noi-dung" | "hop-thu" | "chatbot-cskh" | "nhu-cau-cho";
export interface ModuleDef {
    id: ModuleId;
    group: ModuleGroup;
    name: string;
    /** Chay tren may khach hay tren Xeon cua minh. */
    runsOn: "omi" | "xeon";
    /** Manh loi: luon bat, khong ban roi, va la thu duy nhat manh khac duoc phu thuoc vao. */
    core: boolean;
    /** Cong cu manh nay mo. */
    tools: ToolName[];
    emits: EventName[];
    /** Nghe duoc su kien tu ca hai phia — su kien di qua duong noi neu khac may. */
    listens: EventName[];
    /**
     * Phu thuoc o muc MA NGUON. Chi duoc tro xuong manh LOI, va phai CUNG MAY:
     * mot manh chay tren Xeon khong the phu thuoc vao manh chay tren may khach,
     * giua chung chi co duong day — co the dut bat cu luc nao.
     */
    dependsOn: ModuleId[];
}
export declare const MODULES: {
    readonly [K in ModuleId]: ModuleDef;
};
export declare const MODULE_IDS: ModuleId[];
export declare const CORE_MODULE_IDS: ModuleId[];
/** Tran tu dat: tong so manh. Nhieu hon thi khach khong chon noi, minh khong va noi. */
export declare const MODULE_CEILING = 15;
export declare function isModuleId(v: unknown): v is ModuleId;
export declare function modulesOfGroup(group: ModuleGroup): ModuleDef[];
/**
 * MAY TU KIEM — chay luc dung ban va luc khoi dong, khong doi nguoi phat hien.
 *
 * Cai bay so 2 trong ban dac ta: "mot hom ai do cho manh nay goi thang manh kia cho nhanh,
 * tu do khong thao roi duoc nua". Ham nay lam cho viec do gay ngay lap tuc.
 */
export declare function assertModuleGraph(): void;
//# sourceMappingURL=modules.d.ts.map