/**
 * @file One turn: from receiving a message to deciding whether to send, ask back, or hand off.
 *
 * The order matters: RULES FIRST, MODEL SECOND. The whole path below is deterministic; the same
 * input always yields the same output, and no model is called.
 *
 * `TurnEngine` orchestrates the phases; the phases themselves live in small collaborators
 * (`ItemResolver`, `IntentDetector`, `VariantNumberScanner`, `ToolDispatcher`, `GateChain`,
 * `TemplateRenderer`) so each can be read and tested on its own.
 */

import {
  assertNoStoredPII, redactPII,
  type CatalogItemLite, type ConversationId, type ItemId, type TenantId, type ToolName
} from "@sp/contract";
import type { IndustryPack, PackIntent } from "../pack/types";
import type { ConversationState, Ports } from "../ports/index";
import { extractAxis } from "./axis";
import { appendShopTurn, appendTurn, dropFocus, emptyState, hasRecentImageEvidence, isNewEpisode, softEpisodeKeepsFocus } from "./conversation-state";
import { GateChain, type Fact, type GateOutcome, type GateVerdict } from "./gates";
import { IntentDetector } from "./intent";
import { BASE_DATA_VARS, TemplateRenderer, packTemplate, type Rendered } from "./template";
import { coverage, hasWord, mentionsBrand, specificTokens, tight, tokens } from "./text-analysis";
import { DEFAULT_TOOL_DISPATCHER, type ToolDispatcher } from "./tool-handlers";
import { VariantNumberScanner, type VariantNumberHints } from "./variant-numbers";

export interface HandleInput {
  tenant: TenantId;
  conversationId: ConversationId;
  text: string;
  imageCount?: number | undefined;
  at?: string | undefined;
  /**
   * The intent the rule router settled on for this message (`ask_size`, `place_order`...), when a
   * router ran before the engine (25/09/2026). A pack intent that answers it (`routerIntents`, or
   * the same id) is used instead of keyword scoring; a hint no pack intent answers is ignored.
   */
  intentHint?: string | undefined;
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
   * Values the bot may repeat without being accused of inventing numbers.
   * Exposed so tests can check it: these MUST be slot values only, never every number the customer
   * typed; otherwise "shop con 500 doi khong" would license the bot to assert "con 500 doi".
   */
  echoed: string[];
  state: ConversationState;
}

/** Item recognition threshold: fraction of the product name covered by the customer's sentence. */
export const ITEM_MATCH_THRESHOLD = 0.5;

/** Consecutive turns without any intent before the bot calls a human. */
const MAX_IDLE_TURNS = 3;

/** What the item-resolution phase decided about the item under discussion. */
interface ItemResolution {
  itemCode: string | null;
  itemId: ItemId | null;
  candidates: CatalogItemLite[];
  /** The item was named in THIS turn (not carried from the previous focus). */
  namedThisTurn: boolean;
  /** Words of the recognised item's code and name. */
  nameTokens: Set<string>;
  /** Specific (non-generic, non-filler) tokens of the sentence. */
  specific: string[];
  /**
   * The bot just asked for an axis and the customer answered with ONE NUMBER: "650" to a strength
   * question. The item resolver needs this so that number is not mistaken for another item's name
   * (Vitamin C 500); it is the answer to the pending slot.
   */
  answeredWithNumber: boolean;
}

/**
 * Recognises the item the customer is talking about, or keeps / drops the previous focus.
 */
class ItemResolver {
  constructor(private readonly pack: IndustryPack, private readonly ports: Ports) {}

