/**
 * @file Industry pack: the replaceable part of the platform.
 *
 * The engine knows NOTHING about shoes, medicine or spas. All industry knowledge lives in a
 * profile of this shape. Selling to a new industry means writing a new pack, never touching
 * the engine.
 *
 * Version 2 (after the 09/09 review) opened four hard-coded places, because the first draft
 * required code changes for any industry not shaped like running shoes, which punctured the
 * sales promise:
 *   - ONE variant axis      -> many axes (a spa needs duration + time slot)
 *   - fixed placeholders    -> the pack declares extra placeholders
 *   - fixed gate rules      -> `forbidden_patterns` lets an industry declare its own rule
 *   - fixed slot names      -> the pack names slots after its axes
 */

import type { ToolName } from "@sp/contract";

// ----------------------------------------------------------------- 1. Identity
export interface PackIdentity {
  /** How the shop addresses the customer: "bac", "anh chi", "quy khach". */
  customerPronoun: string;
  /** How the shop refers to itself: "em", "shop", "ben minh". */
  selfPronoun: string;
  /** A few sentences describing the tone, fed to the model when rephrasing is enabled. */
  tone: string[];
  /** Phrases that must never be said. The `forbidden_phrases` gate reads this list. */
  neverSay: string[];
}

// ----------------------------------------------------------------- 2. Lexicon
export interface PackLexicon {
  /**
   * Brand names of the industry, to RECOGNISE a brand in a customer's message (and search the stock
   * for it). Never a list of what one shop sells: that is the stock (02/10/2026).
   */
  brands: string[];
  /** Categories: "giay chay", "ao gio", ... A category question does not require a specific item. */
  categories: string[];
  /** Common misspellings -> canonical form. Keys are normalised (no diacritics, joined). */
  aliases: Record<string, string>;
  /** Generic words that alone do not identify an item. */
  genericTerms: string[];
  /**
   * FILLER words of follow-up questions: "size 43 THI SAO", "con loai khac nua khong". Never part
   * of an item name IN THIS INDUSTRY. The pack must declare them, because the same word can be an
   * item name elsewhere ("cam", "vang", "day", "moi"): hard-coding them in the engine would make
   * those items unsellable.
   */
  fillerWords?: string[];
}

// ------------------------------------------------------- 3. Item shape
export interface PackAxisCanonical {
  /** Regex run on the normalised label. */
  pattern: string;
  /** Replacement, `$1` refers to a group. */
  replace: string;
}

/**
 * One variant axis. Retail has one axis (size); services usually two (duration + time slot);
 * a pharmacy has two as well (strength + packaging).
 */
export interface PackAxis {
  /** Slot code, also used as slot name in `requiredSlots` and as placeholder in templates. */
  id: string;
  /** Human label: "size", "ham luong", "thoi luong". */
  label: string;
  /** Captures the value from what the customer typed, on NORMALISED text. Group 1 is the value. */
  pattern: string;
  /**
   * Reduces to a canonical form for MATCHING against warehouse labels.
   * "41 ruoi" -> "41.5": the customer and the warehouse spell differently and must still meet.
   * This is where the worst bug lived: a missed match was reported as "out of stock".
   */
  canonical: PackAxisCanonical[];
  /** Examples so the pack author can self-check. The engine runs them at load time. */
  examples: { text: string; expect: string | null }[];
  /** Whether stock can be answered without knowing this axis. */
  requiredForStock: boolean;
}

export interface PackItemShape {
  /** At least one axis. The first is the main axis (used for the default ask-back). */
  axes: PackAxis[];
}

// ------------------------------------------------------------- 4. Intents
/** Slot name. Two are built into the engine; the rest are named by the pack after its axes. */
export type SlotName = "item" | "phone" | (string & {});

export interface PackIntent {
  id: string;
  name: string;
  /** Keywords (no diacritics); each hit scores. */
  keywords: string[];
  /** Extra regexes on normalised text. Score higher than keywords. */
  patterns?: string[];
  /** Keywords that SUBTRACT score, to separate two intents that overlap. */
  negativeKeywords?: string[];
  /** Missing any of these means NO affirmative answer; the bot must ask back. */
  requiredSlots: SlotName[];
  /** Tools to call. Must be in `allowedTools`. */
  tools: ToolName[];
  /** Template when the answer is available. */
  template: string;
  /** Template when a slot is missing. */
  askBackTemplate: string;
  /** Self-check examples: each must resolve to this intent. */
  examples?: string[];
  /**
   * The rule router's intent ids this engine intent answers (`ask_size`, `place_order`, ...). When
   * the router already settled the intent of a turn, the engine takes it through `intentHint`
   * instead of scoring keywords again (25/09/2026).
   */
  routerIntents?: string[];
  /**
   * This intent ALWAYS hands off to a human; the bot never answers it itself.
   * A pharmacy uses it for dosage questions; a clinic for medical questions.
   */
  handoff?: boolean;
}

// --------------------------------------------------------------- 6. Gates
export type GateRule =
  /** No policy claim without a `policy.get` result. */
  | { kind: "require_source_for_claims"; topics: string[]; patterns?: string[] }
  /** No stock answer before the item is identified. */
  | { kind: "require_item_before_stock" }
  /** After asking back once within the window, the second time must hand off. */
  | { kind: "ask_back_once"; windowMinutes: number; maxTimes?: number }
  /** Every number in the reply must come from a tool result. */
  | { kind: "no_unsourced_numbers" }
  /** A sentence containing a forbidden phrase is not sent. */
  | { kind: "forbidden_phrases" }
  /**
   * Industry-specific rule as regexes. A pharmacy blocks dosage advice; a clinic blocks
   * promised treatment outcomes.
   */
  | { kind: "forbidden_patterns"; patterns: string[]; reason: string }
  /** No factual claims while the merchant server is offline. */
  | { kind: "no_facts_when_offline" };

// ---------------------------------------------------------------- 7. Templates
/** Templates every pack must define. Packs may add their own beyond this list. */
export const REQUIRED_TEMPLATES = [
  "greeting", "ask_item", "ask_slot", "handoff",
  "offline", "out_of_stock", "in_stock"
] as const;
export type TemplateKey = (typeof REQUIRED_TEMPLATES)[number];

/**
 * One tool the agent may call. The engine dispatches by name; the handler says WHERE the data comes from.
 *
 * `"landing"` calls a landing API tool (the existing `findStock`, `policy`, `bankAccount` paths).
 * `"static"` returns a fixed text defined in the pack (replaces the old `sizeGuide` field).
 * `"disabled"` tells the model the feature exists but is not available yet (replaces the hardcoded `xem_anh` message).
 */
