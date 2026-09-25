/**
 * @file Reads an industry pack out of JSON — the boundary between a file on disk and the engine.
 *
 * Until 21/09/2026 a pack was a TypeScript file in `packs/`, so opening a new industry meant
 * editing code, rebuilding and redeploying the brain. That broke the sales promise in practice:
 * the person who knows the industry is not the person who can run `tsc`. A pack is DATA, so it now
 * lives as JSON in `nganh/<id>/` and this file is the only thing that turns that JSON into an
 * `IndustryPack`.
 *
 * Two rules hold here:
 *
 * 1. THE CORE STILL TOUCHES NO DISK. This file takes `unknown` — an already parsed JSON value —
 *    never a path. The adapter (`@sp/xeon`) reads the files; `@sp/brain` stays pure and testable.
 * 2. EVERY FIELD IS CHECKED, AND THE MESSAGE NAMES THE FIELD. The author is a shop person, not a
 *    programmer. `identity.tone[2] phai la chu` is a fixable message; `undefined is not iterable`
 *    thrown three layers deep in the engine is not. Shape is checked here, MEANING is checked by
 *    `PackValidator` afterwards (`loadPack` runs both).
 *
 * Long texts (the agent's rules, a size guide) may be written as an ARRAY OF LINES and are joined
 * with newlines. A 200-line selling playbook squeezed into one JSON string is unreadable and
 * therefore unmaintainable, which is how wrong rules survive.
 */

import { isToolName, type ToolName } from "@sp/contract";
import type {
  AgentBlock, CommonAgent, DialogueConfig, EntityConfig, EpisodeConfig, GateRule, IndustryPack, IntentRule, IntentRules,
  LedgerTexts, MatchingConfig, PackAgent, PackAgentTool, PackAxis, PackAxisCanonical, PackIntent, ProfileTemplate, ScriptAction, ScriptEntry,
  ReplyGateConfig, ScriptTexts, SizeChartRow, SystemNoteTexts, TypeRules
} from "./types";

/** Thrown when the JSON cannot be a pack. Carries every problem found, not just the first. */
export class PackShapeError extends Error {
  constructor(readonly packId: string, readonly problems: string[]) {
    super(`Ho so nganh "${packId}" doc khong duoc:\n- ` + problems.join("\n- "));
    this.name = "PackShapeError";
  }
}

/** Collects problems while walking the JSON, so the author sees all of them at once. */
export class ShapeReader {
  readonly problems: string[] = [];

  fail(where: string, what: string): void {
    this.problems.push(`\`${where}\` ${what}.`);
  }

  /** A plain object, or `{}` with a problem recorded. */
  object(value: unknown, where: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.fail(where, "phai la mot khoi { }");
      return {};
    }
    return value as Record<string, unknown>;
  }

  /** A non-empty string. `optional` allows it to be missing (then ""). */
  text(value: unknown, where: string, optional = false): string {
    if (value === undefined || value === null) {
      if (!optional) this.fail(where, "thieu");
      return "";
    }
    if (typeof value !== "string") {
      this.fail(where, "phai la chu");
      return "";
    }
    if (value === "" && !optional) this.fail(where, "khong duoc de trong");
    return value;
  }

  /**
   * A long text: one string, or an array of lines joined with newlines.
   * The array form is what makes a selling playbook editable by hand.
   */
  longText(value: unknown, where: string, optional = false): string {
    if (Array.isArray(value)) {
      const lines = value.map((line, i) => this.text(line, `${where}[${i}]`, true));
      return lines.join("\n");
    }
    return this.text(value, where, optional);
  }

  /** An array of strings. Missing means empty when `optional`. */
  texts(value: unknown, where: string, optional = false): string[] {
    if (value === undefined || value === null) {
      if (!optional) this.fail(where, "thieu");
      return [];
    }
    if (!Array.isArray(value)) {
      this.fail(where, "phai la mot danh sach");
      return [];
    }
    return value.map((item, i) => this.text(item, `${where}[${i}]`));
  }

  /** An array of objects, mapped one by one. Each entry keeps its index in the messages. */
  list<T>(value: unknown, where: string, map: (item: Record<string, unknown>, at: string) => T, optional = false): T[] {
    if (value === undefined || value === null) {
      if (!optional) this.fail(where, "thieu");
      return [];
    }
    if (!Array.isArray(value)) {
      this.fail(where, "phai la mot danh sach");
      return [];
    }
    return value.map((item, i) => map(this.object(item, `${where}[${i}]`), `${where}[${i}]`));
  }

  number(value: unknown, where: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail(where, "phai la mot con so");
      return 0;
    }
    return value;
  }

  boolean(value: unknown, where: string, fallback: boolean | undefined = undefined): boolean {
    if (typeof value === "boolean") return value;
    if (value === undefined && fallback !== undefined) return fallback;
    this.fail(where, "phai la true hoac false");
    return fallback ?? false;
  }

  /** A `{ key: "text" }` map, e.g. the templates or the aliases. */
  textMap(value: unknown, where: string, optional = false): Record<string, string> {
    if (value === undefined && optional) return {};
    const source = this.object(value, where);
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(source)) out[key] = this.text(item, `${where}.${key}`);
    return out;
  }

  /** Tool names, checked against the contract so a typo is caught at load, not at the first customer. */
  tools(value: unknown, where: string): ToolName[] {
    const names = this.texts(value, where, true);
    const out: ToolName[] = [];
    for (const [i, name] of names.entries()) {
      if (isToolName(name)) out.push(name);
      else this.fail(`${where}[${i}]`, `khong phai ten cong cu co that ("${name}")`);
    }
    return out;
  }
}

/** Gate kinds and the extra fields each one carries. Adding a gate = adding a line here. */
const GATE_KINDS = [
  "require_source_for_claims", "require_item_before_stock", "ask_back_once", "no_unsourced_numbers",
  "brand_not_carried_needs_catalog", "forbidden_phrases", "forbidden_patterns", "no_facts_when_offline"
] as const;

function parseGate(r: ShapeReader, raw: Record<string, unknown>, at: string): GateRule {
  const kind = r.text(raw["kind"], `${at}.kind`);
  if (!(GATE_KINDS as readonly string[]).includes(kind)) {
    r.fail(`${at}.kind`, `khong phai luat cong co that ("${kind}"). Cac luat co: ${GATE_KINDS.join(", ")}`);
    return { kind: "forbidden_phrases" };
  }
  switch (kind) {
    case "require_source_for_claims": {
      const patterns = raw["patterns"] === undefined ? undefined : r.texts(raw["patterns"], `${at}.patterns`, true);
      return { kind, topics: r.texts(raw["topics"], `${at}.topics`), ...(patterns ? { patterns } : {}) };
    }
    case "ask_back_once": {
      const maxTimes = raw["maxTimes"] === undefined ? undefined : r.number(raw["maxTimes"], `${at}.maxTimes`);
      return { kind, windowMinutes: r.number(raw["windowMinutes"], `${at}.windowMinutes`), ...(maxTimes === undefined ? {} : { maxTimes }) };
    }
    case "brand_not_carried_needs_catalog":
      return { kind, minItems: r.number(raw["minItems"], `${at}.minItems`) };
    case "forbidden_patterns":
      return { kind, patterns: r.texts(raw["patterns"], `${at}.patterns`), reason: r.text(raw["reason"], `${at}.reason`) };
    default:
      return { kind } as GateRule;
  }
}

function parseAxis(r: ShapeReader, raw: Record<string, unknown>, at: string): PackAxis {
  return {
    id: r.text(raw["id"], `${at}.id`),
    label: r.text(raw["label"], `${at}.label`),
    pattern: r.text(raw["pattern"], `${at}.pattern`),
    canonical: r.list<PackAxisCanonical>(raw["canonical"], `${at}.canonical`, (c, cAt) => ({
      pattern: r.text(c["pattern"], `${cAt}.pattern`),
      replace: r.text(c["replace"], `${cAt}.replace`, true)
    }), true),
    examples: r.list(raw["examples"], `${at}.examples`, (e, eAt) => ({
      text: r.text(e["text"], `${eAt}.text`),
      // `null` is meaningful: "this sentence must NOT be read as a value of this axis".
      expect: e["expect"] === null ? null : r.text(e["expect"], `${eAt}.expect`)
    }), true),
    requiredForStock: r.boolean(raw["requiredForStock"], `${at}.requiredForStock`, false)
  };
}

function parseIntent(r: ShapeReader, raw: Record<string, unknown>, at: string): PackIntent {
  const optionalTexts = (key: string): string[] | undefined =>
    raw[key] === undefined ? undefined : r.texts(raw[key], `${at}.${key}`, true);
  const patterns = optionalTexts("patterns");
  const negativeKeywords = optionalTexts("negativeKeywords");
  const examples = optionalTexts("examples");
  const routerIntents = optionalTexts("routerIntents");
  const handoff = raw["handoff"] === undefined ? undefined : r.boolean(raw["handoff"], `${at}.handoff`);
  return {
    id: r.text(raw["id"], `${at}.id`),
    name: r.text(raw["name"], `${at}.name`),
    keywords: r.texts(raw["keywords"], `${at}.keywords`, true),
    requiredSlots: r.texts(raw["requiredSlots"], `${at}.requiredSlots`, true),
    tools: r.tools(raw["tools"], `${at}.tools`),
    template: r.text(raw["template"], `${at}.template`),
    askBackTemplate: r.text(raw["askBackTemplate"], `${at}.askBackTemplate`),
    ...(patterns ? { patterns } : {}),
    ...(negativeKeywords ? { negativeKeywords } : {}),
    ...(examples ? { examples } : {}),
    ...(routerIntents ? { routerIntents } : {}),
    ...(handoff === undefined ? {} : { handoff })
  };
}