  async resolve(tenant: TenantId, normText: string, state: ConversationState): Promise<ItemResolution> {
    const pack = this.pack;
    const axes = pack.itemShape.axes;
    const specific = specificTokens(normText, pack.lexicon.genericTerms, pack.lexicon.fillerWords ?? []);
    const answeredWithNumber = state.lastAskedSlot !== undefined
      && state.lastAskedSlot !== "item" && state.lastAskedSlot !== "topic"
      && /^\s*\d+(?:[.,]\d+)?\s*\p{L}{0,4}\s*$/u.test(normText);

    let itemCode: string | null = state.focusItemCode ?? null;
    let itemId: ItemId | null = (state.focusItemId as ItemId | undefined) ?? null;
    let candidates: CatalogItemLite[] = [];
    let namedThisTurn = false;
    let nameTokens = new Set<string>();

    // Also run when the sentence only carries a TWO-DIGIT number: "con 90 khong" (Air Max 90).
    // `specificTokens` needs 3+ characters so "90" is not specific, and without this block the
    // engine never notices the customer just named another item.
    const hasTwoDigitNumber = tokens(normText).some((t) => /^\d{2,}$/.test(t));
    if (specific.length > 0 || hasTwoDigitNumber) {
      candidates = await this.ports.catalog.search(tenant, normText, 5);
      const top = candidates[0];
      const second = candidates[1];
      const topScore = top === undefined ? 0 : coverage(normText, `${top.code} ${top.name}`);
      const secondScore = second === undefined ? 0 : coverage(normText, `${second.code} ${second.name}`);
      if (top !== undefined && topScore >= ITEM_MATCH_THRESHOLD && topScore > secondScore) {
        itemCode = top.code;
        itemId = top.id;
        namedThisTurn = true;
        nameTokens = new Set(tokens(`${top.code} ${top.name}`));
      } else if (state.focusItemCode !== undefined) {
        // This turn carries specific words matching ANOTHER item: the customer switched. Keeping
        // the old focus would answer stock of item A to a question about item B.
        //
        // But FINDING NOTHING is not evidence of a switch. "size 43 thi sao" or "loai 650 con
        // khong" carry a number; the number counts as a specific word, the catalog search finds
        // nothing, and the focus used to be wiped: the bot forgot the item, asked back too often,
        // handed off, and the whole episode closed over a perfectly ordinary follow-up.
        // "boston con size 43 khong": the short name scores under the threshold, but the top
        // candidate IS the focused item; that is not a switch.
        const stillAboutFocus = coverage(normText, state.focusItemCode) >= ITEM_MATCH_THRESHOLD
          || (top !== undefined && top.code === state.focusItemCode);
        // Not when the number is the ANSWER to the pending slot: "500" covers 1/3 of "Vitamin C
        // 500", enough to pass this bar, and the focus would jump to an item never mentioned.
        // And at least ONE LETTER word of the item must match: "41 con khong" covers 1/3 of
        // "Pegasus 41" by the number alone, and 41 is a size. Purely numeric matches are left to
        // `numberIsItemName`, which knows to exclude numbers within an axis range.
        const letterHit = top !== undefined
          && tokens(`${top.code} ${top.name}`).some((t) => /^\p{L}/u.test(t) && hasWord(normText, t));
        const otherItem = !answeredWithNumber && top !== undefined && top.code !== state.focusItemCode
          && topScore >= ITEM_MATCH_THRESHOLD * 0.6 && letterHit;
        // A FOREIGN LETTER word ("salomon", "speedcross") means the customer talks about other
        // goods even if the catalog lacks them; the bot must not answer adidas stock to a Salomon
        // question. A bare number ("650", "43") or a number with a unit ("650mg") is not a name.
        const foreignWord = specific.some((t) => /^\p{L}/u.test(t));
        // A number IS an item name when the catalog has an item carrying it in name or code: New
        // Balance 574, 1080, 990. "con 574 khong shop" is a real switch. "650" (no item carries it)
        // stays a number. TWO-digit numbers count too ("Air Max 90"). Excluded: the candidate that
        // IS the focused item ("Boston 13" carries "13"), the answer to a pending slot ("500" for
        // strength, even with Vitamin C 500 around), and numbers inside an axis range ("41" is a
        // size 35-52): a shop selling Pegasus 41 gets "41 con khong" about the focused item as a
        // size question, not a switch; keeping the focus is the safe direction.
        const numberIsItemName = !answeredWithNumber && tokens(normText).some((t) =>
          /^\d{2,}$/.test(t)
          && !axes.some((a) => extractAxis(a, t) !== null)
          && candidates.some((it) =>
            it.code !== state.focusItemCode && tokens(`${it.code} ${it.name}`).includes(t)));
        if (!stillAboutFocus && (otherItem || foreignWord || numberIsItemName)) { itemCode = null; itemId = null; }
      }
    }
    return { itemCode, itemId, candidates, namedThisTurn, nameTokens, specific, answeredWithNumber };
  }
}