export interface PackAgentTool {
  /** Tool name as the LLM calls it, e.g. "tra_kho", "bang_size", "bang_gia_thuoc". */
  name: string;
  /** Where the data comes from. */
  handler: "landing" | "static" | "disabled";
  /** How the tool is described to the model, arguments included (`{"tool":"tra_kho","args":{...}}`). */
  moTa: string;
  /** Which landing tool to invoke when handler is "landing". Maps to `AgentToolBox` method. */
  landingMethod?: "findStock" | "policy" | "bankAccount";
  /** Fixed text returned when handler is "static". */
  staticText?: string;
  /** Message shown when handler is "disabled". */
  disabledMessage?: string;
  /** If true, numeric values in the result are registered as known amounts for price validation. */
  tracksAmounts?: boolean;
  /** If true, URLs in the result are registered as allowed hosts for link validation. */
  tracksLinks?: boolean;
}

/**
 * ONE BLOCK of an agent's instructions (24/09/2026, the three tiers).
 *
 * An industry's playbook is no longer one long string: it is a list of blocks, each about one
 * thing (how to ask about needs, how to pick a running-shoe size, apparel...). A shop with real
 * expertise may switch a block off or write its own text in its place — per block, never the
 * whole playbook, so the industry's other blocks keep reaching it, and a block it did not touch
 * still improves when the industry's does. `shopSua: false` marks a block the shop may only add
 * rules beside, never replace (the size formula, the "know distance + pace first" rule).
 *
 * `loiDan` may carry PLACEHOLDERS filled from the shop profile at run time: `{khach}`, `{shop}`,
 * `{tenShop}`, `{site}` and any profile field path such as `{banHang.tiLeCoc}`. A line that starts
 * with `[?banHang.tiLeCoc]` is kept only when that field is set — so an industry text never speaks
 * of a deposit the shop never declared. No shop's own number belongs in a block (the validator
 * refuses percentages, day ranges and money written into industry text).
 */
export interface AgentBlock {
  id: string;
  tieuDe: string;
  shopSua: boolean;
  loiDan: string;
}

/**
 * What the industry suggests a shop fill its profile with, and the policy texts it suggests.
 * Shown on OMI's Chatbot tab beside every field; a shop accepts, edits or leaves it. NEVER read
 * while answering a customer — an unfilled field means "hand over", not "use the suggestion".
 */
export interface ProfileTemplate {
  /** Suggested values by profile field path (`banHang.tiLeCoc` → 20, `xungHo.khach` → "bác"). */
  goiY: Record<string, unknown>;
  chinhSach: { doiTra: string; ship: string; baoHanh: string };
}

/**
 * The AI agent profile of a pack (16/09/2026 — Sales Desk's level-2 agent moved to Xeon).
 *
 * The rule engine answers what it can PROVE (stock, price, orders); the agent answers the rest the
 * way the shop's best salesperson would, calling the same landing tools. Everything here is the
 * INDUSTRY's selling knowledge written as data (tier 2); the platform's conduct is tier 1
 * (`loi-chung/`), the shop's own numbers are tier 3 (its profile on its landing).
 */
export interface PackAgent {
  /** The industry's instruction blocks, in prompt order. */
  khoi: AgentBlock[];
  /** Suggested profile values and policy texts for a new shop of this industry. */
  mauHoSo: ProfileTemplate;
  /** Regex on the accent-stripped customer message: matching messages are NOT given to the agent. */
  mustHumanPattern: string;
  /** Regex on the accent-stripped reply: the agent called a human in, so the merchant is notified. */
  handoffReplyPattern: string;
  /** Tools the agent may call, in order of prompt listing. */
  tools: PackAgentTool[];
}

/**
 * TIER 1's instructions (`loi-chung/agent-chung.json`): what is true of every shop in every
 * industry — write with diacritics, never invent a price, a transfer screenshot goes to a person.
 * The same block shape as an industry's, none of them shop-editable.
 */
export interface CommonAgent {
  khoi: AgentBlock[];
  /** Messages that need a person whatever the industry (complaints, "I already paid"). */
  mustHumanPattern: string;
  /** A reply that says a person will take over, in any industry's words — the shop is then notified. */
  handoffReplyPattern: string;
  /** Phrases no shop may say. */
  cauCam: string[];
  /**
   * 05/10/2026 (phiếu Desk 01/09 "agent và cổng soát thiếu nguồn thật"): tools every industry's agent has — the
   * ones that read the SHOP's own truth (its policy, its account). Listed after the industry's own; an industry
   * declaring a tool of the same name rewrites it. Absent = none.
   */
  tools?: PackAgentTool[] | undefined;
  /**
   * What the agent is told when it SEES the customer's photos itself (02/10/2026: measured 87%
   * right against 72% for a note-only agent, none wrong). Absent = the built-in wording.
   */
  xemAnh?: CommonPhotoTexts | undefined;
}

/** Tier 1's words for an agent that sees photos: its capability line, its look-again tool, the reminder after a picture. */
export interface CommonPhotoTexts {
  /** The capability line that replaces "the system read the photo before the turn". */
  nangLuc: string;
  /** How the look-again tool is described in the tool protocol (`{"tool":"xem_anh","args":{"url":"..."}}`). */
  congCu: string;
  /**
   * Sent after the pictures on every call: some models answer a picture with a native function call
   * the gateway cannot carry (`malformed_function_call`, an empty answer about half the time).
   */
  nhacSauAnh: string;
  /** The caption right before the customer's photo. */
  chuThichAnh: string;
}

