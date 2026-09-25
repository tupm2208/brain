/**
 * @file The prompts of Sales Desk's tier-1 model calls, as DATA (24/09/2026).
 *
 * Sales Desk hard-coded two prompts in `ai_fallback.js`: LLM#1 "phân tích ngữ cảnh"
 * (`buildContextAnalysisPrompt`) and LLM#3 "soạn nháp dự phòng" (`buildFallbackPrompt`, 63 rules,
 * `LEAN_CORE`, `leanRuleSet`, `humanExamplesText`, `leanGuardrails`). Here they are three JSON files
 * per tier, read by the adapter and parsed by this file:
 *
 *   loi-chung/phan-tich-ngu-canh.json   nganh/<id>/phan-tich-ngu-canh.json   → `ContextAnalysisText`
 *   loi-chung/soan-nhap.json            nganh/<id>/soan-nhap.json            → `DraftText`
 *                                       nganh/<id>/vi-du-nguoi-truc.json     → `HumanExamples`
 *
 * Tier 1 and tier 2 share a shape and are MERGED (blocks and rules concatenated, tier 1 first;
 * schema keys and section labels added, the industry's winning per key). Blocks and rules go
 * through the same "no shop number" check as the agent's blocks: a deposit percentage or a
 * delivery range belongs to the shop profile, and reaches the prompt through `{banHang.…}`.
 */

import { PackShapeError, ShapeReader } from "./parse";
import type { AgentBlock } from "./types";
import { checkBlocksFree } from "./validator";

// ----------------------------------------------------------------- LLM#1: context analysis

/** `phan-tich-ngu-canh.json` of one tier. */
export interface ContextAnalysisText {
  /** The system message; tier 1's unless the industry sets one. */
  heThong: string;
  /** Intents the model may choose from (tier 1's, an industry may add). */
  yDinh: string[];
  /** Instruction blocks, prompt order. */
  khoi: AgentBlock[];
  /** Lookup commands the model may ask for: name → how it is described. */
  lenhTraCuu: Record<string, string>;
  /** Output keys with their example value; tier 1's base plus the industry's additions. */
  schema: { entities: Record<string, unknown>; needBrief: Record<string, unknown> };
  /** Section labels of the turn data ("Tin moi:", "KHUNG HOI THOAI (...)"); the industry may override a key. */
  nhan: Record<string, string>;
}

export function emptyContextAnalysisText(): ContextAnalysisText {
  return { heThong: "", yDinh: [], khoi: [], lenhTraCuu: {}, schema: { entities: {}, needBrief: {} }, nhan: {} };
}

/** One `phan-tich-ngu-canh.json`; problems name the field. `null`/`undefined` (no file) is empty. */
export function parseContextAnalysisText(raw: unknown, where: string): ContextAnalysisText {
  if (raw === null || raw === undefined) return emptyContextAnalysisText();
  const r = new ShapeReader();
  const o = r.object(raw, where);
  const schema = o["schema"] === undefined ? {} : r.object(o["schema"], `${where}.schema`);
  const text: ContextAnalysisText = {
    heThong: r.longText(o["heThong"], `${where}.heThong`, true),
    yDinh: r.texts(o["yDinh"], `${where}.yDinh`, true),
    khoi: o["khoi"] === undefined ? [] : parseBlockList(r, o["khoi"], `${where}.khoi`),
    lenhTraCuu: r.textMap(o["lenhTraCuu"], `${where}.lenhTraCuu`, true),
    schema: {
      entities: schema["entities"] === undefined ? {} : { ...r.object(schema["entities"], `${where}.schema.entities`) },
      needBrief: schema["needBrief"] === undefined ? {} : { ...r.object(schema["needBrief"], `${where}.schema.needBrief`) }
    },
    nhan: r.textMap(o["nhan"], `${where}.nhan`, true)
  };
  r.problems.push(...checkBlocksFree(text.khoi, `${where}.khoi`));
  if (r.problems.length > 0) throw new PackShapeError(where, r.problems);
  return text;
}

