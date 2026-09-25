/**
 * @file Where the engine gets an industry pack from.
 *
 * Until 21/09/2026 the packs were TypeScript files imported right here, so "adding an industry"
 * meant editing this file, rebuilding and redeploying. Now a pack is JSON on disk and the registry
 * only knows a `PackSource`: something that can list industry ids and hand back their raw JSON.
 *
 * The core must not open files (see DESIGN.md §1), so the source is INSTALLED from outside: the
 * composition root of `@sp/xeon` calls `usePackSource(new DiskPackSource(...))` at start-up, and
 * the tests install a source built from the same folder. This file stays pure: it parses,
 * validates and caches.
 *
 * Caching matters: `loadPack` is called on EVERY inbound message (`bindingFor`), and parsing a
 * 300-line playbook per message would be paid by the customer waiting for an answer.
 *
 * 24/09/2026: tier 1 grew from one file (`agent-chung.json`) to four — the dialogue frame, the
 * ledger wording and the system note wording of Sales Desk's tier 1 came over as data. A source
 * that only knows `common()` still works: the three new files default to empty.
 */

import {
  PackShapeError, mergeDialogueConfig, mergeEntityConfig, mergeIntentRules, mergeMatchingConfig, mergeReplyGateConfig, mergeScriptTexts, mergeSystemNoteTexts, parseCommonAgent,
  parseCommonDialogue, parseCommonEntityConfig, parseCommonIntentRules, parseCommonMatchingConfig, parseCommonReplyGateConfig, parseCommonScriptTexts, parseCommonSystemNote,
  parseLedgerTexts, parsePack
} from "./parse";
import type { CommonAgent, CommonPack, DialogueConfig, EntityConfig, IndustryPack, IntentRules, LedgerTexts, MatchingConfig, ReplyGateConfig, ScriptTexts, SystemNoteTexts } from "./types";
import { assertPackValid, checkBlocksFree, checkDialogueConfig, checkEntityConfig, checkIntentRules, checkMatchingConfig, checkReplyGateConfig, checkScriptTexts } from "./validator";
import type { CascadeLine } from "../engine/stock-facts";
import {
  mergeContextAnalysisText, mergeDraftText, mergeOneShotPromptText, parseContextAnalysisText, parseDraftText, parseHumanExamples, parseOneShotPromptText,
  type ContextAnalysisText, type DraftText, type HumanExamples, type OneShotPromptText
} from "./prompt-text";

/** The raw JSON of one industry: its rules, and the optional agent / frame / note files. */
export interface RawPackFiles {
  rules: unknown;
  agent?: unknown;
  /** `khung-hoi-thoai.json` — the industry's part of the dialogue frame and episode config. */
  dialogue?: unknown;
  /** `ghi-chu-he-thong.json` — the industry's wording of the system note. */
  systemNote?: unknown;
  /** `phan-tich-ngu-canh.json` — the industry's part of the LLM#1 context-analysis prompt. */
  contextAnalysis?: unknown;
  /** `soan-nhap.json` — the industry's rules of the LLM#3 fallback-draft prompt. */
  draft?: unknown;
  /** `vi-du-nguoi-truc.json` — real exchanges of the industry, for the draft's tone. */
  humanExamples?: unknown;
  /** `y-dinh.json` — the industry's intent keywords (stage 2, 24/09/2026). */
  intentRules?: unknown;
  /** `thuc-the.json` — the industry's entity patterns. */
  entities?: unknown;
  /** `bang-size.json` — the industry's tag → size chart. */
  sizeChart?: unknown;
  /** `kich-ban.json` — the industry's scripted replies. */
  scripts?: unknown;
  /** `cham-diem.json` — the industry's catalog-matching data (stage 3, 25/09/2026). */
  matching?: unknown;
  /** `line-dna.json` — the industry's product lines (aliases, equivalents, beginner alternatives) for the stock cascade. */
  lines?: unknown;
  /** `xem-anh.json` — the industry's part of the photo-reading prompt (GĐ5, 25/09/2026). */
  imageRead?: unknown;
  /** `xac-nhan-catalog.json` — the industry's part of the LLM#2 catalog-verification prompt. */
  catalogVerify?: unknown;
  /** `cong-soat.json` — the industry's part of the reply gate (stage 6, 25/09/2026). */
  replyGate?: unknown;
}