export interface IndustryPack {
  id: string;
  name: string;
  identity: PackIdentity;
  lexicon: PackLexicon;
  itemShape: PackItemShape;
  intents: PackIntent[];
  /**
   * Default intent when the customer ONLY names an item without asking anything specific.
   *
   * The first thing real customers type is "shop oi co Adizero Boston 13 khong": no keyword of
   * any intent, yet everyone understands it as a stock question. Without this field the bot only
   * greets, and the following "42" falls into the void. The pack declares it, because "what
   * naming an item means" is industry knowledge (at a pharmacy it is also a stock question; at a
   * service business it may be a booking).
   */
  intentWhenItemNamed?: string;
  /** Tools this pack may call. Intersected with the licence to get the real list. */
  allowedTools: ToolName[];
  gates: GateRule[];
  /** Regex patterns on normalised text that indicate the customer is referring to an image. When matched, burst wait adds extra time for image loading. */
  imageReferencePatterns?: string[];
  /**
   * Pack-specific placeholders WITH their static values.
   * Earlier only NAMES could be declared with no way to fill them, so using one turned every
   * reply into a handoff: a trap, and the validator's message pointed straight into it.
   */
  extraValues?: Record<string, string>;
  templates: Record<string, string>;
  /** AI agent profile. Absent = this industry is answered by the rule engine alone. */
  agent?: PackAgent;
  /**
   * The industry's part of the dialogue frame / episode config (`khung-hoi-thoai.json`): how the
   * page asks for the variant, what a bare variant answer looks like, the shape of a product code.
   * Merged ON TOP of tier 1's (`loadDialogueConfig`). Absent = tier 1 alone.
   */
  dialogue?: DialogueConfig;
  /** The industry's wording of the system note blocks (`ghi-chu-he-thong.json`), overriding tier 1's per key. */
  systemNote?: SystemNoteTexts;
  /** The industry's intent keywords (`y-dinh.json`), concatenated onto tier 1's per intent. */
  intentRules?: IntentRules;
  /** The industry's entity patterns (`thuc-the.json` + `bang-size.json`), merged onto tier 1's. */
  entities?: EntityConfig;
  /** The industry's scripted replies (`kich-ban.json`), overriding tier 1's per key. */
  scripts?: ScriptTexts;
  /** The industry's catalog-matching data (`cham-diem.json`: noise words, brand hints, type rules), merged onto tier 1's. */
  matching?: MatchingConfig;
  /** The industry's part of the reply gate (`cong-soat.json`: stock wording, size steps, warranty), merged onto tier 1's. */
  replyGate?: ReplyGateConfig;
}

// ------------------------------------- 8. Tier 1 of Sales Desk (24/09/2026): frame, episode, ledger, note
/**
 * The soft shopping episode (Desk `episode_tracker.js`): every regex and label as data. A 6-hour
 * silence only makes the episode STALE; it is closed when the customer names another item, so
 * "đôi này" after a night still points at yesterday's item.
 */
export interface EpisodeConfig {
  /** Customer drops the current item ("thoi", "doi khac", "mau khac"). On accent-stripped text. */
  dismiss: string;
  /** The message STARTS with a dismissal — the focus is emptied without a replacement. */
  dismissLeading: string;
  /** Customer only compares ("so voi", "thi sao"): a named item is NOT the new focus. */
  compare: string;
  /** "mua lai", "lay lai": the shoe currently worn is being bought again, so it may be the focus. */
  rebuy: string;
  /** A page line that confirms an order was placed ("XÁC NHẬN ĐƠN HÀNG", "#ORD-…"). */
  orderConfirmed: string;
  /** Intents that move the focus to a newly named item (ask size / place order / send image). */
  transactionalIntents: string[];
  /** Intents that put the episode in the "chot" stage. */
  closingIntents: string[];
  /** Conversation states that mean checkout in progress. */
  checkoutStates: string[];
  /** Conversation states that mean the order was placed. */
  placedStates: string[];
  /** Intents that, once closing, move the episode to "after order" (payment, shipping). */
  afterOrderIntents: string[];
  roleLabels: Record<string, string>;
  stageLabels: Record<string, string>;
  outcomeLabels: Record<string, string>;
  /** Prompt sentences (`justOpened`, `current`, `focus`, `others`, `past`, `gapNote`, …). */
  texts: Record<string, string>;
}

/**
 * The dialogue frame (Desk `dialogue_frame.js`): a terse customer message ("42", "ok", "mau nay")
 * is read as the ANSWER to what the page just said. Tier 1 holds the generic patterns; the
 * industry adds how the page asks for its variant and what a bare variant answer looks like.
 */
export interface DialogueConfig {
  /** Kinds tried in this order on the page's last text; the first whose patterns hit wins. */
  pageTurnOrder: string[];
  /** Regexes per kind, on accent-stripped text. Lists of tier 1 and the industry are concatenated. */
  pageTurn: Record<string, string[]>;
  /** The page asked something not covered above (ends with "?" / "khong"). */
  askedOther: string[];
  /**
   * 05/10/2026: the page asked to SEE what the customer uses now / its label (a reference to measure by),
   * on accent-stripped text; tier 1 and the industry are concatenated. A photo sent next is a reference.
   */
  askedReference?: string[] | undefined;
  /** Customer agrees, on the ORIGINAL text (diacritics kept), case-insensitive. */
  ack: string;
  deny: string;
  /** Customer points at the item the page just sent ("doi nay", "mau do"). */
  refer: string;
  /** The message is nothing but a variant value ("42", "44 2/3"). Industry-owned. */
  sizeOnly: string[];
  /** Shape of a product code in a page message. Industry-owned. Group 1 is the code. */
  productCodePatterns: string[];
  /** Product links of the platform's landing (`?p=`, `/product/<slug>`). Group 1 is the code. */
  productLinkPatterns: string[];
  /** Texts that stand for an attachment, not a sentence ("[page gửi ảnh]"). */
  imagePlaceholders: string[];
  /** Words that never identify an item when matching the customer's text against a name. */
  nameNoiseWords: string[];
  shortAnswer: { maxWords: number; maxChars: number };
  kindTexts: Record<string, string>;
  answerTexts: Record<string, string>;
  aboutTexts: Record<string, string>;
  frameFormat: string;
  episode: EpisodeConfig;
}

/** Wording of the conversation ledger and of image labels (`loi-chung/so-hoi-thoai.json`). */
export interface LedgerTexts {
  header: string;
  externalClosingNote: string;
  ordersHeader: string;
  orderTracking: string;
  summariesHeader: string;
  customerGoal: string;
  openThread: string;
  fieldLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  sourceLabels: Record<string, string>;
  /** Intent id → ledger status ("place_order" → "chot"). */
  statusByIntent: Record<string, string>;
  stockAnswers: Record<string, string>;
  alternativeNote: string;
  unmatchedNote: string;
  /** A "product name" that is really an acknowledgement or small talk ("dung roi", "cam on"). */
  notProductPatterns: string[];
  /** A "product name" that is really an address. */
  addressPatterns: string[];
  receiptTextPatterns: string[];
  receiptAmountPattern: string;
  receiptOrderPattern: string;
  imageLabels: Record<string, string>;
}

/** The system note blocks (`ghi-chu-he-thong.json`): order and one template per block key. */
export interface SystemNoteTexts {
  order: string[];
  blocks: Record<string, string>;
}

// ------------------------------ 9. Tier 1 of Sales Desk, stage 2 (24/09/2026): intents, entities, scripts
/** One keyword rule of the intent classifier (Desk `INTENT_RULES`): whole-word keywords on accent-stripped text. */
export interface IntentRule {
  intent: string;
  /** Base confidence; `0` in an industry file means "keep tier 1's". */
  confidence: number;
  keywords: string[];
}