const AGENT_HANDLERS = ["landing", "static", "disabled"] as const;
const LANDING_METHODS = ["findStock", "policy", "bankAccount"] as const;

function parseAgentTool(r: ShapeReader, raw: Record<string, unknown>, at: string): PackAgentTool {
  const handler = r.text(raw["handler"], `${at}.handler`);
  if (!(AGENT_HANDLERS as readonly string[]).includes(handler)) {
    r.fail(`${at}.handler`, `phai la mot trong ${AGENT_HANDLERS.join(" / ")}`);
  }
  const landingMethod = raw["landingMethod"] === undefined ? undefined : r.text(raw["landingMethod"], `${at}.landingMethod`);
  if (landingMethod !== undefined && !(LANDING_METHODS as readonly string[]).includes(landingMethod)) {
    r.fail(`${at}.landingMethod`, `phai la mot trong ${LANDING_METHODS.join(" / ")}`);
  }
  if (handler === "landing" && landingMethod === undefined) {
    r.fail(`${at}.landingMethod`, "thieu — cong cu lay du lieu tu landing phai noi ro goi ham nao");
  }
  const staticText = raw["staticText"] === undefined ? undefined : r.longText(raw["staticText"], `${at}.staticText`, true);
  if (handler === "static" && (staticText ?? "") === "") r.fail(`${at}.staticText`, "thieu — cong cu tra chu co san phai co chu");
  const disabledMessage = raw["disabledMessage"] === undefined ? undefined : r.longText(raw["disabledMessage"], `${at}.disabledMessage`, true);
  const tracksAmounts = raw["tracksAmounts"] === undefined ? undefined : r.boolean(raw["tracksAmounts"], `${at}.tracksAmounts`);
  const tracksLinks = raw["tracksLinks"] === undefined ? undefined : r.boolean(raw["tracksLinks"], `${at}.tracksLinks`);
  const tool: PackAgentTool = { name: r.text(raw["name"], `${at}.name`), handler: handler as PackAgentTool["handler"], moTa: r.longText(raw["moTa"], `${at}.moTa`) };
  if (landingMethod !== undefined) tool.landingMethod = landingMethod as NonNullable<PackAgentTool["landingMethod"]>;
  if (staticText !== undefined) tool.staticText = staticText;
  if (disabledMessage !== undefined) tool.disabledMessage = disabledMessage;
  if (tracksAmounts !== undefined) tool.tracksAmounts = tracksAmounts;
  if (tracksLinks !== undefined) tool.tracksLinks = tracksLinks;
  return tool;
}

const BLOCK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** One instruction block. Its id is what a shop's profile points at, so it must be a stable slug. */
function parseBlock(r: ShapeReader, raw: Record<string, unknown>, at: string): AgentBlock {
  const id = r.text(raw["id"], `${at}.id`);
  if (id !== "" && !BLOCK_ID.test(id)) r.fail(`${at}.id`, "chi gom chu thuong, so, gach ngang");
  return {
    id,
    tieuDe: r.text(raw["tieuDe"], `${at}.tieuDe`),
    shopSua: r.boolean(raw["shopSua"], `${at}.shopSua`, false),
    loiDan: r.longText(raw["loiDan"], `${at}.loiDan`)
  };
}

/** Instruction blocks, ids unique. Written as `khoi`; a single legacy `systemPrompt` becomes one block. */
export function parseBlocks(r: ShapeReader, raw: Record<string, unknown>, where: string, legacyKey = "systemPrompt"): AgentBlock[] {
  if (raw["khoi"] === undefined && raw[legacyKey] !== undefined) {
    return [{ id: "loi-dan", tieuDe: "Lời dặn", shopSua: false, loiDan: r.longText(raw[legacyKey], `${where}.${legacyKey}`) }];
  }
  const blocks = r.list(raw["khoi"], `${where}.khoi`, (b, at) => parseBlock(r, b, at));
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) r.fail(`${where}.khoi`, `id "${b.id}" bi trung`);
    seen.add(b.id);
  }
  return blocks;
}

function parseProfileTemplate(r: ShapeReader, raw: unknown, where: string): ProfileTemplate {
  if (raw === undefined) return { goiY: {}, chinhSach: { doiTra: "", ship: "", baoHanh: "" } };
  const o = r.object(raw, where);
  const goiY = o["goiY"] === undefined ? {} : r.object(o["goiY"], `${where}.goiY`);
  const cs = o["chinhSach"] === undefined ? {} : r.object(o["chinhSach"], `${where}.chinhSach`);
  return {
    goiY: { ...goiY },
    chinhSach: {
      doiTra: r.longText(cs["doiTra"], `${where}.chinhSach.doiTra`, true),
      ship: r.longText(cs["ship"], `${where}.chinhSach.ship`, true),
      baoHanh: r.longText(cs["baoHanh"], `${where}.chinhSach.baoHanh`, true)
    }
  };
}

/** Reads the agent profile (`agent.json`). An industry with no file is answered by the rules alone. */
function parseAgent(r: ShapeReader, raw: Record<string, unknown>): PackAgent {
  return {
    khoi: parseBlocks(r, raw, "agent"),
    mauHoSo: parseProfileTemplate(r, raw["mauHoSo"], "agent.mauHoSo"),
    mustHumanPattern: r.text(raw["mustHumanPattern"], "agent.mustHumanPattern", true),
    handoffReplyPattern: r.text(raw["handoffReplyPattern"], "agent.handoffReplyPattern", true),
    tools: r.list(raw["tools"], "agent.tools", (t, at) => parseAgentTool(r, t, at), true)
  };
}

/**
 * Reads tier 1's instructions (`loi-chung/agent-chung.json`), or throws `PackShapeError` naming the
 * field. `null` / `undefined` (no file) is an empty tier 1: the industries then carry everything.
 */
export function parseCommonAgent(raw: unknown): CommonAgent {
  if (raw === null || raw === undefined) return { khoi: [], mustHumanPattern: "", handoffReplyPattern: "", cauCam: [] };
  const r = new ShapeReader();
  const o = r.object(raw, "loi-chung");
  const common: CommonAgent = {
    khoi: parseBlocks(r, o, "loi-chung"),
    mustHumanPattern: r.text(o["mustHumanPattern"], "loi-chung.mustHumanPattern", true),
    handoffReplyPattern: r.text(o["handoffReplyPattern"], "loi-chung.handoffReplyPattern", true),
    cauCam: r.texts(o["cauCam"], "loi-chung.cauCam", true)
  };
  if (r.problems.length > 0) throw new PackShapeError("loi-chung", r.problems);
  return common;
}

/**
 * Turns parsed JSON into an `IndustryPack`, or throws `PackShapeError` listing every problem.
 *
 * @param raw the contents of `bo-luat.json`
 * @param agentRaw the contents of `agent.json`, or `undefined` when the industry has no AI agent
 * @param dialogueRaw the contents of `khung-hoi-thoai.json` (the industry's part of the dialogue frame), optional
 * @param systemNoteRaw the contents of `ghi-chu-he-thong.json` (the industry's note wording), optional
 */
