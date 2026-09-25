/**
 * @file The rule router: what Sales Desk decided BEFORE any model wrote a word (24/09/2026).
 *
 * Copied from Desk `ai_router.js` `routeCustomerMessage`: the local intent and entities, the
 * dialogue-frame corrections (405–424), the payment frame (430–445), the reconciliation of the
 * model's intent with the local one (571–660: `local_script_override`, `payment_claim_demoted`,
 * `local_closing_override`, `ack_continuation`, `nudge_unanswered`, `post_payment_continuation`,
 * `customer_requests_photos`, …), the scripted replies of `matchBotScript` (3082–3300) and the
 * "who answers" logic of `buildDecision` (3520–3577). Pure: no model, no clock, no disk.
 *
 * Every rule is one method whose name goes into `intent.matched` and into `pipeline`, so a replay
 * can say WHY the bot answered as it did. Every sentence is data (`kich-ban-chung.json` ⊕
 * `kich-ban.json`) with `{khach}` / `{site}` / `{camKetHang}` / `{banHang.…}` placeholders filled
 * from the shop profile; a script whose placeholder the shop never filled is NOT used — the agent
 * or a person answers instead, so no shop hears another shop's promise.
 *
 * What is deliberately NOT here: the stock / price / order scripts of `matchBotScript` (3300–3520)
 * that read the catalog — those belong to the turn engine with real stock in hand. This router
 * returns `agent_draft` for them, with the ask-back sentence as a hint.
 */

import { emptyShopProfile, profileField, profileFieldSet, type ShopProfile } from "@sp/contract";
import type { DialogueConfig, EntityConfig, IntentRules, PackIdentity, PackLexicon, ScriptEntry, ScriptTexts } from "../pack/types";
import { loadDialogueConfig, loadEntityConfig, loadIntentRules, loadPack, loadScriptTexts } from "../pack/registry";
import type { Turn } from "../ports/index";
import type { DialogueFrame } from "./dialogue-frame";
import { EntityExtractor, entityLexiconOf, type Entities, type SizeCandidate } from "./entities";
import { packRegex } from "./fill-text";
import { IntentClassifier, type IntentVerdict, type PaymentFrame } from "./intent-rules";
import { normalize } from "./text-analysis";

/** A history turn; `byPerson` marks a page turn typed by the person on duty (only their word proves a payment). */
export interface RouterTurn extends Turn {
  byPerson?: boolean | undefined;
}

export interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/** The customer's open order, when the caller resolved one. */
export interface CurrentOrder {
  id: string;
  paidAmount: number;
  resolved: boolean;
}

export interface RouterInput {
  message: string;
  /** Recent history BEFORE this message, oldest first. */
  turns?: readonly RouterTurn[] | undefined;
  /** Number of images attached to this message. */
  attachments?: number | undefined;
  /**
   * What the photo reader said each attachment IS ("san_pham" | "bien_lai" | "don_hang" | "khac"),
   * when it ran (25/09/2026). A receipt is decided from this, never from the attachment alone:
   * a photo of a shoe under a page's bank message once became "payment_receipt_image".
   */
  attachmentKinds?: readonly string[] | undefined;
  /** The intent a model proposed for this message, if one ran. */
  aiIntent?: IntentVerdict | null | undefined;
  /** The dialogue frame built outside (`DialogueFrameBuilder.build`). */
  frame?: DialogueFrame | null | undefined;
  profile?: ShopProfile | null | undefined;
  site?: string | undefined;
  tenShop?: string | undefined;
  bank?: BankInfo | null | undefined;
  currentOrder?: CurrentOrder | null | undefined;
  /** Products in focus, for the bare tag-size reading. */
  candidates?: readonly SizeCandidate[] | undefined;
}