/** Patterns of the deposit question detector (Desk `detectDepositInstruction`). */
export interface DepositPatterns {
  moneyWords: string;
  pastPayment: string;
  asksCondition: string;
  orderTalk: string;
  /** The customer asks FOR the account ("gửi mình số tài khoản để chuyển cọc"): `asks_bank_info`, never a deposit question (kb2-20). */
  asksAccount: string;
}

/** Patterns of the payment conversation frame (Desk `resolvePaymentConversationFrame`). */
export interface PaymentFramePatterns {
  moneyTalk: string;
  explicitlyAsksBank: string;
  pastPayment: string[];
  dispute: string;
  receiptSeen: string;
  collected: string;
  historyDepth: number;
}

/** Patterns of the reconciliation with the model's intent (Desk `routeCustomerMessage`, lines 571–660). */
export interface ReconcilePatterns {
  /** Local intents whose script beats the model's classification. */
  scriptOverrideIntents: string[];
  /** …unless the message also carries a request (then these do NOT win). */
  scriptOverrideUnlessRequest: string[];
  /** The message carries a request/question beyond small talk. Lists are concatenated. */
  carriesRequest: string[];
  smallTalkMaxWords: number;
  /** "ban oi", "alo", "..." — a nudge when the page has not answered. */
  nudge: string;
  /**
   * The bot's reply asks the customer to MEASURE (foot length in cm, the tag): the landing then sends
   * its measuring-guide picture with the reply (Giai đoạn 7). Industry wording; "" = never.
   */
  asksFootMeasure: string;
  /**
   * A QUESTION about a policy ("có bảo hành không", "đổi size thế nào") is the agent's, with the
   * policy tool in hand — not a person's (25/09/2026, kb2-08). Regex on accent-stripped text.
   */
  policyQuestionForm: string;
  /** The customer is impatient ("trả lời chậm quá, có bán không thì bảo"): a short apology, then the business (kb2-15). */
  impatience: string;
  /** A REAL return / exchange (goods in hand: "mình muốn trả lại", "nhận hàng bị lỗi"): a person, whatever the form of the sentence. */
  returnExchangeReal: string;
  /** The page's last text was a question (on accent-stripped text). */
  pageAsked: string;
  /** "da vang a" / "ko e" as an ANSWER to the page's question (original text, case-insensitive). */
  shortAnswerToPage: string;
  /** A bare acknowledgement after anything the page said (original text, case-insensitive). */
  bareAck: string;
  thanks: string;
  /** The page (a person) confirmed payment was received. */
  pageSaidPaid: string;
  customerReceiptImage: string;
  buysMore: string;
  asksForPhotos: string;
  adviceRequest: string;
  paymentContextCustomer: string;
  paymentContextPage: string;
  sadPhrase: string;
  policyQuestion: string;
  shippingFee: string;
  /**
   * 05/10/2026 (phiếu Desk "bot xác nhận màu thay khách"): the customer REJECTS the item / colour the page
   * showed ("không phải màu này", "sai mẫu", "màu này chứ") — before buying it is a sign the match was
   * wrong, not a question to reassure. Lists are concatenated (the industry adds its nouns).
   */
  productRejection: string[];
  /** …but the goods were already received ("nhận hàng", "giao tới"): that is a complaint, not a rejection. */
  afterReceipt: string;
}

/**
 * The intent classifier's data (`y-dinh-chung.json` ⊕ `y-dinh.json`). Every regex runs on
 * accent-stripped text unless the field says otherwise.
 */
export interface IntentRules {
  rules: IntentRule[];
  /** Intents that beat small talk in one message ("ok shop toi lay mau nay"). */
  transactionalIntents: string[];
  greetingTokens: string[];
  greetingMaxWords: number;
  /** Customer says money was ALREADY sent (Desk `PAID_MONEY_RE`). */
  paidMoney: string;
  /** …but the sentence is about goods, not money (Desk `PAID_ABOUT_GOODS_RE`). */
  paidAboutGoods: string;
  deposit: DepositPatterns;
  paymentFrame: PaymentFramePatterns;
  reconcile: ReconcilePatterns;
}

export interface AddressPatterns {
  /** "dia chi:", "ship ve" … on the ORIGINAL text, case-insensitive; what follows is the address. */
  markers: string;
  placeWords: string;
  houseNumber: string;
  maxLength: number;
  minWords: number;
  /** Bigrams that look like a place word but are not ("quan short" is trousers, not a district). */
  notPlaceBigrams: string[];
}

export interface BudgetPatterns {
  trigger: string;
  amount: string;
  millionUnits: string[];
  thousandUnits: string[];
  minValue: number;
  range: string;
  from: string;
  upTo: string;
}

/** Guards of the bare tag-size reading ("size 28" of an adult shoe = 28cm on the tag; Desk `resolveBareJapaneseSize`). */
export interface BareTagPatterns {
  range: string;
  maxTem: number;
  unitAfter: string;
  notBefore: string;
  footMeasure: string;
  tagWord: string;
  kidsText: string;
  apparelWords: string;
  kidsLine: string;
  adultMin: number;
  historyDepth: number;
}

/** One row of the tag → size chart (`bang-size.json`). */
export interface SizeChartRow {
  /** Centimetres printed on the tag (JP). */
  tem: number;
  size: string;
  daiChanCm: number;
}

/** The entity extractor's data (`thuc-the-chung.json` ⊕ `thuc-the.json` ⊕ `bang-size.json`). */
export interface EntityConfig {
  phone: string;
  productCodeFallback: string;
  productCodeIgnore: string[];
  productCodeNotCode: string[];
  nameNoiseWords: string[];
  /**
   * The message is about an ORDER or an exchange ("đơn của tôi đổi size 43"): no product-name hint
   * is read from it — "don cua toi sang duoc 13" once became a finder query (25/09/2026).
   */
  orderTalk: string;
  address: AddressPatterns;
  budget: BudgetPatterns;
  /** Label → regex ("Nữ" → `\b(nu|women|…)\b`). */
  genders: Record<string, string>;
  closingSignals: string[];
  sizeLetterPattern: string;
  sizeRecoverPattern: string;
  sizeRecoverNegation: string;
  sizeRecoverDepth: number;
  /** Industry: the size number with its 1/3 and half steps; `{core}` in the patterns below stands for it. */
  sizeCore: string;
  sizePatterns: string[];
  sizeTagPatterns: string[];
  sizeBarePatterns: string[];
  apparelSizePatterns: string[];
  apparelSizePrefix: string;
  /**
   * 05/10/2026 (phiếu Desk 26/09): a size said WITH its system ("US 9", "9us", "UK 7.5", "US W 7") — named
   * groups `he` (system), `so` (number), optional `gioi` (a women's / men's word). Read as "<HE> [W|M] <so>" so
   * the landing's finder converts it through the item's own brand chart. Empty = no system read.
   */
  sizeSystemPatterns: string[];
  bareTag: BareTagPatterns;
  needs: string[];
  footForms: Record<string, string[]>;
  sizeChart: SizeChartRow[];
}