export function parsePack(raw: unknown, agentRaw?: unknown, dialogueRaw?: unknown, systemNoteRaw?: unknown, stage2: Stage2RawFiles = {}): IndustryPack {
  const r = new ShapeReader();
  const root = r.object(raw, "ho so");
  const id = r.text(root["id"], "id");
  const dialogue = dialogueRaw === undefined || dialogueRaw === null ? undefined : parseDialogueConfig(r, dialogueRaw, "khung-hoi-thoai");
  const systemNote = systemNoteRaw === undefined || systemNoteRaw === null ? undefined : parseSystemNoteTexts(r, systemNoteRaw, "ghi-chu-he-thong");
  const has = (v: unknown): boolean => v !== undefined && v !== null;
  const intentRules = has(stage2.intentRules) ? parseIntentRules(r, stage2.intentRules, "y-dinh") : undefined;
  const entities = has(stage2.entities) || has(stage2.sizeChart)
    ? parseEntityConfig(r, stage2.entities ?? {}, "thuc-the", stage2.sizeChart)
    : undefined;
  const scripts = has(stage2.scripts) ? parseScriptTexts(r, stage2.scripts, "kich-ban") : undefined;
  const matching = has(stage2.matching) ? parseMatchingConfig(r, stage2.matching, "cham-diem") : undefined;
  const replyGate = has(stage2.replyGate) ? parseReplyGateConfig(r, stage2.replyGate, "cong-soat") : undefined;

  const identityRaw = r.object(root["identity"], "identity");
  const lexiconRaw = r.object(root["lexicon"], "lexicon");
  const itemShapeRaw = r.object(root["itemShape"], "itemShape");

  const fillerWords = lexiconRaw["fillerWords"] === undefined ? undefined : r.texts(lexiconRaw["fillerWords"], "lexicon.fillerWords", true);
  const intentWhenItemNamed = root["intentWhenItemNamed"] === undefined ? undefined : r.text(root["intentWhenItemNamed"], "intentWhenItemNamed");
  const imageReferencePatterns = root["imageReferencePatterns"] === undefined ? undefined : r.texts(root["imageReferencePatterns"], "imageReferencePatterns", true);
  const extraValues = root["extraValues"] === undefined ? undefined : r.textMap(root["extraValues"], "extraValues", true);
  const agent = agentRaw === undefined || agentRaw === null ? undefined : parseAgent(r, r.object(agentRaw, "agent"));

  const pack: IndustryPack = {
    id,
    name: r.text(root["name"], "name"),
    identity: {
      customerPronoun: r.text(identityRaw["customerPronoun"], "identity.customerPronoun"),
      selfPronoun: r.text(identityRaw["selfPronoun"], "identity.selfPronoun"),
      tone: r.texts(identityRaw["tone"], "identity.tone", true),
      neverSay: r.texts(identityRaw["neverSay"], "identity.neverSay", true)
    },
    lexicon: {
      brands: r.texts(lexiconRaw["brands"], "lexicon.brands", true),
      knownBrandsNotCarried: r.texts(lexiconRaw["knownBrandsNotCarried"], "lexicon.knownBrandsNotCarried", true),
      categories: r.texts(lexiconRaw["categories"], "lexicon.categories", true),
      aliases: r.textMap(lexiconRaw["aliases"], "lexicon.aliases", true),
      genericTerms: r.texts(lexiconRaw["genericTerms"], "lexicon.genericTerms", true),
      ...(fillerWords ? { fillerWords } : {})
    },
    itemShape: { axes: r.list(itemShapeRaw["axes"], "itemShape.axes", (a, at) => parseAxis(r, a, at)) },
    intents: r.list(root["intents"], "intents", (i, at) => parseIntent(r, i, at)),
    allowedTools: r.tools(root["allowedTools"], "allowedTools"),
    gates: r.list(root["gates"], "gates", (g, at) => parseGate(r, g, at)),
    templates: r.textMap(root["templates"], "templates"),
    ...(intentWhenItemNamed ? { intentWhenItemNamed } : {}),
    ...(imageReferencePatterns ? { imageReferencePatterns } : {}),
    ...(extraValues ? { extraValues } : {}),
    ...(agent ? { agent } : {}),
    ...(dialogue ? { dialogue } : {}),
    ...(systemNote ? { systemNote } : {}),
    ...(intentRules ? { intentRules } : {}),
    ...(entities ? { entities } : {}),
    ...(scripts ? { scripts } : {}),
    ...(matching ? { matching } : {}),
    ...(replyGate ? { replyGate } : {})
  };

  if (r.problems.length > 0) throw new PackShapeError(id || "(khong ro)", r.problems);
  return pack;
}

/** The industry's stage-2 files (24/09/2026): intents, entities, the tag → size chart, scripts. All optional. */
export interface Stage2RawFiles {
  /** `y-dinh.json` */
  intentRules?: unknown;
  /** `thuc-the.json` */
  entities?: unknown;
  /** `bang-size.json` */
  sizeChart?: unknown;
  /** `kich-ban.json` */
  scripts?: unknown;
  /** `cham-diem.json` (stage 3, 25/09/2026): the industry's catalog-matching data. */
  matching?: unknown;
  /** `cong-soat.json` (stage 6, 25/09/2026): the industry's part of the reply gate. */
  replyGate?: unknown;
}

// ------------------------------------------------ Tier 1 of Sales Desk: frame, episode, ledger, note
//
// Every field of these three files is OPTIONAL and defaults to empty: an industry that ships none
// of them (the pharmacy) must keep working, and tier 1's file is what carries the generic part.
// The merge rule is simple enough to hold in one's head: LISTS ARE CONCATENATED (tier 1 first),
// STRINGS AND MAPS ARE OVERRIDDEN KEY BY KEY when the industry says something.

/** A `{ key: "text" }` map where an EMPTY text is allowed (a label deliberately blank, like `kindTexts.none`). */
function looseTextMap(r: ShapeReader, value: unknown, where: string): Record<string, string> {
  if (value === undefined) return {};
  const source = r.object(value, where);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) out[key] = r.text(item, `${where}.${key}`, true);
  return out;
}

/** A `{ key: ["regex", …] }` map; missing = `{}`. */
function textListMap(r: ShapeReader, value: unknown, where: string): Record<string, string[]> {
  if (value === undefined) return {};
  const source = r.object(value, where);
  const out: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(source)) out[key] = r.texts(item, `${where}.${key}`, true);
  return out;
}

export function emptyEpisodeConfig(): EpisodeConfig {
  return {
    dismiss: "", dismissLeading: "", compare: "", rebuy: "", orderConfirmed: "",
    transactionalIntents: [], closingIntents: [], checkoutStates: [], placedStates: [], afterOrderIntents: [],
    roleLabels: {}, stageLabels: {}, outcomeLabels: {}, texts: {}
  };
}

export function emptyDialogueConfig(): DialogueConfig {
  return {
    pageTurnOrder: [], pageTurn: {}, askedOther: [], ack: "", deny: "", refer: "", sizeOnly: [],
    productCodePatterns: [], productLinkPatterns: [], imagePlaceholders: [], nameNoiseWords: [],
    shortAnswer: { maxWords: 6, maxChars: 60 }, kindTexts: {}, answerTexts: {}, aboutTexts: {}, frameFormat: "",
    episode: emptyEpisodeConfig()
  };
}

function parseEpisodeConfig(r: ShapeReader, raw: unknown, where: string): EpisodeConfig {
  if (raw === undefined) return emptyEpisodeConfig();
  const o = r.object(raw, where);
  const t = (key: string): string => r.text(o[key], `${where}.${key}`, true);
  const l = (key: string): string[] => r.texts(o[key], `${where}.${key}`, true);
  const m = (key: string): Record<string, string> => looseTextMap(r, o[key], `${where}.${key}`);
  return {
    dismiss: t("dismiss"), dismissLeading: t("dismissLeading"), compare: t("compare"), rebuy: t("rebuy"), orderConfirmed: t("orderConfirmed"),
    transactionalIntents: l("transactionalIntents"), closingIntents: l("closingIntents"), checkoutStates: l("checkoutStates"),
    placedStates: l("placedStates"), afterOrderIntents: l("afterOrderIntents"),
    roleLabels: m("roleLabels"), stageLabels: m("stageLabels"), outcomeLabels: m("outcomeLabels"), texts: m("texts")
  };
}

/** Reads one `khung-hoi-thoai.json` (tier 1's or an industry's) with every field optional. */
export function parseDialogueConfig(r: ShapeReader, raw: unknown, where: string): DialogueConfig {
  const o = r.object(raw, where);
  const t = (key: string): string => r.text(o[key], `${where}.${key}`, true);
  const l = (key: string): string[] => r.texts(o[key], `${where}.${key}`, true);
  const m = (key: string): Record<string, string> => looseTextMap(r, o[key], `${where}.${key}`);
  const short = o["shortAnswer"] === undefined ? {} : r.object(o["shortAnswer"], `${where}.shortAnswer`);
  return {
    pageTurnOrder: l("pageTurnOrder"),
    pageTurn: textListMap(r, o["pageTurn"], `${where}.pageTurn`),
    askedOther: l("askedOther"),
    ack: t("ack"), deny: t("deny"), refer: t("refer"),
    sizeOnly: l("sizeOnly"),
    productCodePatterns: l("productCodePatterns"),
    productLinkPatterns: l("productLinkPatterns"),
    imagePlaceholders: l("imagePlaceholders"),
    nameNoiseWords: l("nameNoiseWords"),
    shortAnswer: {
      maxWords: short["maxWords"] === undefined ? 6 : r.number(short["maxWords"], `${where}.shortAnswer.maxWords`),
      maxChars: short["maxChars"] === undefined ? 60 : r.number(short["maxChars"], `${where}.shortAnswer.maxChars`)
    },
    kindTexts: m("kindTexts"), answerTexts: m("answerTexts"), aboutTexts: m("aboutTexts"), frameFormat: t("frameFormat"),
    episode: parseEpisodeConfig(r, o["episode"], `${where}.episode`)
  };
}

/** Tier 1's dialogue config from parsed JSON; `null`/`undefined` (no file) is empty. Throws naming the field. */
export function parseCommonDialogue(raw: unknown): DialogueConfig {
  if (raw === null || raw === undefined) return emptyDialogueConfig();
  const r = new ShapeReader();
  const config = parseDialogueConfig(r, raw, "loi-chung/khung-hoi-thoai");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/khung-hoi-thoai", r.problems);
  return config;
}

