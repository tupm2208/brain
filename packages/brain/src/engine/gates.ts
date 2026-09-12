// CONG AN TOAN — phan dat nhat cua he thong.
//
// Day la thu anh Dung tra hoc phi mot nam de co, o he cu no nam rai rac trong
// `ai_fallback_gate.js` va hang tram dong trong `ai_router.js`. O nen tang nay no thanh
// mot bo may TRUNG LAP doc luat tu bo ho so nganh.
//
// Nguyen tac goc, khong bao gio duoc noi long: THA IM CON HON NOI SAI.

import type { GateRule, IndustryPack, PackIntent } from "../pack/types";
import type { ConversationState } from "../ports/index";
import { askedBackWithin } from "./memory";
import { normalize, soft, squash, stripDiacritics } from "./text";

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

const SEVERITY: Record<GateAction, number> = { send: 0, ask_back: 1, handoff: 2, block: 3 };

const RULE_PRIORITY: Record<GateRule["kind"], number> = {
  forbidden_phrases: 70,
  forbidden_patterns: 65,
  no_facts_when_offline: 50,
  no_unsourced_numbers: 40,
  require_source_for_claims: 30,
  brand_not_carried_needs_catalog: 20,
  require_item_before_stock: 10,
  ask_back_once: 5
};

function rank(v: GateVerdict): number {
  return SEVERITY[v.action] * 100 + (v.rule === undefined ? 0 : RULE_PRIORITY[v.rule]);
}

// ---------------------------------------------------------------------------
// Doc so trong mot cau
// ---------------------------------------------------------------------------

const SCALE: Record<string, number> = {
  k: 1_000, nghin: 1_000, ngan: 1_000,
  tr: 1_000_000, trieu: 1_000_000,
  ty: 1_000_000_000
};

/**
 * Cum co CAU TRUC: gio, ngay thang, phan tram. Chung phai duoc doi chieu NGUYEN CUM
 * chu khong tach thanh so roi, neu khong thi "14h30" thanh hai so 14 va 30 —
 * va moi cau hen gio deu bi chan. Nganh dich vu se khong dung duoc gi.
 */
// Gio phai viet lien ("14h30", "9h") va khong duoc dinh chu phia sau, neu khong thi
// "12 hop" bi doc thanh gio 12h — roi cau bao ton kho binh thuong bi chan.
const STRUCTURED_RE = /\d{1,2}h\d{0,2}(?![\p{L}0-9])|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d+\s*%/gu;

/**
 * "2tr5" = 2.500.000, "3tr190" = 3.190.000 — cach viet gia pho bien nhat khi nhan tin.
 * Phan sau don vi la PHAN LE, doc theo so chu so: "2tr5" la 2,5 trieu, "3tr190" la
 * 3,190 trieu, "2tr50" la 2,50 trieu. Truoc day chi nhan mot chu so nen "3tr190" bi
 * doc thanh 3.000.000 va 190 — hai con so deu sai.
 */
const COMPOUND_MONEY_RE = /(\d+)\s*(tr|trieu|ty)\s*(\d{1,3})(?![\d])/g;

export interface NumberScan {
  numbers: number[];
  /** Cum co cau truc, giu nguyen dang da chuan hoa. */
  structured: string[];
}

/**
 * Dau tien te dinh LIEN vao con so: `3.190.000đ`, `25.000₫`, `500k VND`.
 *
 * Phai go TRUOC khi bo dau, va day la mot cai bay that: `normalize` doi `đ` thanh `d`,
 * ma `d` la chu cai, ma sau con so co chu cai thi cong lui lai mot nac de tim cho dut —
 * `"gia 3.190.000đ"` bi doc thanh **3190**. Con so 3190 do khong co trong dan chung nen
 * bot bi chinh cong cua no chan lai, va khach khong nhan duoc cau nao.
 */
const TIEN_TE_RE = /(?<=\d)\s*(?:₫|đ|Đ|vn[đĐdD])(?![\p{L}])|(?<=\d)[dD](?![\p{L}])/gu;

export function scanNumbers(text: string): NumberScan {
  let n = normalize(String(text ?? "").replace(TIEN_TE_RE, " "));
  const structured: string[] = [];
  const numbers: number[] = [];

  n = n.replace(STRUCTURED_RE, (m) => {
    structured.push(m.replace(/\s+/g, ""));
    return " ";
  });

  n = n.replace(COMPOUND_MONEY_RE, (_m, a: string, unit: string, b: string) => {
    const scale = SCALE[unit] ?? 1;
    numbers.push(Number(a) * scale + Number(b) * (scale / 10 ** b.length));
    return " ";
  });

  // `(?![a-z])` sau don vi la bat buoc: khong co no thi "con 3 kieu" ra 3000
  // (chu "k" cua "kieu" bi doc thanh nghin) va con so that bien mat khoi cong.
  for (const m of n.matchAll(/(\d[\d.,]*)\s*(k|nghin|ngan|tr|trieu|ty)?(?![a-z])/g)) {
    const raw = (m[1] ?? "").replace(/[.,](?=\d{3}(\D|$))/g, "");
    const base = Number(raw.replace(/,/g, "."));
    if (!Number.isFinite(base)) continue;
    const unit = m[2];
    numbers.push(unit === undefined ? base : base * (SCALE[unit] ?? 1));
  }
  return { numbers, structured };
}