/** Tier 1's files beside `agent-chung.json`, by their operator-facing names. */
export type CommonFileName = "khung-hoi-thoai" | "so-hoi-thoai" | "ghi-chu-he-thong" | "phan-tich-ngu-canh" | "soan-nhap"
  | "y-dinh-chung" | "thuc-the-chung" | "kich-ban-chung" | "cham-diem-chung" | "cong-soat-chung" | "xem-anh" | "xac-nhan-catalog";

/** Where raw packs come from. Implemented by the adapter (disk) and by the tests. */
export interface PackSource {
  /** Every industry id this source can serve. */
  ids(): readonly string[];
  /** The raw files of an industry, or `null` when it does not have it. */
  read(id: string): RawPackFiles | null;
  /** Tier 1's instructions (`loi-chung/agent-chung.json`), or `null` when the source has none. */
  common?(): unknown;
  /** Another tier 1 file (`loi-chung/<name>.json`), or `null` when the source has none. */
  commonFile?(name: CommonFileName): unknown;
}

/** Parses, validates and caches the packs of one source. */
export class PackRegistry {
  private readonly cache = new Map<string, IndustryPack>();
  private commonCache: CommonPack | null = null;

  constructor(private readonly source: PackSource) {}

  /** Tier 1's instructions, parsed once. A source without them gives an empty tier 1. */
  common(): CommonAgent {
    return this.commonPack().agent;
  }

  /** Everything tier 1 ships, parsed and checked once. Files the source lacks are empty. */
  commonPack(): CommonPack {
    if (this.commonCache !== null) return this.commonCache;
    const agent = parseCommonAgent(this.source.common ? this.source.common() : null);
    const problems = checkBlocksFree(agent.khoi, "loi-chung.khoi");
    if (problems.length > 0) throw new PackShapeError("loi-chung", problems);
    const file = (name: CommonFileName): unknown => (this.source.commonFile ? this.source.commonFile(name) : null);
    const dialogue = parseCommonDialogue(file("khung-hoi-thoai"));
    const dialogueProblems = checkDialogueConfig(dialogue, "loi-chung/khung-hoi-thoai");
    if (dialogueProblems.length > 0) throw new PackShapeError("loi-chung/khung-hoi-thoai", dialogueProblems);
    const intentRules = parseCommonIntentRules(file("y-dinh-chung"));
    const entities = parseCommonEntityConfig(file("thuc-the-chung"));
    const scripts = parseCommonScriptTexts(file("kich-ban-chung"));
    const matching = parseCommonMatchingConfig(file("cham-diem-chung"));
    const replyGate = parseCommonReplyGateConfig(file("cong-soat-chung"));
    const stage2Problems = [
      ...checkIntentRules(intentRules, "loi-chung/y-dinh-chung"),
      ...checkEntityConfig(entities, "loi-chung/thuc-the-chung"),
      ...checkScriptTexts(scripts, "loi-chung/kich-ban-chung"),
      ...checkMatchingConfig(matching, "loi-chung/cham-diem-chung"),
      ...checkReplyGateConfig(replyGate, "loi-chung/cong-soat-chung")
    ];
    if (stage2Problems.length > 0) throw new PackShapeError("loi-chung", stage2Problems);
    const pack: CommonPack = {
      agent, dialogue,
      ledgerTexts: parseLedgerTexts(file("so-hoi-thoai")),
      noteTexts: parseCommonSystemNote(file("ghi-chu-he-thong")),
      intentRules, entities, scripts, matching, replyGate
    };
    this.commonCache = pack;
    return pack;
  }

  /** The dialogue frame / episode config of an industry: tier 1's with the industry's merged on top. */
  dialogueFor(id: string): DialogueConfig {
    return mergeDialogueConfig(this.commonPack().dialogue, this.load(id).dialogue);
  }