/** The industry's frame on top of tier 1's: lists concatenated, strings and map keys overridden when set. */
export function mergeDialogueConfig(common: DialogueConfig, industry: DialogueConfig | undefined): DialogueConfig {
  if (industry === undefined) return common;
  const lists = (a: string[], b: string[]): string[] => [...a, ...b];
  const text = (a: string, b: string): string => (b !== "" ? b : a);
  const map = (a: Record<string, string>, b: Record<string, string>): Record<string, string> => ({ ...a, ...b });
  const pageTurn: Record<string, string[]> = { ...common.pageTurn };
  for (const [kind, patterns] of Object.entries(industry.pageTurn)) pageTurn[kind] = lists(pageTurn[kind] ?? [], patterns);
  const e = common.episode;
  const f = industry.episode;
  return {
    pageTurnOrder: industry.pageTurnOrder.length > 0 ? industry.pageTurnOrder : common.pageTurnOrder,
    pageTurn,
    askedOther: lists(common.askedOther, industry.askedOther),
    ack: text(common.ack, industry.ack), deny: text(common.deny, industry.deny), refer: text(common.refer, industry.refer),
    sizeOnly: lists(common.sizeOnly, industry.sizeOnly),
    productCodePatterns: lists(common.productCodePatterns, industry.productCodePatterns),
    productLinkPatterns: lists(common.productLinkPatterns, industry.productLinkPatterns),
    imagePlaceholders: lists(common.imagePlaceholders, industry.imagePlaceholders),
    nameNoiseWords: lists(common.nameNoiseWords, industry.nameNoiseWords),
    shortAnswer: industry.shortAnswer,
    kindTexts: map(common.kindTexts, industry.kindTexts), answerTexts: map(common.answerTexts, industry.answerTexts),
    aboutTexts: map(common.aboutTexts, industry.aboutTexts), frameFormat: text(common.frameFormat, industry.frameFormat),
    episode: {
      dismiss: text(e.dismiss, f.dismiss), dismissLeading: text(e.dismissLeading, f.dismissLeading), compare: text(e.compare, f.compare),
      rebuy: text(e.rebuy, f.rebuy), orderConfirmed: text(e.orderConfirmed, f.orderConfirmed),
      transactionalIntents: lists(e.transactionalIntents, f.transactionalIntents), closingIntents: lists(e.closingIntents, f.closingIntents),
      checkoutStates: lists(e.checkoutStates, f.checkoutStates), placedStates: lists(e.placedStates, f.placedStates),
      afterOrderIntents: lists(e.afterOrderIntents, f.afterOrderIntents),
      roleLabels: map(e.roleLabels, f.roleLabels), stageLabels: map(e.stageLabels, f.stageLabels),
      outcomeLabels: map(e.outcomeLabels, f.outcomeLabels), texts: map(e.texts, f.texts)
    }
  };
}

export function emptyLedgerTexts(): LedgerTexts {
  return {
    header: "", externalClosingNote: "", ordersHeader: "", orderTracking: "", summariesHeader: "", customerGoal: "", openThread: "",
    fieldLabels: {}, statusLabels: {}, sourceLabels: {}, statusByIntent: {}, stockAnswers: {}, alternativeNote: "", unmatchedNote: "",
    notProductPatterns: [], addressPatterns: [], receiptTextPatterns: [], receiptAmountPattern: "", receiptOrderPattern: "", imageLabels: {}
  };
}

/** Tier 1's ledger wording (`so-hoi-thoai.json`); `null`/`undefined` is empty. Throws naming the field. */
export function parseLedgerTexts(raw: unknown): LedgerTexts {
  if (raw === null || raw === undefined) return emptyLedgerTexts();
  const r = new ShapeReader();
  const where = "loi-chung/so-hoi-thoai";
  const o = r.object(raw, where);
  const t = (key: string): string => r.text(o[key], `${where}.${key}`, true);
  const l = (key: string): string[] => r.texts(o[key], `${where}.${key}`, true);
  const m = (key: string): Record<string, string> => looseTextMap(r, o[key], `${where}.${key}`);
  const texts: LedgerTexts = {
    header: t("header"), externalClosingNote: t("externalClosingNote"), ordersHeader: t("ordersHeader"), orderTracking: t("orderTracking"),
    summariesHeader: t("summariesHeader"), customerGoal: t("customerGoal"), openThread: t("openThread"),
    fieldLabels: m("fieldLabels"), statusLabels: m("statusLabels"), sourceLabels: m("sourceLabels"), statusByIntent: m("statusByIntent"),
    stockAnswers: m("stockAnswers"), alternativeNote: t("alternativeNote"), unmatchedNote: t("unmatchedNote"),
    notProductPatterns: l("notProductPatterns"), addressPatterns: l("addressPatterns"), receiptTextPatterns: l("receiptTextPatterns"),
    receiptAmountPattern: t("receiptAmountPattern"), receiptOrderPattern: t("receiptOrderPattern"), imageLabels: m("imageLabels")
  };
  if (r.problems.length > 0) throw new PackShapeError(where, r.problems);
  return texts;
}

export function emptySystemNoteTexts(): SystemNoteTexts {
  return { order: [], blocks: {} };
}

/** Reads one `ghi-chu-he-thong.json`. A block template may be written as an array of lines. */
export function parseSystemNoteTexts(r: ShapeReader, raw: unknown, where: string): SystemNoteTexts {
  const o = r.object(raw, where);
  const blocksRaw = o["blocks"] === undefined ? {} : r.object(o["blocks"], `${where}.blocks`);
  const blocks: Record<string, string> = {};
  for (const [key, item] of Object.entries(blocksRaw)) blocks[key] = r.longText(item, `${where}.blocks.${key}`, true);
  return { order: r.texts(o["order"], `${where}.order`, true), blocks };
}

/** Tier 1's note wording; `null`/`undefined` is empty. Throws naming the field. */
export function parseCommonSystemNote(raw: unknown): SystemNoteTexts {
  if (raw === null || raw === undefined) return emptySystemNoteTexts();
  const r = new ShapeReader();
  const texts = parseSystemNoteTexts(r, raw, "loi-chung/ghi-chu-he-thong");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/ghi-chu-he-thong", r.problems);
  return texts;
}

/** The industry's note wording on top of tier 1's: block by block; the order is tier 1's unless the industry states one. */
export function mergeSystemNoteTexts(common: SystemNoteTexts, industry: SystemNoteTexts | undefined): SystemNoteTexts {
  if (industry === undefined) return common;
  return { order: industry.order.length > 0 ? industry.order : common.order, blocks: { ...common.blocks, ...industry.blocks } };
}

// ------------------------------------ Stage 2 of tier 1 (24/09/2026): intents, entities, scripts
//
// Same rules as the frame: every field optional and empty by default; LISTS ARE CONCATENATED (tier 1
// first), STRINGS, NUMBERS AND MAP KEYS ARE OVERRIDDEN when the industry says something. Intent
// rules are merged BY INTENT NAME: the industry adds keywords to "complaint_or_human", it does not
// declare a second rule of that name.

/** An optional number: missing = `fallback`, present = must be a number. */
function optNumber(r: ShapeReader, value: unknown, where: string, fallback: number): number {
  return value === undefined ? fallback : r.number(value, where);
}

function parseIntentRule(r: ShapeReader, raw: Record<string, unknown>, where: string): IntentRule {
  return {
    intent: r.text(raw["intent"], `${where}.intent`),
    confidence: optNumber(r, raw["confidence"], `${where}.confidence`, 0),
    keywords: r.texts(raw["keywords"], `${where}.keywords`, true)
  };
}

export function emptyIntentRules(): IntentRules {
  return {
    rules: [], transactionalIntents: [], greetingTokens: [], greetingMaxWords: 6, paidMoney: "", paidAboutGoods: "",
    deposit: { moneyWords: "", pastPayment: "", asksCondition: "", orderTalk: "", asksAccount: "" },
    paymentFrame: { moneyTalk: "", explicitlyAsksBank: "", pastPayment: [], dispute: "", receiptSeen: "", collected: "", historyDepth: 10 },
    reconcile: {
      scriptOverrideIntents: [], scriptOverrideUnlessRequest: [], carriesRequest: [], smallTalkMaxWords: 6, nudge: "", pageAsked: "",
      shortAnswerToPage: "", bareAck: "", thanks: "", pageSaidPaid: "", customerReceiptImage: "", buysMore: "", asksForPhotos: "",
      adviceRequest: "", paymentContextCustomer: "", paymentContextPage: "", sadPhrase: "", policyQuestion: "", shippingFee: "", asksFootMeasure: "", policyQuestionForm: "", returnExchangeReal: "", impatience: ""
    }
  };
}