/** Mutable working set of one turn, shared between the phases of `TurnEngine`. */
interface TurnWork {
  input: HandleInput;
  now: Date;
  at: string;
  state: ConversationState;
  online: boolean;
  available: Set<ToolName>;
  normText: string;
  item: ItemResolution;
  slots: Record<string, string>;
  /** Slot values inferred by tools in this turn only; never persisted. */
  inferredSlots: Record<string, string>;
  slotsThisTurn: Set<string>;
  echoed: string[];
  numberHints: VariantNumberHints;
  intent: PackIntent | null;
  brandNotCarried: string | null;
  catalogSize: number;
  dataVars: Set<string>;
  renderer: TemplateRenderer;
  vars: Record<string, string>;
  facts: Fact[];
  toolText: string[];
  hasPolicySource: boolean;
  answered: boolean;
  toolFailed: boolean;
  needAxis: string | undefined;
  toolMissing: string[];
}

/** Handles one customer turn for one industry pack over a set of ports. */
export class TurnEngine {
  private readonly intents: IntentDetector;
  private readonly scanner: VariantNumberScanner;
  private readonly items: ItemResolver;
  private readonly gates = new GateChain();

  constructor(
    private readonly pack: IndustryPack,
    private readonly ports: Ports,
    private readonly dispatcher: ToolDispatcher = DEFAULT_TOOL_DISPATCHER
  ) {
    this.intents = new IntentDetector(pack);
    this.scanner = new VariantNumberScanner(pack);
    this.items = new ItemResolver(pack, ports);
  }

  async handle(input: HandleInput): Promise<HandleResult> {
    const work = await this.begin(input);
    this.readSlots(work);
    this.chooseIntent(work);
    await this.runTools(work);
    return this.decide(work);
  }

  // ------------------------------------------------------------------ phase 1: load & recognise
  private async begin(input: HandleInput): Promise<TurnWork> {
    const pack = this.pack;
    const now = this.ports.clock.now();
    const at = input.at ?? now.toISOString();

    const loaded = await this.ports.memory.load(input.tenant, input.conversationId);
    // Cross-check the merchant: a memory store keyed by conversation id ALONE would hand merchant
    // B the stock answer of merchant A. The brain serves many merchants and must not trust a
    // result only because the key matched.
    const trusted = loaded !== null && loaded.tenant === input.tenant ? loaded : null;
    const base = trusted ?? emptyState(input.tenant, input.conversationId);
    // A cold gap opens a new episode; the focus item is dropped unless the soft episode keeps it.
    const appended = appendTurn(base, { role: "customer", text: input.text, at, imageCount: input.imageCount }, now);
    const state = isNewEpisode(base, now) && !softEpisodeKeepsFocus(base) ? dropFocus(appended) : appended;

    const normText = this.intents.normalizeWithAliases(input.text);
    const item = await this.items.resolve(input.tenant, normText, state);
    const axes = pack.itemShape.axes;
    // Data placeholders include the axis names the PACK declared and its extra placeholders;
    // otherwise a hole like "Con 7 hop , gia ..." reaches the customer.
    const dataVars = new Set([...BASE_DATA_VARS, ...axes.map((a) => a.id)]);

    return {
      input, now, at, state,
      online: this.ports.tools.online(),
      available: new Set<ToolName>(this.ports.tools.available()),
      normText, item,
      slots: {}, inferredSlots: {}, slotsThisTurn: new Set(), echoed: [],
      numberHints: {},
      intent: null, brandNotCarried: null, catalogSize: 0,
      dataVars, renderer: new TemplateRenderer(dataVars), vars: {},
      facts: [], toolText: [], hasPolicySource: false, answered: false, toolFailed: false,
      needAxis: undefined, toolMissing: []
    };
  }