export type RouterDecision =
  | { kind: "script_reply"; reason: string; reply: string; safeToAutoSend: true }
  | { kind: "ask_clarification"; reason: string; reply: string }
  | { kind: "human_handoff"; reason: string; reply: string; safeToAutoSend: boolean }
  /** The agent writes; `hint` is the ask-back sentence the rules would have used, or "". */
  | { kind: "agent_draft"; reason: string; hint: string };

export interface RouterOutput {
  decision: RouterDecision;
  /** The intent after every correction. */
  intent: IntentVerdict;
  /** The keyword intent of the message alone. */
  localIntent: IntentVerdict;
  entities: Entities;
  frame: DialogueFrame | null;
  paymentFrame: PaymentFrame | null;
  /** The steps taken, in order. */
  pipeline: string[];
}

export interface RuleRouterConfig {
  intentRules: IntentRules;
  entities: EntityConfig;
  scripts: ScriptTexts;
  dialogue: DialogueConfig;
  lexicon: PackLexicon;
  identity?: Pick<PackIdentity, "customerPronoun" | "selfPronoun"> | undefined;
}

const STOCK_INTENTS = ["ask_size", "place_order", "ask_price", "product_advice"];
const RECOVER_SIZE_INTENTS = /(place_order|ask_size|ask_price|product_advice)/;
/** Reasons whose handoff sentence is auto-sent as is (Desk `PAYMENT_ACK_SCRIPT_REASONS` + image reasons). */
const AUTO_SEND_HANDOFF = new Set(["payment_ack", "payment_dispute", "payment_receipt_image", "customer_says_paid_with_image"]);

/** Routes one customer message through Desk's rules, with the merged data of one industry. */
export class RuleRouter {
  readonly classifier: IntentClassifier;
  readonly extractor: EntityExtractor;

  constructor(private readonly cfg: RuleRouterConfig) {
    this.classifier = new IntentClassifier(cfg.intentRules);
    this.extractor = new EntityExtractor(cfg.entities, entityLexiconOf(cfg.lexicon, cfg.dialogue));
  }

  route(input: RouterInput): RouterOutput {
    const message = input.message;
    const turns = input.turns ?? [];
    const pipeline: string[] = ["intent_rules", "entities"];
    const localIntent = this.classifier.classify(message, { attachments: input.attachments });
    let entities = this.extractor.extract(message, { turns, candidates: input.candidates });
    let intent: IntentVerdict = input.aiIntent ? { ...input.aiIntent, matched: [...input.aiIntent.matched, "ai_intent"] } : { ...localIntent };
    const frame = input.frame ?? null;
    const mark = (next: IntentVerdict | null, step: string): void => {
      if (next === null) return;
      intent = next;
      pipeline.push(step);
    };

    // (a) The frame: a terse answer to what the page just asked.
    if (frame !== null) {
      pipeline.push("dialogue_frame");
      mark(this.frameAnsweredSize(frame, intent), "frame_answered_size");
      mark(this.frameAnsweredPurpose(frame, intent), "frame_answered_purpose");
      mark(this.frameAgreeContinuation(frame, intent, entities), "frame_agree_continuation");
      mark(this.frameBankAck(frame, intent), "frame_bank_ack");
    }

    // (c) The payment frame beats everything: money already sent needs a person.
    const paymentFrame = this.classifier.paymentFrame(message, turns, localIntent);
    if (paymentFrame !== null) {
      pipeline.push("payment_frame");
      intent = {
        intent: paymentFrame.dispute ? "complaint_or_human" : "payment_confirmation",
        confidence: paymentFrame.confidence,
        matched: [...intent.matched, paymentFrame.dispute ? "frame_payment_dispute" : "frame_payment_claim"]
      };
    }

    // A size settled earlier must survive the address message that follows it.
    const isAddress = this.extractor.looksLikeAddress(message);
    if (entities.size === "" && (RECOVER_SIZE_INTENTS.test(intent.intent) || isAddress)) {
      const recovered = this.extractor.recoverSizeFromRecentCustomer(turns);
      if (recovered !== "") { entities = { ...entities, size: recovered, sizeSource: "explicit" }; pipeline.push("size_recovered"); }
    }
    if (isAddress && entities.address === "") entities = { ...entities, address: message.trim() };

    // (b) Reconciling the model's intent with the local one: seven rules of Desk, each named.
    mark(this.adviceRequest(message, intent, entities), "advice_request");
    mark(this.localClosingOverride(message, localIntent, intent), "local_closing_override");
    const carriesRequest = this.carriesRequest(message);
    mark(this.localScriptOverride(localIntent, intent, carriesRequest), "local_script_override");
    mark(this.smallTalkLongMessage(message, intent), "small_talk_long_message");
    mark(this.smallTalkCarriesRequest(intent, carriesRequest), "small_talk_carries_request");
    mark(this.nudgeUnanswered(message, localIntent, turns), "nudge_unanswered");
    mark(this.localGreetingWins(localIntent, intent), "local_greeting_wins");
    mark(this.smallTalkAnswersPageQuestion(message, intent, turns), "small_talk_answers_page_question");
    mark(this.ackContinuation(message, intent, turns), "ack_continuation");
    mark(this.postPaymentContinuation(message, intent, entities, turns, input.currentOrder ?? null), "post_payment_continuation");
    mark(this.customerRequestsPhotos(message, intent, input.attachments ?? 0), "customer_requests_photos");
    mark(this.impatience(message, intent), "impatience");
    mark(this.policyQuestionForm(message, intent), "policy_question_form");
    mark(this.returnExchangeReal(message, intent), "return_exchange_real");
    if (paymentFrame === null) {
      mark(this.localPaymentOverride(localIntent, intent), "local_payment_override");
      mark(this.paymentClaimDemoted(localIntent, intent), "payment_claim_demoted");
    }

    // (c)/(d) The decision.
    const decision = paymentFrame !== null
      ? this.paymentHandoff(paymentFrame, input, pipeline)
      : this.decide(message, intent, entities, turns, input, pipeline);
    return { decision, intent, localIntent, entities, frame, paymentFrame, pipeline };
  }