/** Reads one `y-dinh(-chung).json` with every field optional. */
export function parseIntentRules(r: ShapeReader, raw: unknown, where: string): IntentRules {
  const o = r.object(raw, where);
  const t = (src: Record<string, unknown>, key: string, at: string): string => r.text(src[key], `${at}.${key}`, true);
  const l = (src: Record<string, unknown>, key: string, at: string): string[] => r.texts(src[key], `${at}.${key}`, true);
  const dep = o["deposit"] === undefined ? {} : r.object(o["deposit"], `${where}.deposit`);
  const pf = o["paymentFrame"] === undefined ? {} : r.object(o["paymentFrame"], `${where}.paymentFrame`);
  const rc = o["reconcile"] === undefined ? {} : r.object(o["reconcile"], `${where}.reconcile`);
  const rcAt = `${where}.reconcile`;
  return {
    rules: o["rules"] === undefined ? [] : r.list(o["rules"], `${where}.rules`, (item, at) => parseIntentRule(r, item, at)),
    transactionalIntents: l(o, "transactionalIntents", where),
    greetingTokens: l(o, "greetingTokens", where),
    greetingMaxWords: optNumber(r, o["greetingMaxWords"], `${where}.greetingMaxWords`, 0),
    paidMoney: t(o, "paidMoney", where),
    paidAboutGoods: t(o, "paidAboutGoods", where),
    deposit: {
      moneyWords: t(dep, "moneyWords", `${where}.deposit`), pastPayment: t(dep, "pastPayment", `${where}.deposit`),
      asksCondition: t(dep, "asksCondition", `${where}.deposit`), orderTalk: t(dep, "orderTalk", `${where}.deposit`),
      asksAccount: t(dep, "asksAccount", `${where}.deposit`)
    },
    paymentFrame: {
      moneyTalk: t(pf, "moneyTalk", `${where}.paymentFrame`), explicitlyAsksBank: t(pf, "explicitlyAsksBank", `${where}.paymentFrame`),
      pastPayment: l(pf, "pastPayment", `${where}.paymentFrame`), dispute: t(pf, "dispute", `${where}.paymentFrame`),
      receiptSeen: t(pf, "receiptSeen", `${where}.paymentFrame`), collected: t(pf, "collected", `${where}.paymentFrame`),
      historyDepth: optNumber(r, pf["historyDepth"], `${where}.paymentFrame.historyDepth`, 0)
    },
    reconcile: {
      scriptOverrideIntents: l(rc, "scriptOverrideIntents", rcAt), scriptOverrideUnlessRequest: l(rc, "scriptOverrideUnlessRequest", rcAt),
      carriesRequest: l(rc, "carriesRequest", rcAt), smallTalkMaxWords: optNumber(r, rc["smallTalkMaxWords"], `${rcAt}.smallTalkMaxWords`, 0),
      nudge: t(rc, "nudge", rcAt), pageAsked: t(rc, "pageAsked", rcAt), shortAnswerToPage: t(rc, "shortAnswerToPage", rcAt),
      bareAck: t(rc, "bareAck", rcAt), thanks: t(rc, "thanks", rcAt), pageSaidPaid: t(rc, "pageSaidPaid", rcAt),
      customerReceiptImage: t(rc, "customerReceiptImage", rcAt), buysMore: t(rc, "buysMore", rcAt), asksForPhotos: t(rc, "asksForPhotos", rcAt),
      adviceRequest: t(rc, "adviceRequest", rcAt), paymentContextCustomer: t(rc, "paymentContextCustomer", rcAt),
      paymentContextPage: t(rc, "paymentContextPage", rcAt), sadPhrase: t(rc, "sadPhrase", rcAt), policyQuestion: t(rc, "policyQuestion", rcAt),
      shippingFee: t(rc, "shippingFee", rcAt), asksFootMeasure: t(rc, "asksFootMeasure", rcAt),
      policyQuestionForm: t(rc, "policyQuestionForm", rcAt), returnExchangeReal: t(rc, "returnExchangeReal", rcAt), impatience: t(rc, "impatience", rcAt)
    }
  };
}

/** Tier 1's intent rules; `null`/`undefined` (no file) is empty. Throws naming the field. */
export function parseCommonIntentRules(raw: unknown): IntentRules {
  if (raw === null || raw === undefined) return emptyIntentRules();
  const r = new ShapeReader();
  const rules = parseIntentRules(r, raw, "loi-chung/y-dinh-chung");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/y-dinh-chung", r.problems);
  return rules;
}

const overrideText = (a: string, b: string): string => (b !== "" ? b : a);
const overrideNumber = (a: number, b: number): number => (b > 0 ? b : a);
const concatLists = (a: string[], b: string[]): string[] => [...a, ...b];

/** The industry's intent rules on top of tier 1's: keywords joined per intent, confidence overridden when set. */
export function mergeIntentRules(common: IntentRules, industry: IntentRules | undefined): IntentRules {
  if (industry === undefined) return common;
  const rules: IntentRule[] = common.rules.map((rule) => ({ ...rule, keywords: [...rule.keywords] }));
  for (const extra of industry.rules) {
    const own = rules.find((rule) => rule.intent === extra.intent);
    if (own === undefined) { rules.push({ ...extra, keywords: [...extra.keywords] }); continue; }
    own.keywords.push(...extra.keywords);
    own.confidence = overrideNumber(own.confidence, extra.confidence);
  }
  const d = common.deposit; const e = industry.deposit;
  const p = common.paymentFrame; const q = industry.paymentFrame;
  const x = common.reconcile; const y = industry.reconcile;
  return {
    rules,
    transactionalIntents: concatLists(common.transactionalIntents, industry.transactionalIntents),
    greetingTokens: concatLists(common.greetingTokens, industry.greetingTokens),
    greetingMaxWords: overrideNumber(common.greetingMaxWords, industry.greetingMaxWords),
    paidMoney: overrideText(common.paidMoney, industry.paidMoney),
    paidAboutGoods: overrideText(common.paidAboutGoods, industry.paidAboutGoods),
    deposit: {
      moneyWords: overrideText(d.moneyWords, e.moneyWords), pastPayment: overrideText(d.pastPayment, e.pastPayment),
      asksCondition: overrideText(d.asksCondition, e.asksCondition), orderTalk: overrideText(d.orderTalk, e.orderTalk),
      asksAccount: overrideText(d.asksAccount, e.asksAccount)
    },
    paymentFrame: {
      moneyTalk: overrideText(p.moneyTalk, q.moneyTalk), explicitlyAsksBank: overrideText(p.explicitlyAsksBank, q.explicitlyAsksBank),
      pastPayment: concatLists(p.pastPayment, q.pastPayment), dispute: overrideText(p.dispute, q.dispute),
      receiptSeen: overrideText(p.receiptSeen, q.receiptSeen), collected: overrideText(p.collected, q.collected),
      historyDepth: overrideNumber(p.historyDepth, q.historyDepth)
    },
    reconcile: {
      scriptOverrideIntents: concatLists(x.scriptOverrideIntents, y.scriptOverrideIntents),
      scriptOverrideUnlessRequest: concatLists(x.scriptOverrideUnlessRequest, y.scriptOverrideUnlessRequest),
      carriesRequest: concatLists(x.carriesRequest, y.carriesRequest),
      smallTalkMaxWords: overrideNumber(x.smallTalkMaxWords, y.smallTalkMaxWords),
      nudge: overrideText(x.nudge, y.nudge), pageAsked: overrideText(x.pageAsked, y.pageAsked),
      shortAnswerToPage: overrideText(x.shortAnswerToPage, y.shortAnswerToPage), bareAck: overrideText(x.bareAck, y.bareAck),
      thanks: overrideText(x.thanks, y.thanks), pageSaidPaid: overrideText(x.pageSaidPaid, y.pageSaidPaid),
      customerReceiptImage: overrideText(x.customerReceiptImage, y.customerReceiptImage), buysMore: overrideText(x.buysMore, y.buysMore),
      asksForPhotos: overrideText(x.asksForPhotos, y.asksForPhotos), adviceRequest: overrideText(x.adviceRequest, y.adviceRequest),
      paymentContextCustomer: overrideText(x.paymentContextCustomer, y.paymentContextCustomer),
      paymentContextPage: overrideText(x.paymentContextPage, y.paymentContextPage), sadPhrase: overrideText(x.sadPhrase, y.sadPhrase),
      policyQuestion: overrideText(x.policyQuestion, y.policyQuestion), shippingFee: overrideText(x.shippingFee, y.shippingFee),
      asksFootMeasure: overrideText(x.asksFootMeasure, y.asksFootMeasure),
      policyQuestionForm: overrideText(x.policyQuestionForm, y.policyQuestionForm), returnExchangeReal: overrideText(x.returnExchangeReal, y.returnExchangeReal),
      impatience: overrideText(x.impatience, y.impatience)
    }
  };
}

export function emptyEntityConfig(): EntityConfig {
  return {
    phone: "", productCodeFallback: "", productCodeIgnore: [], productCodeNotCode: [], nameNoiseWords: [], orderTalk: "",
    address: { markers: "", placeWords: "", houseNumber: "", maxLength: 0, minWords: 0, notPlaceBigrams: [] },
    budget: { trigger: "", amount: "", millionUnits: [], thousandUnits: [], minValue: 0, range: "", from: "", upTo: "" },
    genders: {}, closingSignals: [], sizeLetterPattern: "", sizeRecoverPattern: "", sizeRecoverNegation: "", sizeRecoverDepth: 0,
    sizeCore: "", sizePatterns: [], sizeTagPatterns: [], sizeBarePatterns: [], apparelSizePatterns: [], apparelSizePrefix: "",
    bareTag: { range: "", maxTem: 0, unitAfter: "", notBefore: "", footMeasure: "", tagWord: "", kidsText: "", apparelWords: "", kidsLine: "", adultMin: 0, historyDepth: 0 },
    needs: [], footForms: {}, sizeChart: []
  };
}

/** Reads a `bang-size.json` (`{ rows: [{tem, size, daiChanCm}] }`), or `[]` when absent. */
export function parseSizeChart(r: ShapeReader, raw: unknown, where: string): SizeChartRow[] {
  if (raw === undefined || raw === null) return [];
  const o = r.object(raw, where);
  if (o["rows"] === undefined) return [];
  return r.list(o["rows"], `${where}.rows`, (row, at) => ({
    tem: r.number(row["tem"], `${at}.tem`),
    size: r.text(row["size"], `${at}.size`),
    daiChanCm: optNumber(r, row["daiChanCm"], `${at}.daiChanCm`, 0)
  }));
}

