import { type LinkFrame, type ToolName, type ActorId } from "@sp/contract";
import type { ToolPort } from "../ports/index";
/** Duong ong hai chieu. Bo may khong biet ben duoi la mang, ong trong bo nho, hay gi khac. */
export interface Kenh {
    gui(frame: LinkFrame): void;
    /** Dang ky nguoi nghe. Tra ve ham go dang ky. */
    nghe(fn: (frame: LinkFrame) => void): () => void;
}
export interface CauHinhGoi {
    kenh: Kenh;
    sessionId: string;
    actor: ActorId;
    /** Cong cu Xeon da cap trong khung `welcome`. */
    tools: ToolName[];
    timeoutMs?: number | undefined;
    /** Duong con song khong. Mat duong thi bo may chuyen sang che do han che. */
    online?: (() => boolean) | undefined;
    now?: (() => number) | undefined;
}
export declare function taoToolPort(cfg: CauHinhGoi): ToolPort & {
    dong(): void;
};
//# sourceMappingURL=goi-qua-day.d.ts.map