export type ScriptAction = "script_reply" | "human_handoff" | "ask_clarification";

/** One scripted reply; `safeToAutoSend` defaults to `true` for a script reply and `false` for a handoff. */
export interface ScriptEntry {
  action: ScriptAction;
  reply: string;
  safeToAutoSend?: boolean | undefined;
}

/** The scripted replies (`kich-ban-chung.json` ⊕ `kich-ban.json`): keyed by script id, plus the ask-back sentences by reason. */
export interface ScriptTexts {
  scripts: Record<string, ScriptEntry>;
  hoiLai: Record<string, string>;
}

// ------------------------------ 10. Stage 3 of tier 1 (25/09/2026): catalog scoring, the uncertain-product gate, stock facts
/** One rule that names a product TYPE from its name ("dep": slide / sandal / dép…). Patterns run on accent-stripped text. */
export interface TypeRule {
  kind: string;
  patterns: string[];
}

/** Product-type knowledge of an industry (Desk `product_match.js` TYPE_RULES + NON_FOOTWEAR_TYPES + LANDING_TYPE_BY_KIND). */
export interface TypeRules {
  rules: TypeRule[];
  /** Word the customer says (accent-stripped) → canonical kind ("ao gio" → "ao"). */
  aliases: Record<string, string>;
  /** Kinds that are NOT the industry's main item: a category question about them gets a link, not an ask-back. */
  nonPrimaryTypes: string[];
  /** The industry's main kinds ("giay", "dep"): an anchor of one of these on a non-primary question is wrong. */
  primaryTypes: string[];
  /** Kind → label the storefront filters by ("quan" → "Quần áo"). */
  labels: Record<string, string>;
}

/** Patterns of the "does the customer point at ONE specific item?" test and the gate's timing (Desk `refersToSpecificItem`). */
export interface UncertainPatterns {
  /** Intents that ask about ONE item, so the item must be known (place_order, ask_size, ask_price…). */
  askProductIntents: string[];
  /** Intents that talk about products at all (the type-mismatch gate applies only here). */
  productTalkIntents: string[];
  /** Silence after which a bare emoji is "lost", and the image look-back that still counts as evidence. */
  coldHours: number;
  imageLookbackMinutes: number;
  specificItem: string;
  /** On the ORIGINAL text (diacritics kept), unicode flag. */
  specificItemDiacritic: string;
  specificItemNoun: string;
  categoryQuestion: string;
  sizeHint: string;
  /** Tokens of a "product name" that identify nothing on their own ("giay chay nam"). */
  genericItemTokens: string[];
}

/** How warehouse size labels are read (Desk `normalizeSize` / `apparelSizeKey` / `nearestSizeStock`). */
export interface SizeReading {
  /** Prefix stripped from apparel labels ("A/88" → "88"). */
  apparelPrefix: string;
  /** A letter size (S / M / 2XL / OS) — compared as text, never as a number. */
  letterSize: string;
  /** Numeric labels closer than this are the same step (42.5 ≈ 42 2/3). */
  tolerance: number;
  /** A bare number at or above this is an apparel size (waist "88"), never a shoe size. */
  apparelMin: number;
}

/**
 * The catalog-matching data (`cham-diem-chung.json` ⊕ `cham-diem.json`): the weights and thresholds
 * of Desk `scoreProduct` / `retrieveCatalog`, the words that identify nothing, the brand a line name
 * implies, the type rules and the uncertain-product patterns. Every regex runs on accent-stripped
 * text unless the field says otherwise.
 */
export interface MatchingConfig {
  /** codeExact, codePartial, line, version, versionMissing, brand, type, nameExact, nameWithin, nameContains, nameStrong, namePartialRare, namePartial, size, sizeAdvice, color, need, own, partner. */
  weights: Record<string, number>;
  retrieve: { minScore: number; band: number; limit: number };
  /** Words of a customer's product hint that never identify an item (Desk `isNoisyProductToken`). */
  noiseTokens: string[];
  /** Words too common to count as a name hit ("air", "pro", "max"). */
  genericNameTokens: string[];
  /** Words of a LINE name that are not distinctive ("pro" in "adios pro"). */
  lineGenericTokens: string[];
  /** Words dropped when comparing two product names as lines (Desk `NOISE_LINE_TOKENS`). */
  lineNoiseTokens: string[];
  /** A token that looks like a SKU inside a name ("FZ2158-301"), ignored when reading a version. */
  skuLikePattern: string;
  /** Versions in this range cannot be told from a size ("boston 42"), so they demote instead of dropping. */
  ambiguousVersion: { min: number; max: number };
  /** Brand → line words that imply it ("adizero" → adidas), for products whose brand field is empty. */
  brandLineHints: Record<string, string[]>;
  /** Gender key ("M" / "W") → regex on the accent-stripped name. */
  genderTokens: Record<string, string>;
  types: TypeRules;
  /**
   * 05/10/2026: the industry's EVERYDAY words for the storefront's groups (`nhomHang` in `cham-diem.json`):
   * how customers say a group → the group's label. Xeon sends them with every stock search; the landing only takes a word whose
   * group its own catalog carries. A key with accents matches words typed with accents only.
   */
  groups: { aliases: Record<string, string>; notGroup: string[] };
  /**
   * 05/10/2026 (phiếu Desk 05/09 "còn màu khác không"): regexes (accent-stripped) of a question
   * about the OTHER variants of the item in focus (`hoiBienTheKhac`; tier 1's general words ⊕ the industry's nouns).
   */
  otherVariantsAsked: string[];
  sizes: SizeReading;
  uncertain: UncertainPatterns;
  /** Prompt wording of the stock facts (`otherKho`, `inStock`, `outOfStock`, `houseKho`, `partnerKho`). */
  texts: Record<string, string>;
}

/** Everything tier 1 ships (`loi-chung/`), parsed once. */
export interface CommonPack {
  agent: CommonAgent;
  dialogue: DialogueConfig;
  ledgerTexts: LedgerTexts;
  noteTexts: SystemNoteTexts;
  intentRules: IntentRules;
  entities: EntityConfig;
  scripts: ScriptTexts;
  matching: MatchingConfig;
  /** Stage 6 (25/09/2026): the reply gate after the draft. */
  replyGate: ReplyGateConfig;
}