  // ------------------------------------------------------------------ phase 2: slots
  private readSlots(work: TurnWork): void {
    const { pack } = this;
    const { state, item, normText } = work;
    const axes = pack.itemShape.axes;
    // Only a SWITCH when an item was already in focus. With no previous item the customer is
    // answering the bot's question, and existing axis values must not be wiped.
    const itemChanged = state.focusItemCode !== undefined && item.itemCode !== state.focusItemCode;
    // Switching items drops the old item's axis values: asking Boston size 42 then moving to Hoka
    // must not default to size 42.
    work.slots = itemChanged ? {} : { ...(state.focusSlots ?? {}) };

    // Cue words for the bare-number scanner: the item recognised this turn, or the top candidate
    // being the focused item, or the focused item's code. "boston 43", "paracetamol 650".
    const top = item.candidates[0];
    const extraCues = new Set<string>([
      ...(top !== undefined && (item.namedThisTurn || top.code === state.focusItemCode)
        ? tokens(`${top.code} ${top.name}`) : []),
      ...(state.focusItemCode === undefined ? [] : tokens(state.focusItemCode))
    ]);
    const itemNameNumbers = new Set<string>(
      item.namedThisTurn ? [...item.nameTokens].filter((t) => /^\d/.test(t)) : []
    );
    work.numberHints = {
      extraCues, itemNameNumbers,
      answeringAskedAxis: state.lastAskedSlot !== undefined && axes.some((a) => a.id === state.lastAskedSlot)
    };
    const validNumbers = new Set(this.scanner.bareNumbers(normText, work.numberHints));

    for (const axis of axes) {
      // Read the SAME string as `validNumbers`: one side reading raw text and the other the
      // alias-expanded text would let a single alias row flip the decision.
      const value = extractAxis(axis, normText);
      if (value === null) continue;
      // A PURELY NUMERIC value must pass the same gate as bare numbers. The pack's size pattern
      // read "em chuyen 42.000d tien ship" as size 42, and that value was STORED for later turns:
      // "Con 3 doi size 42" forever, for a size the customer never mentioned. Values with letters
      // ("42 ruoi", "500mg", "42 2/3") are the pack pattern's own responsibility.
      if (/^\d+(?:[.,]\d+)?$/.test(value) && !validNumbers.has(Number(value.replace(",", ".")))) {
        // Rejecting the new value must also UN-PIN the axis. Otherwise "the 43 con khong" is
        // answered with size 42 from the previous turn: a correct number for a different question,
        // and no gate can catch it because the number has a real source. Seven of seven everyday
        // phrasings fell into exactly this hole.
        delete work.slots[axis.id];
        continue;
      }
      work.slots[axis.id] = value; work.echoed.push(value); work.slotsThisTurn.add(axis.id);
    }
    const phone = /(?:^|\D)(0\d{9})(?:\D|$)/.exec(work.input.text.replace(/[.\s-]/g, ""))?.[1];
    if (phone !== undefined) { work.slots["phone"] = phone; work.echoed.push(phone); }
  }

  // ------------------------------------------------------------------ phase 3: intent
  private chooseIntent(work: TurnWork): void {
    const { pack } = this;
    const { state, item, slots, normText } = work;
    const itemIdentified = item.itemCode !== null;

    // The router already read the message with the frame and the history in view: its verdict
    // beats scoring keywords on the sentence alone ("42" after "size bao nhiêu" is a stock question).
    let intent = this.intents.byHint(work.input.intentHint) ?? this.intents.detect(work.input.text);
    const answeringPrevious =
      intent === null &&
      state.lastAskedSlot !== undefined &&
      (slots[state.lastAskedSlot] !== undefined
        || (state.lastAskedSlot === "item" && itemIdentified)
        || item.answeredWithNumber);
    if (answeringPrevious && state.lastIntentId !== undefined) {
      intent = this.intents.byId(state.lastIntentId);
    }
    // The customer ONLY NAMED AN ITEM with no keyword: the pack decides what that means. Without
    // this, "shop oi co Adizero Boston 13 khong" only gets a greeting.
    // ...but ONLY when the sentence says nothing else. "adizero boston 13 bi bong keo roi shop" is
    // a complaint and "em nhan duoc adizero boston 13 roi cam on" is thanks; answering with a stock
    // table is off-topic and costs one of the ask-back allowances.
    // "Something else" = a LETTER word outside the item name. A number ("650", "43") is not
    // something else; it is an axis value.
    const otherContent = item.specific.some((t) => /^\p{L}/u.test(t) && !item.nameTokens.has(t));
    const defaultIntent = this.intents.byId(pack.intentWhenItemNamed);
    if (intent === null && item.namedThisTurn && !otherContent) {
      intent = defaultIntent;
    }
    // A follow-up about the focused item carrying ONLY an axis value ("loai 650 thi sao", "42"):
    // no keyword, but clearly about that variant. Only with no other content and exactly one bare
    // number or one extracted axis value.
    if (intent === null && !item.namedThisTurn && item.itemCode !== null && !otherContent
        && (work.slotsThisTurn.size > 0 || this.scanner.bareNumbers(normText, work.numberHints).length === 1)) {
      intent = defaultIntent;
    }
    // The "topic" slot is decided by the intent itself; without this line every exchange intent
    // lacks a slot forever and a fetched policy never reaches the customer.
    if (intent?.requiredSlots.includes("topic") === true) slots["topic"] = intent.id;
    work.intent = intent;

    work.brandNotCarried = itemIdentified
      ? null
      : pack.lexicon.knownBrandsNotCarried.find(
          (b) => mentionsBrand(normText, b) && !pack.lexicon.brands.some((c) => tight(c) === tight(b))
        ) ?? null;
  }