/** Reads one `thuc-the(-chung).json` (+ its `bang-size.json`) with every field optional. */
export function parseEntityConfig(r: ShapeReader, raw: unknown, where: string, sizeChartRaw?: unknown): EntityConfig {
  const o = r.object(raw, where);
  const t = (src: Record<string, unknown>, key: string, at: string): string => r.text(src[key], `${at}.${key}`, true);
  const l = (src: Record<string, unknown>, key: string, at: string): string[] => r.texts(src[key], `${at}.${key}`, true);
  const n = (src: Record<string, unknown>, key: string, at: string): number => optNumber(r, src[key], `${at}.${key}`, 0);
  const ad = o["address"] === undefined ? {} : r.object(o["address"], `${where}.address`);
  const bu = o["budget"] === undefined ? {} : r.object(o["budget"], `${where}.budget`);
  const bt = o["bareTag"] === undefined ? {} : r.object(o["bareTag"], `${where}.bareTag`);
  const adAt = `${where}.address`; const buAt = `${where}.budget`; const btAt = `${where}.bareTag`;
  const footForms: Record<string, string[]> = {};
  if (o["footForms"] !== undefined) {
    for (const [key, item] of Object.entries(r.object(o["footForms"], `${where}.footForms`))) footForms[key] = r.texts(item, `${where}.footForms.${key}`, true);
  }
  return {
    phone: t(o, "phone", where), productCodeFallback: t(o, "productCodeFallback", where),
    productCodeIgnore: l(o, "productCodeIgnore", where), productCodeNotCode: l(o, "productCodeNotCode", where),
    nameNoiseWords: l(o, "nameNoiseWords", where),
    orderTalk: t(o, "orderTalk", where),
    address: {
      markers: t(ad, "markers", adAt), placeWords: t(ad, "placeWords", adAt), houseNumber: t(ad, "houseNumber", adAt),
      maxLength: n(ad, "maxLength", adAt), minWords: n(ad, "minWords", adAt), notPlaceBigrams: l(ad, "notPlaceBigrams", adAt)
    },
    budget: {
      trigger: t(bu, "trigger", buAt), amount: t(bu, "amount", buAt), millionUnits: l(bu, "millionUnits", buAt),
      thousandUnits: l(bu, "thousandUnits", buAt), minValue: n(bu, "minValue", buAt), range: t(bu, "range", buAt),
      from: t(bu, "from", buAt), upTo: t(bu, "upTo", buAt)
    },
    genders: o["genders"] === undefined ? {} : r.textMap(o["genders"], `${where}.genders`, true),
    closingSignals: l(o, "closingSignals", where),
    sizeLetterPattern: t(o, "sizeLetterPattern", where), sizeRecoverPattern: t(o, "sizeRecoverPattern", where),
    sizeRecoverNegation: t(o, "sizeRecoverNegation", where), sizeRecoverDepth: n(o, "sizeRecoverDepth", where),
    sizeCore: t(o, "sizeCore", where), sizePatterns: l(o, "sizePatterns", where), sizeTagPatterns: l(o, "sizeTagPatterns", where),
    sizeBarePatterns: l(o, "sizeBarePatterns", where), apparelSizePatterns: l(o, "apparelSizePatterns", where),
    apparelSizePrefix: t(o, "apparelSizePrefix", where),
    bareTag: {
      range: t(bt, "range", btAt), maxTem: n(bt, "maxTem", btAt), unitAfter: t(bt, "unitAfter", btAt), notBefore: t(bt, "notBefore", btAt),
      footMeasure: t(bt, "footMeasure", btAt), tagWord: t(bt, "tagWord", btAt), kidsText: t(bt, "kidsText", btAt),
      apparelWords: t(bt, "apparelWords", btAt), kidsLine: t(bt, "kidsLine", btAt), adultMin: n(bt, "adultMin", btAt),
      historyDepth: n(bt, "historyDepth", btAt)
    },
    needs: l(o, "needs", where), footForms,
    sizeChart: parseSizeChart(r, sizeChartRaw, `${where}/bang-size`)
  };
}

/** Tier 1's entity patterns; `null`/`undefined` (no file) is empty. Throws naming the field. */
export function parseCommonEntityConfig(raw: unknown): EntityConfig {
  if (raw === null || raw === undefined) return emptyEntityConfig();
  const r = new ShapeReader();
  const config = parseEntityConfig(r, raw, "loi-chung/thuc-the-chung");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/thuc-the-chung", r.problems);
  return config;
}

/** The industry's entity patterns on top of tier 1's: lists concatenated, strings / numbers / map keys overridden when set. */
export function mergeEntityConfig(common: EntityConfig, industry: EntityConfig | undefined): EntityConfig {
  if (industry === undefined) return common;
  const a = common.address; const b = industry.address;
  const c = common.budget; const d = industry.budget;
  const e = common.bareTag; const f = industry.bareTag;
  const footForms: Record<string, string[]> = { ...common.footForms };
  for (const [key, list] of Object.entries(industry.footForms)) footForms[key] = concatLists(footForms[key] ?? [], list);
  return {
    phone: overrideText(common.phone, industry.phone), productCodeFallback: overrideText(common.productCodeFallback, industry.productCodeFallback),
    productCodeIgnore: concatLists(common.productCodeIgnore, industry.productCodeIgnore),
    productCodeNotCode: concatLists(common.productCodeNotCode, industry.productCodeNotCode),
    nameNoiseWords: concatLists(common.nameNoiseWords, industry.nameNoiseWords),
    orderTalk: overrideText(common.orderTalk, industry.orderTalk),
    address: {
      markers: overrideText(a.markers, b.markers), placeWords: overrideText(a.placeWords, b.placeWords),
      houseNumber: overrideText(a.houseNumber, b.houseNumber), maxLength: overrideNumber(a.maxLength, b.maxLength),
      minWords: overrideNumber(a.minWords, b.minWords), notPlaceBigrams: concatLists(a.notPlaceBigrams, b.notPlaceBigrams)
    },
    budget: {
      trigger: overrideText(c.trigger, d.trigger), amount: overrideText(c.amount, d.amount),
      millionUnits: concatLists(c.millionUnits, d.millionUnits), thousandUnits: concatLists(c.thousandUnits, d.thousandUnits),
      minValue: overrideNumber(c.minValue, d.minValue), range: overrideText(c.range, d.range), from: overrideText(c.from, d.from),
      upTo: overrideText(c.upTo, d.upTo)
    },
    genders: { ...common.genders, ...industry.genders },
    closingSignals: concatLists(common.closingSignals, industry.closingSignals),
    sizeLetterPattern: overrideText(common.sizeLetterPattern, industry.sizeLetterPattern),
    sizeRecoverPattern: overrideText(common.sizeRecoverPattern, industry.sizeRecoverPattern),
    sizeRecoverNegation: overrideText(common.sizeRecoverNegation, industry.sizeRecoverNegation),
    sizeRecoverDepth: overrideNumber(common.sizeRecoverDepth, industry.sizeRecoverDepth),
    sizeCore: overrideText(common.sizeCore, industry.sizeCore),
    sizePatterns: concatLists(common.sizePatterns, industry.sizePatterns),
    sizeTagPatterns: concatLists(common.sizeTagPatterns, industry.sizeTagPatterns),
    sizeBarePatterns: concatLists(common.sizeBarePatterns, industry.sizeBarePatterns),
    apparelSizePatterns: concatLists(common.apparelSizePatterns, industry.apparelSizePatterns),
    apparelSizePrefix: overrideText(common.apparelSizePrefix, industry.apparelSizePrefix),
    bareTag: {
      range: overrideText(e.range, f.range), maxTem: overrideNumber(e.maxTem, f.maxTem), unitAfter: overrideText(e.unitAfter, f.unitAfter),
      notBefore: overrideText(e.notBefore, f.notBefore), footMeasure: overrideText(e.footMeasure, f.footMeasure),
      tagWord: overrideText(e.tagWord, f.tagWord), kidsText: overrideText(e.kidsText, f.kidsText),
      apparelWords: overrideText(e.apparelWords, f.apparelWords), kidsLine: overrideText(e.kidsLine, f.kidsLine),
      adultMin: overrideNumber(e.adultMin, f.adultMin), historyDepth: overrideNumber(e.historyDepth, f.historyDepth)
    },
    needs: concatLists(common.needs, industry.needs), footForms,
    sizeChart: [...common.sizeChart, ...industry.sizeChart]
  };
}

export function emptyScriptTexts(): ScriptTexts {
  return { scripts: {}, hoiLai: {} };
}

const SCRIPT_ACTIONS: readonly ScriptAction[] = ["script_reply", "human_handoff", "ask_clarification"];

/** Reads one `kich-ban(-chung).json`: `{ scripts: { id: {action, reply, safeToAutoSend?} }, hoiLai: { reason: text } }`. */
export function parseScriptTexts(r: ShapeReader, raw: unknown, where: string): ScriptTexts {
  const o = r.object(raw, where);
  const scripts: Record<string, ScriptEntry> = {};
  const list = o["scripts"] === undefined ? {} : r.object(o["scripts"], `${where}.scripts`);
  for (const [id, item] of Object.entries(list)) {
    const at = `${where}.scripts.${id}`;
    const entry = r.object(item, at);
    const action = r.text(entry["action"], `${at}.action`);
    if (!SCRIPT_ACTIONS.includes(action as ScriptAction)) r.fail(`${at}.action`, `phai la mot trong: ${SCRIPT_ACTIONS.join(", ")}`);
    const safe = entry["safeToAutoSend"];
    scripts[id] = {
      action: action as ScriptAction,
      reply: r.longText(entry["reply"], `${at}.reply`),
      ...(safe === undefined ? {} : { safeToAutoSend: r.boolean(safe, `${at}.safeToAutoSend`) })
    };
  }
  return { scripts, hoiLai: o["hoiLai"] === undefined ? {} : r.textMap(o["hoiLai"], `${where}.hoiLai`, true) };
}