/** Giu lai cho tuong thich: chi lay phan so. */
export function numbersIn(text: string): number[] {
  return scanNumbers(text).numbers;
}

/**
 * So viet bang CHU di kem tu chi don vi: "con ba doi", "vai hop".
 *
 * Soi tren dang CO DAU. Bo dau thi "sau" (gioi tu) va "sáu" (so 6) thanh mot chu,
 * nen nhung cau rat binh thuong nhu "quay lai sau buoi dau tien" bi chan —
 * va mot cau bi chan la ca phien di doi.
 */
const WORD_NUMBERS = [
  "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín", "mười",
  "vài", "chục", "dăm"
];
const CLASSIFIERS = [
  "đôi", "cái", "chiếc", "hộp", "viên", "gói", "chai", "bộ", "chỗ", "suất", "buổi",
  "ngày", "tuần", "tháng", "giờ", "phút", "lần", "sản phẩm", "mẫu"
];

export function wordQuantityClaims(text: string): string[] {
  const n = soft(text);
  const out: string[] = [];
  for (const w of WORD_NUMBERS) {
    for (const c of CLASSIFIERS) {
      if (new RegExp(`(^|[^\\p{L}])${w}\\s+${c}([^\\p{L}]|$)`, "u").test(n)) out.push(`${w} ${c}`);
    }
  }
  return out;
}

/**
 * Cum bi cam / chu de chinh sach duoc soi tren CA HAI dang:
 *  - co dau: cach viet chuan cua ho so;
 *  - bo dau: de bat ca khi mau cau cua shop viet khong dau (rat hay xay ra).
 * Chi ap dung cho CUM NHIEU CHU — cum mot chu de va vao "đôi/đổi".
 */
function phraseHit(draft: string, phrase: string): boolean {
  if (soft(draft).includes(soft(phrase))) return true;
  // Dau cau chen vao giua khong duoc lam cum cam thoat: "rẻ nhất - thị trường".
  if (squash(draft).includes(squash(phrase))) return true;
  const flat = normalize(phrase);
  if (flat.includes(" ")) return normalize(draft).includes(flat);
  return false;
}

/**
 * Doi chieu mau regex cua ho so voi cau bot.
 *
 * CHI soi tren dang CO DAU, va day la mot rang buoc co y: bo dau xong thi "đôi"
 * (don vi dem giay) va "đổi" (doi tra) la MOT chuoi — khong thuat toan nao tach duoc.
 * Neu soi ca dang khong dau thi cau ban hang binh thuong "còn 3 đôi size 42" se bi
 * doc thanh loi hua doi tra va chan mat.
 *
 * Doi lai, MAU CAU CUA HO SO BAT BUOC PHAI VIET CO DAU — `validatePack` tu choi
 * ho so viet khong dau va noi ro ly do.
 */
function patternHit(draft: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "u").test(soft(draft));
  } catch {
    return false;
  }
}