  // ------------------------------------------------------------ frame rules (Desk 405–424)

  /** Page asked the size, customer answered a size: a stock question, not small talk. */
  private frameAnsweredSize(frame: DialogueFrame, intent: IntentVerdict): IntentVerdict | null {
    if (frame.kind !== "asked_size" || frame.answer !== "size" || ["place_order", "ask_size"].includes(intent.intent)) return null;
    return { intent: "ask_size", confidence: 0.9, matched: [...intent.matched, "frame_answered_size"] };
  }

  /** Page asked the purpose, customer answered briefly: that is the need — advise, do not profile again. */
  private frameAnsweredPurpose(frame: DialogueFrame, intent: IntentVerdict): IntentVerdict | null {
    const keep = ["place_order", "ask_size", "ask_price", "payment_confirmation", "complaint_or_human", "asks_bank_info"];
    if (frame.kind !== "asked_purpose" || !["short", "other", "agree"].includes(frame.answer) || keep.includes(intent.intent)) return null;
    return { intent: "product_advice", confidence: 0.85, matched: [...intent.matched, "frame_answered_purpose"] };
  }

  /** "Ok anh" after images / a statement, with no code anywhere: continue the thread, do not force an order. */
  private frameAgreeContinuation(frame: DialogueFrame, intent: IntentVerdict, entities: Entities): IntentVerdict | null {
    const kinds = ["sent_images", "sent_images_with_text", "statement", "asked_other", "said_out", "asked_confirm"];
    if (frame.answer !== "agree" || entities.productCode !== "" || frame.productCode !== "" || !kinds.includes(frame.kind)) return null;
    if (["payment_confirmation", "complaint_or_human", "asks_bank_info"].includes(intent.intent)) return null;
    return { intent: "unknown", confidence: 0.55, matched: [...intent.matched, "frame_agree_continuation"] };
  }