/** Tier 1's scripts; `null`/`undefined` (no file) is empty. Throws naming the field. */
export function parseCommonScriptTexts(raw: unknown): ScriptTexts {
  if (raw === null || raw === undefined) return emptyScriptTexts();
  const r = new ShapeReader();
  const texts = parseScriptTexts(r, raw, "loi-chung/kich-ban-chung");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/kich-ban-chung", r.problems);
  return texts;
}

/** The industry's scripts on top of tier 1's: script by script, ask-back sentence by reason. */
export function mergeScriptTexts(common: ScriptTexts, industry: ScriptTexts | undefined): ScriptTexts {
  if (industry === undefined) return common;
  return { scripts: { ...common.scripts, ...industry.scripts }, hoiLai: { ...common.hoiLai, ...industry.hoiLai } };
}

// ------------------------------------ Stage 3 of tier 1 (25/09/2026): catalog scoring, uncertain gate, stock facts
//
// Same rules again: every field optional and empty by default; LISTS ARE CONCATENATED (tier 1 first),
// STRINGS, NUMBERS AND MAP KEYS ARE OVERRIDDEN when the industry says something. A `_doc` key inside
// any block is the author's note and is skipped.

export function emptyTypeRules(): TypeRules {
  return { rules: [], aliases: {}, nonPrimaryTypes: [], primaryTypes: [], labels: {} };
}

export function emptyMatchingConfig(): MatchingConfig {
  return {
    weights: {}, retrieve: { minScore: 0, band: 0, limit: 0 },
    noiseTokens: [], genericNameTokens: [], lineGenericTokens: [], lineNoiseTokens: [], skuLikePattern: "",
    ambiguousVersion: { min: 0, max: 0 }, brandLineHints: {}, genderTokens: {},
    types: emptyTypeRules(),
    sizes: { apparelPrefix: "", letterSize: "", tolerance: 0, apparelMin: 0 },
    uncertain: {
      askProductIntents: [], productTalkIntents: [], coldHours: 0, imageLookbackMinutes: 0,
      specificItem: "", specificItemDiacritic: "", specificItemNoun: "", categoryQuestion: "", sizeHint: "", genericItemTokens: []
    },
    texts: {}
  };
}

/** A `{ key: number }` map (the weights); `_doc` skipped; missing = `{}`. */
function numberMap(r: ShapeReader, value: unknown, where: string): Record<string, number> {
  if (value === undefined) return {};
  const source = r.object(value, where);
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "_doc") continue;
    out[key] = r.number(item, `${where}.${key}`);
  }
  return out;
}

/** A `{ key: ["a", "b"] }` map (brand → line words); `_doc` skipped. */
function listMapNoDoc(r: ShapeReader, value: unknown, where: string): Record<string, string[]> {
  if (value === undefined) return {};
  const source = r.object(value, where);
  const out: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "_doc") continue;
    out[key] = r.texts(item, `${where}.${key}`, true);
  }
  return out;
}

/** A `{ key: "text" }` map with `_doc` skipped and empty texts allowed. */
function textMapNoDoc(r: ShapeReader, value: unknown, where: string): Record<string, string> {
  const out = looseTextMap(r, value, where);
  delete out["_doc"];
  return out;
}

function parseTypeRules(r: ShapeReader, raw: unknown, where: string): TypeRules {
  if (raw === undefined) return emptyTypeRules();
  const o = r.object(raw, where);
  return {
    rules: o["rules"] === undefined ? [] : r.list(o["rules"], `${where}.rules`, (rule, at) => ({
      kind: r.text(rule["kind"], `${at}.kind`),
      patterns: r.texts(rule["patterns"], `${at}.patterns`, true)
    })),
    aliases: textMapNoDoc(r, o["aliases"], `${where}.aliases`),
    nonPrimaryTypes: r.texts(o["nonPrimaryTypes"], `${where}.nonPrimaryTypes`, true),
    primaryTypes: r.texts(o["primaryTypes"], `${where}.primaryTypes`, true),
    labels: textMapNoDoc(r, o["labels"], `${where}.labels`)
  };
}

/** Reads one `cham-diem(-chung).json` with every field optional. */
export function parseMatchingConfig(r: ShapeReader, raw: unknown, where: string): MatchingConfig {
  const o = r.object(raw, where);
  const t = (src: Record<string, unknown>, key: string, at: string): string => r.text(src[key], `${at}.${key}`, true);
  const l = (src: Record<string, unknown>, key: string, at: string): string[] => r.texts(src[key], `${at}.${key}`, true);
  const n = (src: Record<string, unknown>, key: string, at: string): number => optNumber(r, src[key], `${at}.${key}`, 0);
  const sub = (key: string): Record<string, unknown> => (o[key] === undefined ? {} : r.object(o[key], `${where}.${key}`));
  const re = sub("retrieve"); const av = sub("ambiguousVersion"); const sz = sub("sizes"); const un = sub("uncertain");
  const reAt = `${where}.retrieve`; const avAt = `${where}.ambiguousVersion`; const szAt = `${where}.sizes`; const unAt = `${where}.uncertain`;
  return {
    weights: numberMap(r, o["weights"], `${where}.weights`),
    retrieve: { minScore: n(re, "minScore", reAt), band: n(re, "band", reAt), limit: n(re, "limit", reAt) },
    noiseTokens: l(o, "noiseTokens", where),
    genericNameTokens: l(o, "genericNameTokens", where),
    lineGenericTokens: l(o, "lineGenericTokens", where),
    lineNoiseTokens: l(o, "lineNoiseTokens", where),
    skuLikePattern: t(o, "skuLikePattern", where),
    ambiguousVersion: { min: n(av, "min", avAt), max: n(av, "max", avAt) },
    brandLineHints: listMapNoDoc(r, o["brandLineHints"], `${where}.brandLineHints`),
    genderTokens: textMapNoDoc(r, o["genderTokens"], `${where}.genderTokens`),
    types: parseTypeRules(r, o["typeRules"], `${where}.typeRules`),
    sizes: { apparelPrefix: t(sz, "apparelPrefix", szAt), letterSize: t(sz, "letterSize", szAt), tolerance: n(sz, "tolerance", szAt), apparelMin: n(sz, "apparelMin", szAt) },
    uncertain: {
      askProductIntents: l(un, "askProductIntents", unAt), productTalkIntents: l(un, "productTalkIntents", unAt),
      coldHours: n(un, "coldHours", unAt), imageLookbackMinutes: n(un, "imageLookbackMinutes", unAt),
      specificItem: t(un, "specificItem", unAt), specificItemDiacritic: t(un, "specificItemDiacritic", unAt),
      specificItemNoun: t(un, "specificItemNoun", unAt), categoryQuestion: t(un, "categoryQuestion", unAt),
      sizeHint: t(un, "sizeHint", unAt), genericItemTokens: l(un, "genericItemTokens", unAt)
    },
    texts: textMapNoDoc(r, o["texts"], `${where}.texts`)
  };
}

/** Tier 1's matching data; `null`/`undefined` (no file) is empty. Throws naming the field. */
export function parseCommonMatchingConfig(raw: unknown): MatchingConfig {
  if (raw === null || raw === undefined) return emptyMatchingConfig();
  const r = new ShapeReader();
  const config = parseMatchingConfig(r, raw, "loi-chung/cham-diem-chung");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/cham-diem-chung", r.problems);
  return config;
}