  /** The system note wording of an industry: tier 1's with the industry's blocks on top. */
  noteTextsFor(id: string): SystemNoteTexts {
    return mergeSystemNoteTexts(this.commonPack().noteTexts, this.load(id).systemNote);
  }

  /** The intent rules of an industry: tier 1's keywords with the industry's joined per intent. */
  intentRulesFor(id: string): IntentRules {
    return mergeIntentRules(this.commonPack().intentRules, this.load(id).intentRules);
  }

  /** The entity patterns of an industry (with its tag → size chart) on top of tier 1's. */
  entitiesFor(id: string): EntityConfig {
    return mergeEntityConfig(this.commonPack().entities, this.load(id).entities);
  }

  /** The scripted replies of an industry: tier 1's with the industry's on top, script by script. */
  scriptsFor(id: string): ScriptTexts {
    return mergeScriptTexts(this.commonPack().scripts, this.load(id).scripts);
  }

  /** The catalog-matching data of an industry (stage 3): tier 1's weights with the industry's words on top. */
  matchingFor(id: string): MatchingConfig {
    return mergeMatchingConfig(this.commonPack().matching, this.load(id).matching);
  }

  /** The reply gate of an industry (stage 6): tier 1's rules with the industry's wording on top. */
  replyGateFor(id: string): ReplyGateConfig {
    return mergeReplyGateConfig(this.commonPack().replyGate, this.load(id).replyGate);
  }

  /**
   * The model prompts of an industry (LLM#1 context analysis, LLM#3 fallback draft, the human
   * examples): tier 1's files with the industry's on top, parsed once per industry. They live
   * beside the pack rather than inside `IndustryPack`, so `parsePack` and its callers stay as they
   * are; `clear()` forgets them with the packs.
   */
  private readonly promptCache = new Map<string, { contextAnalysis: ContextAnalysisText; draft: DraftText; humanExamples: HumanExamples; imageRead: OneShotPromptText; catalogVerify: OneShotPromptText }>();

  private promptsFor(id: string): { contextAnalysis: ContextAnalysisText; draft: DraftText; humanExamples: HumanExamples; imageRead: OneShotPromptText; catalogVerify: OneShotPromptText } {
    const cached = this.promptCache.get(id);
    if (cached !== undefined) return cached;
    this.load(id); // an unknown or broken industry fails here, with its own message
    const raw = this.source.read(id);
    const file = (name: CommonFileName): unknown => (this.source.commonFile ? this.source.commonFile(name) : null);
    const common = {
      contextAnalysis: parseContextAnalysisText(file("phan-tich-ngu-canh"), "loi-chung/phan-tich-ngu-canh"),
      draft: parseDraftText(file("soan-nhap"), "loi-chung/soan-nhap"),
      imageRead: parseOneShotPromptText(file("xem-anh"), "loi-chung/xem-anh"),
      catalogVerify: parseOneShotPromptText(file("xac-nhan-catalog"), "loi-chung/xac-nhan-catalog")
    };
    const prompts = {
      contextAnalysis: mergeContextAnalysisText(common.contextAnalysis, raw?.contextAnalysis === undefined ? undefined : parseContextAnalysisText(raw.contextAnalysis, `${id}/phan-tich-ngu-canh`)),
      draft: mergeDraftText(common.draft, raw?.draft === undefined ? undefined : parseDraftText(raw.draft, `${id}/soan-nhap`)),
      humanExamples: parseHumanExamples(raw?.humanExamples, `${id}/vi-du-nguoi-truc`),
      imageRead: mergeOneShotPromptText(common.imageRead, raw?.imageRead === undefined ? undefined : parseOneShotPromptText(raw.imageRead, `${id}/xem-anh`)),
      catalogVerify: mergeOneShotPromptText(common.catalogVerify, raw?.catalogVerify === undefined ? undefined : parseOneShotPromptText(raw.catalogVerify, `${id}/xac-nhan-catalog`))
    };
    this.promptCache.set(id, prompts);
    return prompts;
  }