  /** Page gave the bank account, customer agreed: the bot is now the one RECEIVING money. */
  private frameBankAck(frame: DialogueFrame, intent: IntentVerdict): IntentVerdict | null {
    if (frame.kind !== "gave_bank" || frame.answer !== "agree") return null;
    return { intent: "unknown", confidence: 0.6, matched: [...intent.matched, "frame_bank_ack"] };
  }

  // -------------------------------------------------- reconciliation rules (Desk 571–660)

  /** "tu van giup minh vai mau, size 40, chay bo": a need plus an advice verb is advice, not a size question. */
  private adviceRequest(message: string, intent: IntentVerdict, entities: Entities): IntentVerdict | null {
    if (intent.intent !== "ask_size" || entities.need === "") return null;
    if (!(packRegex(this.cfg.intentRules.reconcile.adviceRequest)?.test(normalize(message)) ?? false)) return null;
    return { intent: "product_advice", confidence: Math.max(0.91, intent.confidence), matched: [...intent.matched, "advice_request"] };
  }

  /** "chot size 43 luon": a closing keyword with an explicit size beats the model's advice/size guess. */
  private localClosingOverride(message: string, localIntent: IntentVerdict, intent: IntentVerdict): IntentVerdict | null {
    if (localIntent.intent !== "place_order" || intent.intent === "place_order") return null;
    if (this.extractor.explicitSize(normalize(message.replace(/(\d),(\d)/g, "$1.$2"))) === "") return null;
    return { intent: "place_order", confidence: Math.max(0.9, localIntent.confidence), matched: [...intent.matched, "local_closing_override"] };
  }

  /** The message carries a request/question beyond a pleasantry (Desk `carriesRequest`). */
  private carriesRequest(message: string): boolean {
    const n = normalize(message);
    return this.cfg.intentRules.reconcile.carriesRequest.some((p) => p !== "" && (new RegExp(p).test(message) || new RegExp(p).test(n)));
  }

  /** Small talk / how-to-order / bank info / authenticity: the local script beats the model, unless the message asks for more. */
  private localScriptOverride(localIntent: IntentVerdict, intent: IntentVerdict, carriesRequest: boolean): IntentVerdict | null {
    const rc = this.cfg.intentRules.reconcile;
    if (intent.matched.some((tag) => tag.startsWith("frame_"))) return null;
    if (!rc.scriptOverrideIntents.includes(localIntent.intent) || intent.intent === localIntent.intent) return null;
    if (rc.scriptOverrideUnlessRequest.includes(localIntent.intent) && carriesRequest) return null;
    return { ...localIntent, matched: [...localIntent.matched, "local_script_override"] };
  }

  private smallTalkLongMessage(message: string, intent: IntentVerdict): IntentVerdict | null {
    const max = this.cfg.intentRules.reconcile.smallTalkMaxWords;
    if (intent.intent !== "small_talk" || max <= 0 || normalize(message).split(" ").filter(Boolean).length < max) return null;
    return { intent: "unknown", confidence: 0.5, matched: [...intent.matched, "small_talk_long_message"] };
  }

  private smallTalkCarriesRequest(intent: IntentVerdict, carriesRequest: boolean): IntentVerdict | null {
    if (intent.intent !== "small_talk" || !carriesRequest) return null;
    return { intent: "unknown", confidence: 0.5, matched: [...intent.matched, "small_talk_carries_request"] };
  }

  /** "Ban oi" when the page has not answered the customer's last message is a nudge, not a new greeting. */
  private nudgeUnanswered(message: string, localIntent: IntentVerdict, turns: readonly RouterTurn[]): IntentVerdict | null {
    if (localIntent.intent !== "greeting") return null;
    const last = turns[turns.length - 1];
    const lastIsCustomer = last !== undefined && last.role === "customer" && last.text.trim() !== "";
    const pageSpoke = turns.some((t) => t.role === "shop" && t.text.trim() !== "");
    if (!lastIsCustomer || !pageSpoke || !(packRegex(this.cfg.intentRules.reconcile.nudge)?.test(normalize(message)) ?? false)) return null;
    return { intent: "unknown", confidence: 0.6, matched: ["nudge_unanswered"] };
  }