  // ------------------------------------------------------------------ phase 4: tools
  private async runTools(work: TurnWork): Promise<void> {
    const { pack } = this;
    const axes = pack.itemShape.axes;
    work.catalogSize = await this.ports.catalog.size(work.input.tenant);

    const vars: Record<string, string> = {
      khach: pack.identity.customerPronoun,
      shop: pack.identity.selfPronoun,
      mon: work.item.itemCode ?? "",
      hang: work.brandNotCarried ?? "",
      tinhtrang: "", ton: "", gia: "", giacao: "", kho: "", sokho: "", dsbienthe: "",
      chinhsach: "", madon: "", trangthai: "", conphaitra: "", songay: "", link: "",
      truc: axes[0]?.label ?? "",
      bienthe: axes[0] === undefined ? "" : (work.slots[axes[0].id] ?? ""),
      // The pack's own placeholders, with the values the pack supplies.
      ...(pack.extraValues ?? {})
    };
    for (const axis of axes) {
      vars[axis.id] = work.slots[axis.id] ?? "";
      vars[`nhan_${axis.id}`] = axis.label;
    }
    work.vars = vars;

    if (work.intent === null || !work.online) return;
    for (const tool of work.intent.tools) {
      if (!work.available.has(tool) || !pack.allowedTools.includes(tool)) continue;
      const handler = this.dispatcher.handler(tool);
      if (handler === undefined) continue;
      const out = await handler.run({
        pack, ports: this.ports, tenant: work.input.tenant, conversationId: work.input.conversationId,
        turnAt: work.at,
        text: work.normText, slotsThisTurn: work.slotsThisTurn, numberHints: work.numberHints,
        scanner: this.scanner,
        itemCode: work.item.itemCode, itemId: work.item.itemId,
        slots: work.slots, state: work.state, vars, renderer: work.renderer
      });
      work.facts.push(...out.facts);
      // Values a tool INFERRED from a bare number: the bot may repeat them this turn, but they are
      // NOT stored. Stored, they stick forever: three turns later the bot still says "Con 3 doi
      // size 42" for a size the customer never typed, and being echoable the number gate no longer
      // watches them.
      if (out.slotsFound !== undefined) {
        for (const [k, v] of Object.entries(out.slotsFound)) { work.inferredSlots[k] = v; work.echoed.push(v); }
      }
      for (const k of out.slotsCleared ?? []) delete work.slots[k];
      work.toolText.push(...out.facts.map((x) => x.text));
      Object.assign(vars, out.vars);
      if (out.answered) work.answered = true;
      if (out.hasPolicySource === true) work.hasPolicySource = true;
      if (out.failed === true || out.partial === true) work.toolFailed = true;
      if (out.needAxis !== undefined) work.needAxis = out.needAxis;
      if (out.missing !== undefined) work.toolMissing.push(...out.missing);
    }
  }

