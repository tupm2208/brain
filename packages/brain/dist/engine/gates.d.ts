import type { GateRule, IndustryPack, PackIntent } from "../pack/types";
import type { ConversationState } from "../ports/index";
/** Mot manh su that lay tu ket qua cong cu. Moi con so bot noi ra phai truy duoc ve day. */
export interface Fact {
    source: string;
    text: string;
    numbers: number[];
}
export type GateAction = "send" | "ask_back" | "handoff" | "block";
export interface GateVerdict {
    action: GateAction;
    rule?: GateRule["kind"] | undefined;
    reason: string;
}
export interface GateInput {
    pack: IndustryPack;
    state: ConversationState;
    now: Date;
    draft: string;
    facts: Fact[];
    intent: PackIntent | null;
    itemIdentified: boolean;
    /**
     * Luot nay bo may lai dinh HOI NGUOC khach. Cong `ask_back_once` chi bung khi dieu
     * nay dung — nhung no phai dung cho MOI duong hoi lai, ke ca duong khong qua y dinh,
     * neu khong se co vong lap bot hoi mai mot cau ma khong bao gio goi nguoi that.
     */
    wouldAskBack: boolean;
    online: boolean;
    catalogSize: number;
    claimsBrandNotCarried: boolean;
    hasPolicySource: boolean;
    /** Gia tri o thong tin khach da cung cap. Bot duoc phep nhac lai chung. */
    echoedValues: string[];
    /**
     * Van ban do SHOP viet ma cong cu tra ve (noi dung chinh sach, trang thai don).
     * Khac mau cau cua ho so: bo soi khong ep duoc no viet co dau, nen cac mau cam
     * phai doi chieu ca dang bo dau tren rieng phan chu nay.
     */
    toolText?: string[] | undefined;
}
export interface NumberScan {
    numbers: number[];
    /** Cum co cau truc, giu nguyen dang da chuan hoa. */
    structured: string[];
}
export declare function scanNumbers(text: string): NumberScan;
/** Giu lai cho tuong thich: chi lay phan so. */
export declare function numbersIn(text: string): number[];
export declare function wordQuantityClaims(text: string): string[];
export declare function runGates(input: GateInput): {
    verdict: GateVerdict;
    all: GateVerdict[];
};
//# sourceMappingURL=gates.d.ts.map