  private localGreetingWins(localIntent: IntentVerdict, intent: IntentVerdict): IntentVerdict | null {
    if (localIntent.intent !== "greeting" || intent.matched.includes("nudge_unanswered")) return null;
    if (!["small_talk", "unknown", "greeting"].includes(intent.intent)) return null;
    return { ...localIntent, matched: [...localIntent.matched, "local_greeting_wins"] };
  }

  /** "Da vang a" / "Ko e" right after the page asked something is the ANSWER, not a goodbye. */
  private smallTalkAnswersPageQuestion(message: string, intent: IntentVerdict, turns: readonly RouterTurn[]): IntentVerdict | null {
    if (intent.intent !== "small_talk") return null;
    const rc = this.cfg.intentRules.reconcile;
    const lastPage = [...turns].reverse().find((t) => t.role === "shop" && t.text.trim() !== "");
    const pageAsked = lastPage !== undefined && (packRegex(rc.pageAsked)?.test(normalize(lastPage.text)) ?? false);
    if (!pageAsked || !(packRegex(rc.shortAnswerToPage, "i")?.test(message.trim()) ?? false)) return null;
    return { intent: "unknown", confidence: 0.5, matched: [...intent.matched, "small_talk_answers_page_question"] };
  }

  /** "Ok a" / "dung roi" after ANYTHING the page said is agreement in the thread, not a thank-you. */
  private ackContinuation(message: string, intent: IntentVerdict, turns: readonly RouterTurn[]): IntentVerdict | null {
    if (intent.intent !== "small_talk") return null;
    const rc = this.cfg.intentRules.reconcile;
    const pageSpoke = turns.some((t) => t.role === "shop" && t.text.trim() !== "");
    if (!pageSpoke || !(packRegex(rc.bareAck, "i")?.test(message.trim()) ?? false)) return null;
    if (packRegex(rc.thanks)?.test(normalize(message)) ?? false) return null;
    return { intent: "unknown", confidence: 0.5, matched: [...intent.matched, "ack_continuation"] };
  }

  /**
   * The customer already paid (a PERSON on the page said so, the linked order carries a paid amount,
   * or the customer sent a receipt): "hang ve gui dia chi nay" is delivery talk, not a new order.
   */
  private postPaymentContinuation(message: string, intent: IntentVerdict, entities: Entities, turns: readonly RouterTurn[], order: CurrentOrder | null): IntentVerdict | null {
    if (intent.intent !== "place_order") return null;
    const rc = this.cfg.intentRules.reconcile;
    const recent = turns.slice(-8);
    const personText = recent.filter((t) => t.role === "shop" && (t.byPerson === true || /^\[người trực\]/.test(t.text))).map((t) => normalize(t.text)).join(" ");
    const paidAlready = (packRegex(rc.pageSaidPaid)?.test(personText) ?? false)
      || (order !== null && order.resolved && order.paidAmount > 0 && entities.size === "" && entities.productCode === "")
      || recent.some((t) => t.role === "customer" && (packRegex(rc.customerReceiptImage)?.test(t.text) ?? false));
    if (!paidAlready || (packRegex(rc.buysMore)?.test(normalize(message)) ?? false)) return null;
    return { intent: "unknown", confidence: 0.5, matched: [...intent.matched, "post_payment_continuation"] };
  }

  /** "cho chi xin them hinh": the customer ASKS for photos, they are not sending one. */
  private customerRequestsPhotos(message: string, intent: IntentVerdict, attachments: number): IntentVerdict | null {
    if (attachments > 0 || !["send_image", "unknown"].includes(intent.intent)) return null;
    if (!(packRegex(this.cfg.intentRules.reconcile.asksForPhotos)?.test(normalize(message)) ?? false)) return null;
    return { intent: "product_advice", confidence: 0.8, matched: [...intent.matched, "customer_requests_photos"] };
  }