// ------------------------------ 11. Stage 6 of tier 1 (25/09/2026): the reply gate AFTER the draft
//
// Desk `ai_fallback.js` `enforceReplyEvidence` + `ai_fallback_gate.js` `enforcePolicyClaims` +
// `payment_claim_kit.js` as DATA: every regex and every replacement sentence lives in
// `loi-chung/cong-soat-chung.json` (what is true of every shop) and `nganh/<id>/cong-soat.json`
// (what only this industry says: stock wording, size steps, warranty, the shoe being worn). Regexes
// run on the accent-stripped reply unless the field says "diacritic". Replacement sentences carry
// `{khach}` `{Khach}` `{shop}` `{site}` `{tenShop}` `{tenNguoiPhuTrach}` and rule-specific slots.

/** The bot claims to be a person ("em là người thật"). */
export interface ReplyGateIdentity {
  falseHuman: string[];
  replacement: string;
}

/** Desk `payment_claim_kit.js`: the bot never says the money arrived. `{money}` in a claim stands for `money`. */
export interface ReplyGatePayment {
  money: string;
  claims: string[];
  notClaimWindow: string;
  refund: string;
  customerReceives: string;
  shopPays: string;
  customerAsks: string;
  fillerWords: string[];
  affirm: string;
  notAffirm: string;
  orderActions: string;
  /** Chat shorthand → full word before matching ("r" → "roi", "dc" → "duoc"). */
  abbreviations: Record<string, string>;
  /** The neutral sentence that replaces a claim (Dũng, 24/09/2026). */
  pendingText: string;
  handoffReason: string;
  /**
   * 05/10/2026: the draft asserts the CUSTOMER's money already went ("tiền cọc mình đã chuyển sẽ được
   * trừ…") — the same claim seen from the other side. Allowed only with evidence: a person on duty said
   * the money came, or an order certainly linked to the conversation carries a paid amount.
   */
  customerPaid: string[];
}

/** At closing the SYSTEM sends the order form: the bot must not ask for a phone number itself. */
export interface ReplyGateContact {
  asks: string;
  contact: string;
  formNote: string;
  /** Accent-stripped marker: the note is not appended twice. */
  formNoteMarker: string;
  /** When the shop closes through a person (`banHang.khiChot = goi-nguoi`). */
  personNote: string;
  /**
   * 05/10/2026 (phiếu Desk "thẻ đặt hàng không đi"): accent-stripped — a sentence that PROMISES the order
   * form ("em gửi phiếu bên dưới"). Checked AFTER the landing answered: no form went → the sentence is cut.
   */
  formPromise: string;
  /** The promise was cut and nothing is left, and no item is settled yet: ask which item / variant. */
  askItem: string;
}

/** Warranty / authenticity promises without a source. `cut` runs on the DIACRITIC reply (flags giu). */
export interface ReplyGateWarranty {
  detect: string;
  sourceWords: string[];
  cut: string[];
  fallback: string;
  percentAuthenticity: string;
  percentSource: string;
}

export interface ReplyGateDeposit {
  context: string;
  money: string;
  fallback: string;
}

export interface ReplyGateMoney {
  /** Amounts below this are not prices (sizes, days, "5k" jokes). */
  minAmount: number;
  fallback: string;
  /** "từ X đến Y" on the original reply (two groups); X = Y collapses to one price. */
  rangeSame: string;
}

export interface ReplyGateExchange {
  promise: string;
  policyWords: string;
  orderItemNote: string;
  noPolicyNote: string;
  /** "em đã đổi sang size 40 cho bác rồi" — the bot has no tool to edit an order. */
  done: string;
  doneNote: string;
  /**
   * 05/10/2026 (phiếu Desk "agent thấy transcript thô"): a reply that only says YES ("Dạ đúng rồi ạ") to a
   * customer asking whether they can exchange (`policyWords` in their message) promises exactly the same.
   */
  affirm: string;
  /**
   * 05/10/2026 (phiếu Desk 31/08, soát lại): the ASSERTED form "đổi <thing> được" — a tier 1 pattern on the
   * reply AS WRITTEN (accents: "đổi" ≠ "đôi", flags `iu`) whose `{doiTuong}` is the alternation of `affirmedObjects`; a question ("… được không")
   * or a refusal ("không đổi … được") is not one. The things are words: tier 1's for every trade, the industry's
   * own added on top (lists concatenate).
   */
  affirmed: string;
  affirmedObjects: string[];
}

export interface ReplyGatePhotos {
  asks: string;
  promise: string;
  lead: string;
  leadMany: string;
  noProduct: string;
  maxLinks: number;
  /** "bấm vào link để xem ảnh" — a sentence that sends the customer to a link for pictures when the LANDING already sends the cards (Giai đoạn 7). */
  linkClaim: string;
  /** What replaces a reply that was only such a sentence. */
  cardsNote: string;
}

/**
 * 05/10/2026: a pronoun that reads like a content word once accents are stripped (Vietnamese "anh" the
 * pronoun vs "ảnh" a photo). An occurrence typed WITHOUT its accent is the pronoun unless the words
 * around it are surely about photos; it is then masked to `replacement` before the photo patterns run.
 */
export interface ReplyGatePronoun {
  /** The ambiguous word as typed without accents ("anh"). Empty = the rule is off. */
  word: string;
  /** What a pronoun occurrence becomes ("minh") — a word no photo pattern reads. */
  replacement: string;
  /** After the word (accent-stripped): surely a photo ("that", "chi tiet"…), in any typing. */
  photoAfter: string;
  /** A message typed with no accent at all: a request verb right before AND a fitting word after. */
  askBefore: string;
  askAfter: string;
  /** Same, for "send" verbs, which also take a person ("gửi anh về địa chỉ cũ"). */
  sendBefore: string;
  sendAfter: string;
  /** On the ORIGINAL text right after a pronoun: the accented photo word ("ảnh") — the pronoun is dropped so "gửi anh ảnh" reads "gửi ảnh". */
  photoNext: string;
}

/**
 * 05/10/2026: a reply that says an item is OUT OF STOCK when it is the very item (code + size) of the
 * running order linked to the conversation — the order holds it, that is why it is "out". The clause
 * becomes "already in the order", the alternative suggestion after it goes.
 */
export interface ReplyGateOrderedItem {
  /** The clause says out of stock / sold out (accent-stripped). */
  outOfStock: string[];
  /** "mẫu này" — a reference to the item in focus, not a name. */
  deictic: string[];
  /** The clause / sentence after it offers something else instead. */
  alternative: string;
  /** The clause names a size / variant at all. */
  mentionsVariant: string;
  /** The customer said they BUY MORE (a buying verb + more), after the order was placed. */
  buysMore: string;
  /** {ten} {ma} {size} {maDon} {giaiDoan} {khach} {Khach} {shop}. */
  replacement: string;
  /** Stage → words the customer reads. */
  stageLabels: Record<string, string>;
}