/** The industry's text on top of tier 1's. */
export function mergeContextAnalysisText(common: ContextAnalysisText, industry: ContextAnalysisText | undefined): ContextAnalysisText {
  if (industry === undefined) return common;
  return {
    heThong: industry.heThong !== "" ? industry.heThong : common.heThong,
    yDinh: [...new Set([...common.yDinh, ...industry.yDinh])],
    khoi: [...common.khoi, ...industry.khoi],
    lenhTraCuu: { ...common.lenhTraCuu, ...industry.lenhTraCuu },
    schema: {
      entities: { ...common.schema.entities, ...industry.schema.entities },
      needBrief: { ...common.schema.needBrief, ...industry.schema.needBrief }
    },
    nhan: { ...common.nhan, ...industry.nhan }
  };
}

// ----------------------------------------------------------------- one-shot prompts: image reading (GĐ5), catalog verification (LLM#2)

/**
 * `xem-anh.json` / `xac-nhan-catalog.json` of one tier: a system line, instruction lines (tier 1's
 * first, the industry's after) and labels for the turn data. The schema of the answer is fixed in
 * code; the industry only adds what to look for.
 */
export interface OneShotPromptText {
  heThong: string;
  huongDan: string[];
  nhan: Record<string, string>;
}

export function emptyOneShotPromptText(): OneShotPromptText {
  return { heThong: "", huongDan: [], nhan: {} };
}

export function parseOneShotPromptText(raw: unknown, where: string): OneShotPromptText {
  if (raw === null || raw === undefined) return emptyOneShotPromptText();
  const r = new ShapeReader();
  const o = r.object(raw, where);
  const text: OneShotPromptText = {
    heThong: r.longText(o["heThong"], `${where}.heThong`, true),
    huongDan: r.texts(o["huongDan"], `${where}.huongDan`, true),
    nhan: r.textMap(o["nhan"], `${where}.nhan`, true)
  };
  if (r.problems.length > 0) throw new PackShapeError(where, r.problems);
  return text;
}

export function mergeOneShotPromptText(common: OneShotPromptText, industry: OneShotPromptText | undefined): OneShotPromptText {
  if (industry === undefined) return common;
  return { heThong: industry.heThong !== "" ? industry.heThong : common.heThong, huongDan: [...common.huongDan, ...industry.huongDan], nhan: { ...common.nhan, ...industry.nhan } };
}

// ----------------------------------------------------------------- LLM#3: fallback draft

/**
 * One rule of the draft prompt. `khi` names the SITUATIONS the rule is loaded for (`luon` = every
 * turn, Desk's `LEAN_CORE`); the writer computes the turn's situations and keeps the rules that
 * name one of them (Desk's `leanRuleSet`).
 */
export interface DraftRule {
  id: string;
  khi: string[];
  loiDan: string;
}

/** One section of the operator guardrails, kept under its title, loaded by situation (Desk's `leanGuardrails`). */
export interface DraftGuard {
  tieuDe: string;
  khi: string[];
  loiDan: string;
}

/** `soan-nhap.json` of one tier. */
export interface DraftText {
  heThong: string;
  /** The sentence the caller sends when the draft fails and a person must take over. */
  cauChuyenNguoi: string;
  /** Intent → example group in `vi-du-nguoi-truc.json`; `_hetHang` and `_macDinh` are the extra groups. */
  nhomViDu: Record<string, string>;
  /** Section labels and fixed lines of the prompt; a label may be a list of lines. */
  nhan: Record<string, string>;
  luat: DraftRule[];
  guardrails: DraftGuard[];
}

export function emptyDraftText(): DraftText {
  return { heThong: "", cauChuyenNguoi: "", nhomViDu: {}, nhan: {}, luat: [], guardrails: [] };
}

const RULE_ID = /^[a-z0-9-]+$/i;