  /**
   * "giày mua bên shop có bảo hành không" is a QUESTION about a policy, not a return: the agent answers
   * it with the policy tool. A real return ("mình muốn trả lại", "nhận hàng bị lỗi") stays a person's (kb2-08).
   */
  private policyQuestionForm(message: string, intent: IntentVerdict): IntentVerdict | null {
    const rc = this.cfg.intentRules.reconcile;
    if (!["return_exchange", "complaint_or_human", "unknown", "ask_size", "ask_price"].includes(intent.intent)) return null;
    const n = normalize(message);
    if (!(packRegex(rc.policyQuestionForm)?.test(n) ?? false)) return null;
    if (packRegex(rc.returnExchangeReal)?.test(n) ?? false) return null;
    return { intent: "policy_question", confidence: Math.max(0.85, intent.confidence), matched: [...intent.matched, "policy_question_form"] };
  }

  /** "trả lời chậm quá, có bán không thì bảo": impatience is not a complaint about goods — the agent apologises in one clause and answers (kb2-15). */
  private impatience(message: string, intent: IntentVerdict): IntentVerdict | null {
    const rc = this.cfg.intentRules.reconcile;
    if (!["unknown", "small_talk", "complaint_or_human", "greeting"].includes(intent.intent)) return null;
    const n = normalize(message);
    if (!(packRegex(rc.impatience)?.test(n) ?? false)) return null;
    if (packRegex(rc.returnExchangeReal)?.test(n) ?? false) return null;
    return { intent: "unknown", confidence: 0.6, matched: [...intent.matched, "impatience"] };
  }

  /** Goods in hand the customer wants to return or exchange: a person, whatever the keywords said. */
  private returnExchangeReal(message: string, intent: IntentVerdict): IntentVerdict | null {
    if (["return_exchange", "complaint_or_human", "payment_confirmation"].includes(intent.intent)) return null;
    const n = normalize(message);
    if (!(packRegex(this.cfg.intentRules.reconcile.returnExchangeReal)?.test(n) ?? false)) return null;
    // Changing the size of an ORDER already placed is the order branch's, not a return (kb2-07).
    if (packRegex(this.cfg.entities.orderTalk)?.test(n) ?? false) return null;
    return { intent: "return_exchange", confidence: 0.9, matched: [...intent.matched, "return_exchange_real"] };
  }

  /** Money words locally always beat the model, which likes to read "da chuyen khoan" as an order. */
  private localPaymentOverride(localIntent: IntentVerdict, intent: IntentVerdict): IntentVerdict | null {
    if (localIntent.intent !== "payment_confirmation" || intent.intent === "payment_confirmation") return null;
    return { intent: "payment_confirmation", confidence: Math.max(0.95, localIntent.confidence), matched: [...intent.matched, "local_payment_override"] };
  }

  /** The model said "payment" but no local keyword agrees ("chi nhan giay roi nhe"): back to the local intent. */
  private paymentClaimDemoted(localIntent: IntentVerdict, intent: IntentVerdict): IntentVerdict | null {
    if (intent.intent !== "payment_confirmation" || localIntent.intent === "payment_confirmation") return null;
    return { ...localIntent, matched: [...localIntent.matched, "payment_claim_demoted"] };
  }

  // ------------------------------------------------------------------- decisions

  /** The payment claim: one fixed NEUTRAL sentence, auto-sent, and a person is called to check the money (24/09/2026). */
  private paymentHandoff(frame: PaymentFrame, input: RouterInput, pipeline: string[]): RouterDecision {
    pipeline.push("payment_claim_resolver", "script_handoff");
    const id = frame.dispute ? "payment_dispute" : "payment_confirmation";
    const reason = frame.dispute ? "payment_dispute" : "payment_ack";
    const reply = this.fillScript(this.cfg.scripts.scripts[id], input);
    return { kind: "human_handoff", reason, reply: reply ?? "", safeToAutoSend: reply !== null };
  }