  /** The LLM#1 context-analysis prompt text of an industry (tier 1 ⊕ industry). */
  contextAnalysisFor(id: string): ContextAnalysisText {
    return this.promptsFor(id).contextAnalysis;
  }

  /** The LLM#3 fallback-draft prompt text of an industry (tier 1 ⊕ industry). */
  draftFor(id: string): DraftText {
    return this.promptsFor(id).draft;
  }

  /** The industry's real exchanges for the draft's tone; empty when the industry has none. */
  humanExamplesFor(id: string): HumanExamples {
    return this.promptsFor(id).humanExamples;
  }

  /** The industry's `line-dna.json` lines as raw objects (pace / distance matrices included), for the line-fit scorer. */
  rawLinesFor(id: string): unknown[] {
    this.load(id);
    const raw = this.source.read(id)?.lines;
    return raw !== null && typeof raw === "object" && Array.isArray((raw as { lines?: unknown }).lines) ? (raw as { lines: unknown[] }).lines : [];
  }

  /** The photo-reading prompt of an industry (tier 1 ⊕ industry). */
  imageReadFor(id: string): OneShotPromptText {
    return this.promptsFor(id).imageRead;
  }

  /** The LLM#2 catalog-verification prompt of an industry (tier 1 ⊕ industry). */
  catalogVerifyFor(id: string): OneShotPromptText {
    return this.promptsFor(id).catalogVerify;
  }

  private readonly linesCache = new Map<string, CascadeLine[]>();

  /**
   * The industry's product lines as the stock cascade and the scorer read them (`line-dna.json`
   * `lines[]`: id, name, aliases, equivalents, beginnerAlternative, purpose, note). Read leniently:
   * the file is the knowledge desk's and carries much more; a line without an id or a name is skipped.
   */
  linesFor(id: string): CascadeLine[] {
    const cached = this.linesCache.get(id);
    if (cached !== undefined) return cached;
    this.load(id);
    const raw = this.source.read(id)?.lines;
    const list = raw !== null && typeof raw === "object" && Array.isArray((raw as { lines?: unknown }).lines) ? (raw as { lines: unknown[] }).lines : [];
    const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter((x) => x !== "") : []);
    const lines: CascadeLine[] = [];
    for (const entry of list) {
      if (entry === null || typeof entry !== "object") continue;
      const o = entry as Record<string, unknown>;
      const lineId = String(o["id"] ?? "").trim();
      const name = String(o["name"] ?? "").trim();
      if (lineId === "" || name === "") continue;
      lines.push({
        id: lineId, name, aliases: texts(o["aliases"]), equivalents: texts(o["equivalents"]), beginnerAlternative: texts(o["beginnerAlternative"]),
        ...(typeof o["purpose"] === "string" ? { purpose: o["purpose"] } : {}), ...(typeof o["note"] === "string" ? { note: o["note"] } : {})
      });
    }
    this.linesCache.set(id, lines);
    return lines;
  }

  /** The industry ids on offer, sorted, for the admin screens and error messages. */
  ids(): string[] {
    return [...this.source.ids()].sort();
  }

  /** A valid pack, or a throw naming what is wrong with it. */
  load(id: string): IndustryPack {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    const raw = this.source.read(id);
    if (raw === null) {
      const known = this.ids();
      throw new Error(`Khong co bo luat nganh "${id}". Cac nganh dang co: ${known.length > 0 ? known.join(", ") : "(chua co nganh nao)"}.`);
    }
    const pack = parsePack(raw.rules, raw.agent, raw.dialogue, raw.systemNote, {
      intentRules: raw.intentRules, entities: raw.entities, sizeChart: raw.sizeChart, scripts: raw.scripts, matching: raw.matching, replyGate: raw.replyGate
    });
    if (pack.id !== id) throw new Error(`Bo luat nganh "${id}" khai id la "${pack.id}" — ten thu muc va \`id\` phai giong nhau.`);
    assertPackValid(pack);
    this.cache.set(id, pack);
    return pack;
  }

  /** Loads every pack and tier 1, so a broken one is found at start-up instead of by a customer. */
  selfCheck(): void {
    this.commonPack();
    for (const id of this.source.ids()) this.load(id);
  }

  /** Forgets the parsed packs, so edited JSON is picked up without a restart. */
  clear(): void {
    this.cache.clear();
    this.promptCache.clear();
    this.linesCache.clear();
    this.commonCache = null;
  }
}