/** One `soan-nhap.json`; problems name the field. `null`/`undefined` (no file) is empty. */
export function parseDraftText(raw: unknown, where: string): DraftText {
  if (raw === null || raw === undefined) return emptyDraftText();
  const r = new ShapeReader();
  const o = r.object(raw, where);
  const nhan: Record<string, string> = {};
  const nhanRaw = o["nhan"] === undefined ? {} : r.object(o["nhan"], `${where}.nhan`);
  for (const [key, value] of Object.entries(nhanRaw)) nhan[key] = r.longText(value, `${where}.nhan.${key}`, true);
  const luat = r.list(o["luat"], `${where}.luat`, (item, at) => {
    const id = r.text(item["id"], `${at}.id`);
    if (id !== "" && !RULE_ID.test(id)) r.fail(`${at}.id`, "chi gom chu, so, gach ngang");
    return { id, khi: r.texts(item["khi"], `${at}.khi`, true), loiDan: r.longText(item["loiDan"], `${at}.loiDan`) };
  }, true);
  const guardrails = r.list(o["guardrails"], `${where}.guardrails`, (item, at) => ({
    tieuDe: r.text(item["tieuDe"], `${at}.tieuDe`),
    khi: r.texts(item["khi"], `${at}.khi`, true),
    loiDan: r.longText(item["loiDan"], `${at}.loiDan`)
  }), true);
  const seen = new Set<string>();
  for (const rule of luat) {
    if (seen.has(rule.id)) r.fail(`${where}.luat`, `id "${rule.id}" bi trung`);
    seen.add(rule.id);
  }
  const text: DraftText = {
    heThong: r.longText(o["heThong"], `${where}.heThong`, true),
    cauChuyenNguoi: r.longText(o["cauChuyenNguoi"], `${where}.cauChuyenNguoi`, true),
    nhomViDu: r.textMap(o["nhomViDu"], `${where}.nhomViDu`, true),
    nhan, luat, guardrails
  };
  r.problems.push(...checkBlocksFree(luat, `${where}.luat`));
  r.problems.push(...checkBlocksFree(guardrails.map((g) => ({ id: g.tieuDe, loiDan: g.loiDan })), `${where}.guardrails`));
  if (r.problems.length > 0) throw new PackShapeError(where, r.problems);
  return text;
}

/** The industry's rules and guardrails after tier 1's; an industry rule with the same id REPLACES tier 1's. */
export function mergeDraftText(common: DraftText, industry: DraftText | undefined): DraftText {
  if (industry === undefined) return common;
  const replaced = new Set(industry.luat.map((rule) => rule.id));
  return {
    heThong: industry.heThong !== "" ? industry.heThong : common.heThong,
    cauChuyenNguoi: industry.cauChuyenNguoi !== "" ? industry.cauChuyenNguoi : common.cauChuyenNguoi,
    nhomViDu: { ...common.nhomViDu, ...industry.nhomViDu },
    nhan: { ...common.nhan, ...industry.nhan },
    luat: [...common.luat.filter((rule) => !replaced.has(rule.id)), ...industry.luat],
    guardrails: [...common.guardrails, ...industry.guardrails]
  };
}

// ----------------------------------------------------------------- human examples

/** One real exchange: what the customer wrote (`k`) and what the person on duty answered (`n`). */
export interface HumanExample {
  k: string;
  n: string;
}

/** `vi-du-nguoi-truc.json`: examples by situation group. */
export type HumanExamples = Record<string, HumanExample[]>;

/** Reads the example file; keys starting with `_` are documentation. `null`/`undefined` is empty. */
export function parseHumanExamples(raw: unknown, where: string): HumanExamples {
  if (raw === null || raw === undefined) return {};
  const r = new ShapeReader();
  const o = r.object(raw, where);
  const out: HumanExamples = {};
  for (const [group, list] of Object.entries(o)) {
    if (group.startsWith("_")) continue;
    out[group] = r.list(list, `${where}.${group}`, (item, at) => ({ k: r.text(item["k"], `${at}.k`), n: r.text(item["n"], `${at}.n`) }));
  }
  if (r.problems.length > 0) throw new PackShapeError(where, r.problems);
  return out;
}

// ----------------------------------------------------------------- shared

/** Blocks written as `[{id, tieuDe, shopSua?, loiDan}]`; same shape as the agent's, ids unique. */
function parseBlockList(r: ShapeReader, raw: unknown, where: string): AgentBlock[] {
  const blocks = r.list(raw, where, (b, at) => ({
    id: r.text(b["id"], `${at}.id`),
    tieuDe: r.text(b["tieuDe"], `${at}.tieuDe`),
    shopSua: r.boolean(b["shopSua"], `${at}.shopSua`, false),
    loiDan: r.longText(b["loiDan"], `${at}.loiDan`)
  }));
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) r.fail(where, `id "${b.id}" bi trung`);
    seen.add(b.id);
  }
  return blocks;
}