  /** The scripted replies of `matchBotScript` that need no catalog, then `buildDecision`. */
  private decide(message: string, intent: IntentVerdict, entities: Entities, _turns: readonly RouterTurn[], input: RouterInput, pipeline: string[]): RouterDecision {
    const rc = this.cfg.intentRules.reconcile;
    const n = normalize(message);
    const words = n.split(" ").filter(Boolean).length;
    const thanks = packRegex(rc.thanks)?.test(n) ?? false;
    pipeline.push("bot_script");
    const script = (id: string, reason = id): RouterDecision => this.scripted(id, reason, input, pipeline);
    const agent = (reason: string, hint = ""): RouterDecision => ({ kind: "agent_draft", reason, hint });

    if (intent.intent === "deposit_instruction") return agent("deposit_instruction");
    if (intent.matched.includes("impatience")) return agent("impatience", `Khach dang giuc / buc vi cham: mo dau bang "${this.fillHoiLai("xinLoiCho", input) ?? "Dạ em xin lỗi để khách chờ, "}" roi tra loi thang viec khach hoi (ton/gia/mau), KHONG goi nguoi, KHONG hoi lai mau neu cau khach da du.`);
    if (intent.intent === "policy_question") return agent("policy_question", "Cau hoi ve chinh sach: goi cong cu chinh_sach truoc, tra loi dung phan ho so shop da khai; chua khai thi noi de nguoi phu trach tra loi.");
    if (intent.intent === "small_talk") {
      if (packRegex(rc.sadPhrase)?.test(n) ?? false) return script("tiec_that");
      if (words > 3 && !thanks) return agent("small_talk_with_content");
      if (!thanks) return script("small_talk_plain", "small_talk");
    }
    if (intent.matched.includes("frame_bank_ack")) return script("bank_ack");
    if (intent.intent === "send_image") {
      // A receipt is what the photo reader SAW (Desk `classifyNonProductImage`), or what the customer
      // SAYS with the photo ("đã ck"). The page's bank message alone proves nothing about the picture.
      const readAsReceipt = (input.attachmentKinds ?? []).includes("bien_lai");
      // The attachment placeholder ("[1 tệp đính kèm]", "[gửi 2 ảnh]") is not the customer's words.
      const spoken = normalize(this.extractor.stripPlaceholders(message));
      const saysPaid = spoken !== "" && (packRegex(rc.paymentContextCustomer)?.test(spoken) ?? false);
      if (readAsReceipt || saysPaid) return script("receipt_image", "payment_receipt_image");
      return agent("image_unclear_ai", this.fillScript(this.cfg.scripts.scripts["image_unclear"], input) ?? "");
    }
    const shippingNotFee = intent.intent === "shipping" && !(packRegex(rc.shippingFee)?.test(n) ?? false);
    const isAddress = this.extractor.looksLikeAddress(message);
    if (this.cfg.scripts.scripts[intent.intent] !== undefined && !shippingNotFee && !isAddress) return script(intent.intent);
    if (intent.intent === "complaint_or_human") return { kind: "human_handoff", reason: "complaint_or_human", reply: "", safeToAutoSend: false };
    if (STOCK_INTENTS.includes(intent.intent) && (packRegex(rc.policyQuestion)?.test(n) ?? false)) return agent("policy_question_over_script");
    if (shippingNotFee) return agent("shipping_eta_question");
    // Stock, price and order answers need the catalog: the turn engine's job, with the ask-back as a hint.
    const hint = STOCK_INTENTS.includes(intent.intent) && entities.productCode === "" && entities.productName === ""
      ? this.fillHoiLai("sanPham", input) ?? this.fillHoiLai("chung", input) ?? ""
      : "";
    return agent(intent.intent === "unknown" ? "no_confident_script" : `${intent.intent}_needs_catalog`, hint);
  }