/** A source with nothing in it: what the registry holds until one is installed. */
const NO_SOURCE: PackSource = {
  ids: () => [],
  read: () => null
};

let registry = new PackRegistry(NO_SOURCE);

/**
 * Installs where packs are read from. Called once by the composition root, and by the tests.
 * Replacing the source drops the cache, so a test can swap industries without leaking state.
 */
export function usePackSource(source: PackSource): PackRegistry {
  registry = new PackRegistry(source);
  return registry;
}

/** Returns a validated pack, or throws when the id is unknown or the pack is broken. */
export function loadPack(id: string): IndustryPack {
  return registry.load(id);
}

/** The industry ids currently on offer. */
export function packIds(): string[] {
  return registry.ids();
}

/** Tier 1's instructions from the installed source (empty when it has none). */
export function loadCommonAgent(): CommonAgent {
  return registry.common();
}

/** Everything tier 1 ships from the installed source (missing files are empty). */
export function loadCommonPack(): CommonPack {
  return registry.commonPack();
}

/** The merged dialogue frame / episode config of an industry. */
export function loadDialogueConfig(id: string): DialogueConfig {
  return registry.dialogueFor(id);
}

/** The merged system note wording of an industry. */
export function loadNoteTexts(id: string): SystemNoteTexts {
  return registry.noteTextsFor(id);
}

/** Tier 1's ledger wording. */
export function loadLedgerTexts(): LedgerTexts {
  return registry.commonPack().ledgerTexts;
}

/** The merged LLM#1 context-analysis prompt text of an industry. */
export function loadContextAnalysisText(id: string): ContextAnalysisText {
  return registry.contextAnalysisFor(id);
}

/** The merged LLM#3 fallback-draft prompt text of an industry. */
export function loadDraftText(id: string): DraftText {
  return registry.draftFor(id);
}

/** The industry's real exchanges for the draft's tone. */
export function loadHumanExamples(id: string): HumanExamples {
  return registry.humanExamplesFor(id);
}

/** The merged intent rules of an industry (stage 2, 24/09/2026). */
export function loadIntentRules(id: string): IntentRules {
  return registry.intentRulesFor(id);
}

/** The merged entity patterns of an industry, tag → size chart included. */
export function loadEntityConfig(id: string): EntityConfig {
  return registry.entitiesFor(id);
}

/** The merged scripted replies of an industry. */
export function loadScriptTexts(id: string): ScriptTexts {
  return registry.scriptsFor(id);
}

/** The industry's raw `line-dna.json` lines (the line-fit matrices), for a caller that knows their shape. */
export function loadRawProductLines(id: string): unknown[] {
  return registry.rawLinesFor(id);
}

/** The photo-reading prompt of an industry (GĐ5). */
export function loadImageReadText(id: string): OneShotPromptText {
  return registry.imageReadFor(id);
}

/** The LLM#2 catalog-verification prompt of an industry. */
export function loadCatalogVerifyText(id: string): OneShotPromptText {
  return registry.catalogVerifyFor(id);
}

/** The industry's product lines for the stock cascade (`line-dna.json`); empty when the industry ships none. */
export function loadProductLines(id: string): CascadeLine[] {
  return registry.linesFor(id);
}

/** The merged catalog-matching data of an industry (stage 3, 25/09/2026). */
export function loadMatchingConfig(id: string): MatchingConfig {
  return registry.matchingFor(id);
}

/** The merged reply gate config of an industry (stage 6, 25/09/2026). */
export function loadReplyGateConfig(id: string): ReplyGateConfig {
  return registry.replyGateFor(id);
}

/** Validates every pack on offer. Called at start-up and in the tests. */
export function selfCheckPacks(): void {
  registry.selfCheck();
}