/** The industry's matching data on top of tier 1's: lists concatenated, strings / numbers / map keys overridden when set. */
export function mergeMatchingConfig(common: MatchingConfig, industry: MatchingConfig | undefined): MatchingConfig {
  if (industry === undefined) return common;
  const a = common.uncertain; const b = industry.uncertain;
  const s = common.sizes; const u = industry.sizes;
  const listMap = (x: Record<string, string[]>, y: Record<string, string[]>): Record<string, string[]> => {
    const out: Record<string, string[]> = { ...x };
    for (const [key, list] of Object.entries(y)) out[key] = concatLists(out[key] ?? [], list);
    return out;
  };
  return {
    weights: { ...common.weights, ...industry.weights },
    retrieve: {
      minScore: overrideNumber(common.retrieve.minScore, industry.retrieve.minScore),
      band: overrideNumber(common.retrieve.band, industry.retrieve.band),
      limit: overrideNumber(common.retrieve.limit, industry.retrieve.limit)
    },
    noiseTokens: concatLists(common.noiseTokens, industry.noiseTokens),
    genericNameTokens: concatLists(common.genericNameTokens, industry.genericNameTokens),
    lineGenericTokens: concatLists(common.lineGenericTokens, industry.lineGenericTokens),
    lineNoiseTokens: concatLists(common.lineNoiseTokens, industry.lineNoiseTokens),
    skuLikePattern: overrideText(common.skuLikePattern, industry.skuLikePattern),
    ambiguousVersion: industry.ambiguousVersion.max > 0 ? industry.ambiguousVersion : common.ambiguousVersion,
    brandLineHints: listMap(common.brandLineHints, industry.brandLineHints),
    genderTokens: { ...common.genderTokens, ...industry.genderTokens },
    types: {
      rules: [...common.types.rules, ...industry.types.rules],
      aliases: { ...common.types.aliases, ...industry.types.aliases },
      nonPrimaryTypes: concatLists(common.types.nonPrimaryTypes, industry.types.nonPrimaryTypes),
      primaryTypes: concatLists(common.types.primaryTypes, industry.types.primaryTypes),
      labels: { ...common.types.labels, ...industry.types.labels }
    },
    sizes: {
      apparelPrefix: overrideText(s.apparelPrefix, u.apparelPrefix), letterSize: overrideText(s.letterSize, u.letterSize),
      tolerance: overrideNumber(s.tolerance, u.tolerance), apparelMin: overrideNumber(s.apparelMin, u.apparelMin)
    },
    uncertain: {
      askProductIntents: concatLists(a.askProductIntents, b.askProductIntents),
      productTalkIntents: concatLists(a.productTalkIntents, b.productTalkIntents),
      coldHours: overrideNumber(a.coldHours, b.coldHours), imageLookbackMinutes: overrideNumber(a.imageLookbackMinutes, b.imageLookbackMinutes),
      specificItem: overrideText(a.specificItem, b.specificItem), specificItemDiacritic: overrideText(a.specificItemDiacritic, b.specificItemDiacritic),
      specificItemNoun: overrideText(a.specificItemNoun, b.specificItemNoun), categoryQuestion: overrideText(a.categoryQuestion, b.categoryQuestion),
      sizeHint: overrideText(a.sizeHint, b.sizeHint), genericItemTokens: concatLists(a.genericItemTokens, b.genericItemTokens)
    },
    texts: { ...common.texts, ...industry.texts }
  };
}

// ------------------------------------ Stage 6 of tier 1 (25/09/2026): the reply gate after the draft
//
// The gate's config is fifteen flat blocks of strings, lists, numbers and one map. ONE schema names
// the kind of every field, and parse, merge and the validator all walk it: a field added to the
// schema is parsed, merged and checked without another line anywhere. Same rules as stage 3: every
// field optional and empty by default; LISTS ARE CONCATENATED (tier 1 first), STRINGS AND NUMBERS
// ARE OVERRIDDEN when the industry says something, MAP KEYS are merged. `_doc` is skipped.

/**
 * What a field holds: `re` a regex on the accent-stripped reply, `reList` a list of those,
 * `reDiacritic` / `reDiacriticList` regexes on the ORIGINAL reply (flags `giu`), `text` a sentence
 * sent to the customer (checked for a shop's own number), `words` a plain word list, `token` a bare
 * label (a handoff reason), `number`, `map`.
 */
export type ReplyGateFieldKind = "re" | "reList" | "reDiacritic" | "reDiacriticList" | "text" | "words" | "token" | "number" | "map";

export const REPLY_GATE_SCHEMA: { [K in keyof ReplyGateConfig]: Record<keyof ReplyGateConfig[K], ReplyGateFieldKind> } = {
  identity: { falseHuman: "reList", replacement: "text" },
  payment: {
    money: "re", claims: "reList", notClaimWindow: "re", refund: "re", customerReceives: "re", shopPays: "re", customerAsks: "re",
    fillerWords: "words", affirm: "re", notAffirm: "re", orderActions: "re", abbreviations: "map", pendingText: "text", handoffReason: "token"
  },
  contact: { asks: "re", contact: "re", formNote: "text", formNoteMarker: "re", personNote: "text" },
  warranty: { detect: "re", sourceWords: "words", cut: "reDiacriticList", fallback: "text", percentAuthenticity: "re", percentSource: "re" },
  deposit: { context: "re", money: "re", fallback: "text" },
  money: { minAmount: "number", fallback: "text", rangeSame: "reDiacritic" },
  exchange: { promise: "re", policyWords: "re", orderItemNote: "text", noPolicyNote: "text", done: "re", doneNote: "text" },
  photos: { asks: "re", promise: "re", lead: "text", leadMany: "text", noProduct: "text", maxLinks: "number", linkClaim: "re", cardsNote: "text" },
  link: { allowedHosts: "words", carrierHosts: "words", codeInLink: "reDiacritic", productLink: "token" },
  eta: { pattern: "re", fallback: "text" },
  tracking: { asksShipment: "re", trackingWords: "re", aboutOrder: "re", orderNoun: "re", orderVerb: "re", addedText: "text", carrierCode: "reDiacritic", handoffReason: "token" },
  advice: { replacement: "text" },
  evidence: {
    fillerWords: "words", codePattern: "reDiacritic", stockAssert: "re", saysOut: "reList", saysIn: "reList",
    inStockReply: "text", outOfStockReply: "text", outOfStockColorsReply: "text", colorsAsked: "re",
    topicReply: "text", topicColorsReply: "text", discovery: "re", discoveryLinkReply: "text", discoveryAskReply: "text",
    orderClaim: "re", phone: "re", orderCheckReply: "text", orderAskPhoneReply: "text",
    defer: "re", customerAsksDefer: "re", agreesShip: "re", agreesShipUnless: "re", deferReply: "text",
    wantsDifferent: "re", recommendVerbs: "re", brandStop: "words", currentShoeReply: "text",
    alienReply: "text", moneyContext: "re", priceAgree: "re", priceAgreeReply: "text", variantDivergence: "re", variantReply: "text"
  },
  sizeChart: { customerCm: "re", sizeInReply: "re", mentionsSize: "re", hedge: "re", askBack: "text" },
  appendLinks: { lineText: "text", groupText: "text", filterText: "text" }
};

type LooseConfig = Record<string, Record<string, unknown>>;

function emptyReplyGateValue(kind: ReplyGateFieldKind): unknown {
  switch (kind) {
    case "reList": case "reDiacriticList": case "words": return [];
    case "number": return 0;
    case "map": return {};
    default: return "";
  }
}

/** Every field empty: no rule fires. */
export function emptyReplyGateConfig(): ReplyGateConfig {
  const out: LooseConfig = {};
  for (const [section, fields] of Object.entries(REPLY_GATE_SCHEMA)) {
    const block: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(fields)) block[key] = emptyReplyGateValue(kind);
    out[section] = block;
  }
  return out as unknown as ReplyGateConfig;
}

/** Reads one `cong-soat(-chung).json` with every field optional; the message names the field. */
export function parseReplyGateConfig(r: ShapeReader, raw: unknown, where: string): ReplyGateConfig {
  const o = r.object(raw, where);
  const out = emptyReplyGateConfig() as unknown as LooseConfig;
  for (const [section, fields] of Object.entries(REPLY_GATE_SCHEMA)) {
    if (o[section] === undefined) continue;
    const src = r.object(o[section], `${where}.${section}`);
    const block = out[section]!;
    for (const [key, kind] of Object.entries(fields)) {
      const value = src[key];
      if (value === undefined) continue;
      const at = `${where}.${section}.${key}`;
      switch (kind) {
        case "reList": case "reDiacriticList": case "words": block[key] = r.texts(value, at, true); break;
        case "number": block[key] = r.number(value, at); break;
        case "map": block[key] = textMapNoDoc(r, value, at); break;
        default: block[key] = r.text(value, at, true);
      }
    }
  }
  return out as unknown as ReplyGateConfig;
}

/** Tier 1's reply gate; `null`/`undefined` (no file) is empty. Throws naming the field. */
export function parseCommonReplyGateConfig(raw: unknown): ReplyGateConfig {
  if (raw === null || raw === undefined) return emptyReplyGateConfig();
  const r = new ShapeReader();
  const config = parseReplyGateConfig(r, raw, "loi-chung/cong-soat-chung");
  if (r.problems.length > 0) throw new PackShapeError("loi-chung/cong-soat-chung", r.problems);
  return config;
}

/** The industry's reply gate on top of tier 1's: lists concatenated, strings / numbers overridden when set, maps merged. */
export function mergeReplyGateConfig(common: ReplyGateConfig, industry: ReplyGateConfig | undefined): ReplyGateConfig {
  if (industry === undefined) return common;
  const a = common as unknown as LooseConfig;
  const b = industry as unknown as LooseConfig;
  const out: LooseConfig = {};
  for (const [section, fields] of Object.entries(REPLY_GATE_SCHEMA)) {
    const block: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(fields)) {
      const x = a[section]?.[key];
      const y = b[section]?.[key];
      switch (kind) {
        case "reList": case "reDiacriticList": case "words":
          block[key] = concatLists((x as string[] | undefined) ?? [], (y as string[] | undefined) ?? []);
          break;
        case "number": block[key] = overrideNumber((x as number | undefined) ?? 0, (y as number | undefined) ?? 0); break;
        case "map": block[key] = { ...((x as Record<string, string> | undefined) ?? {}), ...((y as Record<string, string> | undefined) ?? {}) }; break;
        default: block[key] = overrideText((x as string | undefined) ?? "", (y as string | undefined) ?? "");
      }
    }
    out[section] = block;
  }
  return out as unknown as ReplyGateConfig;
}