  /** One script, filled for this shop; a script the shop's profile cannot fill goes to the agent (Desk `buildDecision` on top). */
  private scripted(id: string, reason: string, input: RouterInput, pipeline: string[]): RouterDecision {
    const entry = this.cfg.scripts.scripts[id];
    const reply = this.fillScript(entry, input);
    if (entry === undefined || reply === null) {
      pipeline.push("script_unavailable");
      return { kind: "agent_draft", reason: entry === undefined ? `${id}_no_script` : `${id}_profile_missing`, hint: "" };
    }
    if (entry.action === "script_reply") { pipeline.push("script_reply"); return { kind: "script_reply", reason, reply, safeToAutoSend: true }; }
    if (entry.action === "ask_clarification") { pipeline.push("ask_clarification"); return { kind: "ask_clarification", reason, reply }; }
    // A handoff sentence is auto-sent only for the payment / receipt reasons (Desk "script_handoff");
    // the rest is the agent's draft with a person told.
    const desk = reason === "payment_confirmation" ? "payment_ack" : reason;
    const safeToAutoSend = entry.safeToAutoSend ?? AUTO_SEND_HANDOFF.has(desk);
    pipeline.push(safeToAutoSend ? "script_handoff" : "human_handoff");
    return { kind: "human_handoff", reason: desk, reply, safeToAutoSend };
  }

  /** The ask-back sentence for a reason (`hoiLai.sanPham`, `hoiLai.tenMau`, …), filled; `null` when absent or unfillable. */
  fillHoiLai(reason: string, input: Pick<RouterInput, "profile" | "site" | "tenShop" | "bank">): string | null {
    const text = this.cfg.scripts.hoiLai[reason];
    return text === undefined ? null : this.fill(text, input);
  }

  /** A script's reply, filled; `null` when the script is absent or a placeholder has no value for this shop. */
  fillScript(entry: ScriptEntry | undefined, input: Pick<RouterInput, "profile" | "site" | "tenShop" | "bank">): string | null {
    return entry === undefined ? null : this.fill(entry.reply, input);
  }

  /**
   * Fills `{khach}` `{Khach}` `{shop}` `{site}` `{tenShop}` `{nganHang}` `{soTaiKhoan}` `{tenTaiKhoan}`
   * and any shop-profile path (`{camKetHang}`, `{banHang.cauKhongCo}`); one empty value = `null`.
   */
  private fill(text: string, input: Pick<RouterInput, "profile" | "site" | "tenShop" | "bank">): string | null {
    const profile = input.profile ?? emptyShopProfile();
    const khach = profile.xungHo.khach || this.cfg.identity?.customerPronoun || "mình";
    const fixed: Record<string, string> = {
      khach, Khach: khach.charAt(0).toUpperCase() + khach.slice(1),
      shop: profile.xungHo.shop || this.cfg.identity?.selfPronoun || "em",
      site: input.site ?? "", tenShop: input.tenShop ?? "",
      nganHang: input.bank?.bankName ?? "", soTaiKhoan: input.bank?.accountNumber ?? "", tenTaiKhoan: input.bank?.accountName ?? ""
    };
    let missing = false;
    const out = text.replace(/\{([A-Za-z0-9_.]+)\}/g, (_m, key: string) => {
      const value = key in fixed ? fixed[key]! : (input.profile && profileFieldSet(profile, key) ? String(profileField(profile, key)) : "");
      if (value === "") missing = true;
      return value;
    });
    return missing ? null : out;
  }
}

/** A router for one industry from the installed pack source (its merged stage-2 data plus the pack's lexicon). */
export function ruleRouterFor(packId: string): RuleRouter {
  const pack = loadPack(packId);
  return new RuleRouter({
    intentRules: loadIntentRules(packId), entities: loadEntityConfig(packId), scripts: loadScriptTexts(packId),
    dialogue: loadDialogueConfig(packId), lexicon: pack.lexicon, identity: pack.identity
  });
}