  // ------------------------------------------------------------------ phase 5: compose, gate, decide
  private async decide(work: TurnWork): Promise<HandleResult> {
    const { pack } = this;
    const { state: stateIn, now, item, slots, intent, brandNotCarried, renderer, vars, online, toolFailed } = work;
    let state = stateIn;
    const axes = pack.itemShape.axes;
    const itemIdentified = item.itemCode !== null;
    const tpl = (key: string): string => packTemplate(pack, key);

    // --- missing slots ---
    // A brand the shop does not carry: the right answer is "we do not have that brand", not "please
    // give me the model name", so the intent's slots are ignored.
    const intentForGates = brandNotCarried === null ? intent : null;
    const missing = intentForGates === null ? [] : intentForGates.requiredSlots.filter((s) => {
      if (s === "item") return !itemIdentified;
      return slots[s] === undefined && work.inferredSlots[s] === undefined;
    });
    if (work.needAxis !== undefined && !missing.includes(work.needAxis)) missing.push(work.needAxis);

    // --- draft ---
    let draft: Rendered;
    if (!online) {
      draft = renderer.render(tpl("offline"), vars);
    } else if (toolFailed) {
      draft = renderer.render(tpl("tool_failed") === "" ? tpl("handoff") : tpl("tool_failed"), vars);
    } else if (brandNotCarried !== null) {
      draft = renderer.render(tpl("brand_not_carried"), vars);
    } else if (intent === null) {
      draft = renderer.render(tpl("greeting"), vars);
    } else if (work.answered && missing.length === 0) {
      draft = renderer.render(intent.template, vars);
    } else {
      draft = renderer.render(intent.askBackTemplate, vars);
    }

    // A sentence with an empty placeholder is broken; it must not reach the customer.
    const brokenTemplate = draft.missing.length > 0 || work.toolMissing.length > 0;

    // Asking back: computed for EVERY path, including those bypassing intents (brand not carried,
    // catalog too small). Counting only intent paths creates a loop where the bot repeats one
    // question and the `ask_back_once` gate never fires.
    const brandRule = pack.gates.find((g) => g.kind === "brand_not_carried_needs_catalog");
    const brandBlocked = brandNotCarried !== null && brandRule !== undefined &&
      work.catalogSize < brandRule.minItems;
    const wouldAskBack = online && !toolFailed &&
      ((intentForGates !== null && (missing.length > 0 || !work.answered)) || brandBlocked);

    // --- gates ---
    // The product code comes from the catalog: a real source, not something the bot invented.
    const allowedEchoes = [...new Set([...work.echoed, ...Object.values(slots), ...(item.itemCode === null ? [] : [item.itemCode])])];
    const gateBase = {
      pack, state, now, facts: work.facts, intent: intentForGates,
      itemIdentified, online, catalogSize: work.catalogSize,
      hasPolicySource: work.hasPolicySource, echoedValues: allowedEchoes
    };
    const gate = this.gates.run({
      ...gateBase, draft: draft.text, wouldAskBack,
      claimsBrandNotCarried: brandNotCarried !== null, toolText: work.toolText
    });

    // An "understood nothing" turn: the bot can only greet. Count them and call a human at the
    // threshold, otherwise "alo", "ok", "co ai khong" loops greetings forever. This is the only
    // ask-back-like path that bypasses intents.
    const idleTurn = online && intentForGates === null && brandNotCarried === null && !toolFailed;
    const idleCount = idleTurn ? (state.idleCount ?? 0) + 1 : 0;

    let action: HandleResult["action"] = "send";
    let reply = draft.text;
    let askedSlot: string | undefined;
    let replyMissing: string[] = [];

    if (state.handedOff === true || intent?.handoff === true || brokenTemplate ||
        idleCount >= MAX_IDLE_TURNS) {
      action = "handoff";
      reply = renderer.render(tpl("handoff"), vars).text;
      // Only lock the episode when a human really takes over: a broken template is our fault, not
      // a reason to make the bot mute for the rest of the conversation.
      if (intent?.handoff === true || state.handedOff === true || idleCount >= MAX_IDLE_TURNS) {
        state = { ...state, handedOff: true };
      }
    } else if (gate.verdict.action === "ask_back" || (wouldAskBack && gate.verdict.action === "send")) {
      action = "ask_back";
      askedSlot = missing[0] ?? (itemIdentified ? undefined : "item");
      const axis = axes.find((a) => a.id === askedSlot);
      // A customer who just sent a photo is not asked for a photo again, but only when the missing
      // piece is the ITEM. This branch used to override every ask-back, so a bot needing a phone
      // number went and asked for the product code.
      if (askedSlot === "item" || askedSlot === undefined) {
        const key = hasRecentImageEvidence(state, now) && tpl("ask_item_has_image") !== ""
          ? "ask_item_has_image"
          : "ask_item";
        const rendered = renderer.render(tpl(key), vars);
        reply = rendered.text;
        replyMissing = rendered.missing;
        askedSlot = "item";
      } else if (axis !== undefined) {
        const rendered = renderer.render(tpl("ask_slot"), { ...vars, truc: axis.label });
        reply = rendered.text;
        replyMissing = rendered.missing;
      }
      state = {
        ...state,
        lastAskBackAt: now.toISOString(),
        askBackCount: (state.askBackCount ?? 0) + 1
      };
    } else if (gate.verdict.action === "handoff") {
      action = "handoff";
      reply = renderer.render(tpl("handoff"), vars).text;
      state = { ...state, handedOff: true };
    } else if (gate.verdict.action === "block") {
      // This sentence is not sent, but blocking one sentence does not give up the whole episode.
      action = "handoff";
      reply = renderer.render(tpl("handoff"), vars).text;
    }

    // SECOND PASS on the sentence that is REALLY sent. The branches above replace `reply` AFTER the
    // gates ran, so fallback sentences (`ask_item`, `ask_slot`, `handoff`) used to bypass every gate,
    // and a forbidden phrase inside one of them went straight to the customer.
    const secondPass: GateOutcome = reply === draft.text
      ? { verdict: { action: "send" as const, reason: "" }, all: [] }
      : this.gates.run({
          ...gateBase, draft: reply, wouldAskBack: false,
          claimsBrandNotCarried: brandNotCarried !== null
        });
    const fallbackBroken = secondPass.verdict.action === "block" || secondPass.verdict.action === "handoff";
    if (fallbackBroken || replyMissing.length > 0) {
      action = "handoff";
      const last = renderer.render(tpl("handoff"), vars);
      // If even the handoff sentence is broken there is nothing left to send: silence and a human
      // beat a wrong sentence. `PackValidator` prevents this for a valid pack at build time.
      reply = last.missing.length > 0 || this.gates.run({
        ...gateBase, draft: last.text, intent: null, wouldAskBack: false, claimsBrandNotCarried: false
      }).verdict.action !== "send" ? "" : last.text;
    }

    // DECISION 3: Xeon must not store customer personal data. The phone number is used in this
    // turn to look up orders and is dropped before saving. Next time the customer is asked again:
    // one beat slower, but the promise to the merchant is kept.
    const { phone: _droppedPhone, ...storedSlots } = slots;
    // Answering resets the ask-back counter; otherwise one unanswered ask-back would lock the
    // episode even after the customer supplied everything.
    const askBackCount = action === "ask_back" ? (state.askBackCount ?? 0) : 0;

    state = {
      ...state,
      askBackCount,
      // A REAL answer (a tool produced a result) closes the previous ask-back: clear the mark so the
      // next question may be asked back once more. Otherwise "ask strength" -> "650" -> "con 4 hop
      // 650mg" -> "the con hang khong" hands off because `ask_back_once` still remembers a question
      // the customer already answered. Only a REAL answer counts; a bare greeting does not,
      // otherwise the loop "ask -> alo -> greet -> ask" never trips.
      lastAskBackAt: action === "send" && work.answered ? undefined : state.lastAskBackAt,
      idleCount,
      // Customer turns are stored with EMPTY text. The engine never re-reads it (it only uses the
      // timestamp and image count), so there is nothing to redact: addresses and recipient names,
      // which no pattern can catch, are simply not stored.
      turns: state.turns.map((t) => (t.role === "customer" ? { ...t, text: "" } : t)),
      focusItemCode: item.itemCode ?? undefined,
      focusItemId: item.itemId ?? undefined,
      focusSlots: storedSlots,
      lastIntentId: intent?.id ?? state.lastIntentId,
      lastAskedSlot: askedSlot
    };
    state = appendShopTurn(state, { role: "shop", text: redactPII(reply), at: now.toISOString() });
    // Scan ONLY free text produced by people. Scanning the whole state would flag 16-digit
    // Messenger conversation ids and EAN-13 codes as personal data and kill every turn.
    assertNoStoredPII([...state.turns.map((t) => t.text), ...Object.values(storedSlots)]);
    await this.ports.memory.save(state);

    return {
      action, reply, intentId: intent?.id ?? null, itemCode: item.itemCode, slots,
      facts: work.facts, gates: gate.all, echoed: allowedEchoes, state
    };
  }
}

/** Function facade: handles one turn with a fresh `TurnEngine`. */
export async function handleTurn(pack: IndustryPack, ports: Ports, input: HandleInput): Promise<HandleResult> {
  return new TurnEngine(pack, ports).handle(input);
}