export interface ReplyGateLink {
  /** Hosts always allowed beside the shop's own site (m.me, localhost). */
  allowedHosts: string[];
  /** Carrier tracking pages: not "someone else's site" when the customer asks where the parcel is. */
  carrierHosts: string[];
  /** A product code standing alone inside a foreign link (group 1); the link is rebuilt on the shop's site. */
  codeInLink: string;
  /** `https://{site}/product/{ma}`. */
  productLink: string;
}

export interface ReplyGateEta {
  pattern: string;
  fallback: string;
}

export interface ReplyGateTracking {
  asksShipment: string;
  trackingWords: string;
  aboutOrder: string;
  orderNoun: string;
  orderVerb: string;
  addedText: string;
  /** A tracking code inside a carrier link ("SPXVN0636…"). */
  carrierCode: string;
  handoffReason: string;
}

export interface ReplyGateAdvice {
  replacement: string;
}

/** Desk `enforceReplyEvidence`: stock, order status, deferred payment, the shoe being worn, alien codes, prices. */
export interface ReplyGateEvidence {
  /** Words dropped before comparing a bot fragment with what the person on duty said. */
  fillerWords: string[];
  /** Shape of a product code in the reply (upper-case text). */
  codePattern: string;
  stockAssert: string;
  /** `{size}` = the requested size, escaped. */
  saysOut: string[];
  saysIn: string[];
  inStockReply: string;
  outOfStockReply: string;
  outOfStockColorsReply: string;
  colorsAsked: string;
  topicReply: string;
  topicColorsReply: string;
  discovery: string;
  discoveryLinkReply: string;
  discoveryAskReply: string;
  orderClaim: string;
  phone: string;
  orderCheckReply: string;
  orderAskPhoneReply: string;
  defer: string;
  customerAsksDefer: string;
  agreesShip: string;
  agreesShipUnless: string;
  deferReply: string;
  wantsDifferent: string;
  recommendVerbs: string;
  /** Brand words that do not identify the shoe being worn. */
  brandStop: string[];
  currentShoeReply: string;
  alienReply: string;
  /** Money words before an amount: a deposit or a fee, not a price. */
  moneyContext: string;
  priceAgree: string;
  priceAgreeReply: string;
  variantDivergence: string;
  variantReply: string;
}

/** Foot length in cm → size from the industry's chart; a size converted without a chart is unsourced. */
export interface ReplyGateSizeChart {
  customerCm: string;
  sizeInReply: string;
  mentionsSize: string;
  hedge: string;
  askBack: string;
  /**
   * 05/10/2026 (phiếu Desk 26/09 "cổng size thay mọi size trong tin"): on the ORIGINAL sentence (flags
   * `iu`), the words that make it a conversion from a measurement ("chân"). Only such a sentence — or
   * one quoting the customer's own measurement — is repaired; a stock sentence beside it is not.
   */
  conversion: string;
  /** On the original text (flags `giu`): a variant the BOT names after an advice cue; group 1 + 2 = the label. */
  botVariant: string;
  /** On the original text (flags `giu`): every variant label the CUSTOMER typed; group 1 + 2 = the label. */
  customerVariant: string;
  /** On the original sentence (`iu`): an advice verb ("nên", "lấy") … */
  adviceVerb: string;
  /** … unless a stock word says it is about stock ("còn", "hết"). */
  stockWord: string;
  /** The measurements are missing: the sentence that asks for them ({thieu} = what is missing, {daCo} = what was given). */
  askMeasures: string;
  /** The same, short, when someone already asked once (`askedBefore` in what the page said). */
  askMeasuresShort: string;
  askedBefore: string;
  /** The reply already asks for the measurements (normalised): nothing is added. */
  alreadyAsks: string;
  /** A cut sentence carried a shop link: it stays, without its variant ({link}). */
  linkLine: string;
}

/**
 * 05/10/2026 (phiếu Desk 01/09 "cổng không kiểm cặp size ↔ cm ↔ tem ↔ UK"): every PAIR the bot writes —
 * a variant label beside a centimetre value, a variant label beside another system's label — must be
 * one row of the brand's chart. Tokens are read on the ORIGINAL reply; pairs are neighbours only.
 */
/**
 * 05/10/2026 (phiếu Desk 01/09: the warehouse returned one label and the model wrote a range of others it inferred): a variant label the
 * draft names must be one the stock lookups of the turn returned, or one the customer said — never a range
 * the model inferred. `label` (accent-stripped reply) captures the label's key in group 1 (tier 2: how the
 * industry writes such labels); `note` replaces a reply that was only invented labels. Empty `label` = off.
 */
export interface ReplyGateStockLabel {
  label: string;
  note: string;
}

export interface ReplyGateSizePair {
  /** A variant label token (`giu`); group 1 + 2 = the label. */
  size: string;
  /** A measurement token (`giu`); group 1 = the number. */
  unit: string;
  /** On the ~18 letters before a measurement token (`iu`): it is the BODY measurement (a foot length). */
  bodyLead: string;
  /** … it is the TAG value. */
  linkLead: string;
  /** … it measures something else (a box, a sole): never paired. */
  noiseLead: string;
  /** Normalised gap words that break a pair ("hoặc", "và"). */
  gapStop: string;
  /** Normalised text right before a label that makes it a variant ("size", "EU") — needed to pair with another system. */
  prefix: string;
  /** Other label systems: id → regex (`gi`) whose group 1 is the number ({ "uk": "\\bUK\\s*(\\d…)" }). */
  alt: Record<string, string>;
  /** Normalised forward gap allowed from another system's label to the variant ("tương đương"). */
  altForward: string;
  /** Normalised: what may follow a number the customer typed for it NOT to be a variant / measurement ("k", "tuổi"). */
  customerNotNumber: string;
  /** Normalised: a women's item; with `variantWomenDiffer` no pair is checked. */
  women: string;
  /** Normalised: "nam nữ" (unisex) is not a women's item. */
  unisex: string;
  /** Normalised: what joins the two ends of a range ("–", "đến"); a label inside a range is never paired. */
  rangeJoin: string;
}

/** Links the pipeline prepared and the model forgot (Desk `server.js` after level 2). */
export interface ReplyGateAppendLinks {
  lineText: string;
  groupText: string;
  filterText: string;
}