function evaluateRule(rule: GateRule, input: GateInput): GateVerdict | null {
  switch (rule.kind) {
    case "no_facts_when_offline": {
      if (input.online) return null;
      if (input.facts.length > 0) {
        return { action: "block", rule: rule.kind, reason: "Mat ket noi may shop ma cau tra loi lai mang so lieu." };
      }
      const scan = scanNumbers(input.draft);
      if (scan.numbers.length > 0 || scan.structured.length > 0 || wordQuantityClaims(input.draft).length > 0) {
        return { action: "handoff", rule: rule.kind, reason: "Mat ket noi ma cau tra loi co con so — chuyen nguoi that." };
      }
      return null;
    }

    case "require_item_before_stock": {
      const needsItem = input.intent?.requiredSlots.includes("item") === true;
      if (!needsItem || input.itemIdentified) return null;
      return { action: "ask_back", rule: rule.kind, reason: "Chua nhan ra dung mon hang ma da dinh tra loi ton kho." };
    }

    case "ask_back_once": {
      if (!input.wouldAskBack) return null;
      const max = rule.maxTimes ?? 1;
      const count = input.state.askBackCount ?? 0;
      const trongCuaSo = askedBackWithin(input.state, input.now, rule.windowMinutes);
      // Hai duong dan toi nguoi that: hoi lai lien tiep trong cua so, HOAC da hoi du
      // so lan cho phep trong ca phien du khach tra loi cham.
      if (!trongCuaSo && count < max) return null;
      return {
        action: "handoff",
        rule: rule.kind,
        reason: trongCuaSo
          ? `Da hoi nguoc khach trong ${rule.windowMinutes} phut truoc ma van chua du thong tin.`
          : `Da hoi nguoc khach ${count} lan trong phien nay ma van chua du thong tin.`
      };
    }

    case "require_source_for_claims": {
      const touched = rule.topics.filter((t) => phraseHit(input.draft, t));
      for (const p of rule.patterns ?? []) {
        if (patternHit(input.draft, p)) touched.push(p);
      }
      if (touched.length === 0 || input.hasPolicySource) return null;
      return {
        action: "block",
        rule: rule.kind,
        reason: `Khang dinh ve "${touched.join(", ")}" ma khong co ket qua tra chinh sach lam nguon.`
      };
    }

    case "no_unsourced_numbers": {
      const allowed = new Set<number>();
      const allowedText: string[] = [];
      for (const f of input.facts) {
        for (const n of f.numbers) allowed.add(n);
        const s = scanNumbers(f.text);
        s.structured.forEach((x) => allowedText.push(x));
      }
      for (const v of input.echoedValues) {
        const s = scanNumbers(v);
        s.numbers.forEach((n) => allowed.add(n));
        s.structured.forEach((x) => allowedText.push(x));
      }

      const scan = scanNumbers(input.draft);
      const invented = scan.numbers.filter((n) => !allowed.has(n));
      const inventedStructured = scan.structured.filter((x) => !allowedText.includes(x));
      const wordy = wordQuantityClaims(input.draft);
      if (invented.length === 0 && inventedStructured.length === 0 && wordy.length === 0) return null;

      const parts: string[] = [];
      if (invented.length > 0) parts.push(`so khong truy duoc nguon: ${invented.join(", ")}`);
      if (inventedStructured.length > 0) parts.push(`gio/ngay khong co nguon: ${inventedStructured.join(", ")}`);
      if (wordy.length > 0) parts.push(`so luong viet bang chu: ${wordy.join(", ")}`);
      return { action: "block", rule: rule.kind, reason: `Cau tra loi co ${parts.join("; ")}.` };
    }

    case "brand_not_carried_needs_catalog": {
      if (!input.claimsBrandNotCarried) return null;
      if (input.catalogSize >= rule.minItems) return null;
      return {
        action: "ask_back",
        rule: rule.kind,
        reason:
          `Muc luc moi co ${input.catalogSize} mon (can it nhat ${rule.minItems}) — ` +
          `chua du de dam noi shop khong kinh doanh hang do.`
      };
    }

    case "forbidden_phrases": {
      const hit = input.pack.identity.neverSay.find((p) => phraseHit(input.draft, p));
      if (hit === undefined) return null;
      return { action: "block", rule: rule.kind, reason: `Cau chua cum bi cam: "${hit}".` };
    }

    case "forbidden_patterns": {
      for (const p of rule.patterns) {
        if (patternHit(input.draft, p)) {
          return { action: "block", rule: rule.kind, reason: `${rule.reason} (khop mau: ${p})` };
        }
        // Van ban shop viet: soi them dang bo dau. Khong so va cham "đôi/đổi" o day
        // vi day khong phai mau cau cua ho so, va mau cam cua nganh thuong la dong tu
        // chuyen mon ("liều dùng", "uống ... viên") chu khong phai tu ban hang thong thuong.
        for (const t of input.toolText ?? []) {
          try {
            if (new RegExp(stripDiacritics(p), "u").test(stripDiacritics(t))) {
              return {
                action: "block", rule: rule.kind,
                reason: `${rule.reason} (khop mau "${p}" trong van ban cua shop)`
              };
            }
          } catch { /* validatePack da bao */ }
        }
      }
      return null;
    }

    default: {
      const unknown: never = rule;
      return { action: "block", reason: `Luat khong hieu duoc: ${JSON.stringify(unknown)}` };
    }
  }
}

export function runGates(input: GateInput): { verdict: GateVerdict; all: GateVerdict[] } {
  const all: GateVerdict[] = [];
  for (const rule of input.pack.gates) {
    const v = evaluateRule(rule, input);
    if (v !== null) all.push(v);
  }
  let worst: GateVerdict = { action: "send", reason: "Khong cong nao can." };
  for (const v of all) {
    if (rank(v) > rank(worst)) worst = v;
  }
  return { verdict: worst, all };
}