/**
 * 05/10/2026 (phiếu Desk "khẳng định đúng là mẫu từ ảnh khách" + "bot xác nhận màu thay khách"): a match
 * from the customer's photo is a GUESS. While a customer photo is in play, a sentence that asserts the
 * photo IS the shop's item ("đúng là / chính là mẫu … bên em", "đúng màu", "giống hệt") is rewritten to a
 * likeness, or cut, and the customer is asked to confirm on the shop's picture. Exempt: a question, a
 * hedge, a code the customer typed or that is PRINTED on the photo, a sentence a person on duty said.
 */
export interface ReplyGatePhotoClaim {
  /** Accent-stripped: the sentence asserts sameness with the customer's photo. */
  claims: string[];
  /** Accent-stripped, on the text right BEFORE the claim: a negation / hedge ("chưa chắc", "có phải"). */
  hedgeBefore: string;
  /** Accent-stripped, on the whole sentence: a question to the customer, not an assertion. */
  question: string;
  /** On the ORIGINAL sentence (flags giu): pattern → replacement ("Đúng là mẫu" → "nhìn giống mẫu"); what still claims after it is cut. */
  rewrite: Record<string, string>;
  /** Accent-stripped: the reply already asks the customer to confirm. */
  confirmAsked: string;
  /** The ask appended when the shop's pictures go with the reply (cards). */
  confirmCards: string;
  /** The ask appended when no picture goes with the reply. */
  confirmNoCards: string;
}

/**
 * 05/10/2026 (phiếu Desk "cổng chống thúc ép chốt cắt oan"): a customer with no sign of buying is not
 * pushed to close. Only the PUSH clause goes ("chốt lấy không ạ", "em lên đơn nhé"); a CONDITION that
 * explains the process ("bác chốt thì em đặt") stays; a reply that is nothing but push is kept whole and
 * a person is called — never a farewell sentence in place of an answer.
 */
export interface ReplyGatePushClose {
  /** Accent-stripped: an invitation to close / the bot announcing it places the order. */
  push: string[];
  /** Accent-stripped: a condition clause ("… chốt thì em đặt", "khi … cọc"), not a push. */
  condition: string;
  /** Accent-stripped, on the customer's recent words: already thinking of buying (stock, size, time, ship, pay…). */
  buySignal: string;
  handoffReason: string;
}

/** Everything the reply gate reads (`cong-soat-chung.json` ⊕ `cong-soat.json`). An empty pattern switches its rule off. */
export interface ReplyGateConfig {
  identity: ReplyGateIdentity;
  payment: ReplyGatePayment;
  contact: ReplyGateContact;
  warranty: ReplyGateWarranty;
  deposit: ReplyGateDeposit;
  money: ReplyGateMoney;
  exchange: ReplyGateExchange;
  photos: ReplyGatePhotos;
  link: ReplyGateLink;
  eta: ReplyGateEta;
  tracking: ReplyGateTracking;
  advice: ReplyGateAdvice;
  evidence: ReplyGateEvidence;
  sizeChart: ReplyGateSizeChart;
  sizePair: ReplyGateSizePair;
  stockLabel: ReplyGateStockLabel;
  appendLinks: ReplyGateAppendLinks;
  daiTu: ReplyGatePronoun;
  orderedItem: ReplyGateOrderedItem;
  photoClaim: ReplyGatePhotoClaim;
  pushClose: ReplyGatePushClose;
  photoAgain: ReplyGatePhotoAgain;
  priceStory: ReplyGatePriceStory;
  bargain: ReplyGateBargain;
}

/**
 * 05/10/2026 (phiếu Desk "khách mặc cả kiểu viết tắt"): the customer asks for a lower price — even in a few
 * words, an amount + "được không" ("1tr dc kh a"). The reply follows the shop's own bargaining choice
 * (`banHang.macCa`, tier 3): no promise beyond it, never "what price do you want"; undeclared = the listed
 * price stays and a person is called. Asking about the shop's PROGRAMME ("giảm bao nhiêu %", "đang sale
 * không") is not bargaining. Patterns on the accent-stripped text; empty `reply` switches the rule off.
 */
export interface ReplyGateBargain {
  /** On the customer's message: a request to lower the price. */
  ask: string[];
  /** Right after an amount the customer names (read by the gate's money reader): "được không" — an offer. */
  amountAsk: string;
  /** On the customer's message: a question about the shop's programme — never bargaining. */
  notBargain: string[];
  /** A draft sentence that promises a lower price. */
  promise: string[];
  /** A draft sentence that asks the customer what price they want. */
  askTarget: string[];
  /** The draft already says the price stays. */
  refusal: string;
  /** The shop does not lower prices ({shop}/{khach}). */
  reply: string;
  /** The same, the item being already on sale. */
  replySale: string;
  /** The shop declared nothing: the price stays and a person answers ({tenNguoiPhuTrach}). */
  replyUnset: string;
  reason: string;
  unsetReason: string;
}

/**
 * 05/10/2026 (phiếu Desk "khách gửi ảnh rồi hỏi, bot vẫn xin ảnh"): the customer sent a photo within the
 * fresh window and the draft asks for "a photo" again — the sentence becomes the data's acknowledgement +
 * name / code request. Asking for ANOTHER picture (a label, the box) is not asking again. Every pattern
 * runs on the ORIGINAL sentence (diacritics kept): "anh" the pronoun is never "ảnh".
 */
export interface ReplyGatePhotoAgain {
  /** The sentence asks the customer for a picture. */
  asks: string[];
  /** The picture asked is something else than the one sent (a label, a box…); the industry adds its own. */
  other: string[];
  /** The reply already says the photo was received. */
  acknowledged: string;
  /** The sentence put in place of the request ({khach}/{Khach}); empty = the rule is off. */
  replacement: string;
}

/**
 * 05/10/2026 (phiếu Desk "bot bịa lý do đổi giá và cãi giá khách"): the system keeps NO price history, so any
 * sentence explaining WHY a price changed ("vừa cập nhật giá", "giá đợt trước", "web chưa kịp cập nhật") is
 * invented — cut, unless a person on duty / the policy said it. And a customer who is checking a price
 * (`contest`) and names an amount is never contradicted with another amount: that sentence goes, a person
 * checks. Patterns on the accent-stripped text; empty `reply` switches both rules off.
 */
export interface ReplyGatePriceStory {
  /** A sentence that explains a price change. */
  story: string[];
  /** On the customer's current message: they are checking / disputing a price. */
  contest: string;
  /** Right before a BARE number in the customer's message ("giá 1250"): it is an amount in thousands. */
  bareLead: string;
  /** The sentence that replaces what was cut ({khach}/{Khach}). */
  reply: string;
  storyReason: string;
  contestReason: string;
}
