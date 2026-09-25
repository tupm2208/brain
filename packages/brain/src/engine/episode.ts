/**
 * @file The soft shopping episode: ONE main item (focus) plus side items with a ROLE.
 *
 * Copied from Sales Desk `episode_tracker.js` (30/08/2026). Two complaints drove it: the bot
 * "does not tell the main item from a suggested / compared one", and "does not know when an
 * episode starts or ends". Measured over 170k silences in a 60-day archive: 77% under 4h, 5%
 * between 4 and 24h, 18% over 24h — the 4-8h band is the valley, so the boundary is 6h.
 *
 * The boundary is SOFT (Desk v4): a 6-hour silence only makes the episode stale. It is closed
 * when the episode is finished (order placed / customer declined) or when the customer names
 * ANOTHER item; "đôi này còn không" after a night still means yesterday's item — a hard reset
 * lost the thread in 2 of 20 audited conversations.
 *
 * Deterministic: the model may only flip the focus when there is evidence (the item's code or
 * name appears in the CUSTOMER's message). Every regex and label is data (`DialogueConfig.episode`);
 * the brand list comes from the pack's lexicon.
 */

import type { DialogueConfig, EpisodeConfig } from "../pack/types";
import { EPISODE_GAP_HOURS } from "./conversation-state";
import { fillText, hoursBetween, humanGap, packRegex, shortTime } from "./fill-text";
import { escapeRe, normalize } from "./text-analysis";
import type { LedgerProduct, ProductRef } from "./ledger";

export const PAST_EPISODE_LIMIT = 5;
export const OTHER_ITEM_LIMIT = 8;

export type EpisodeRole = "shop_goi_y" | "khach_so_sanh" | "dang_di" | "da_bo" | "phu";
export type EpisodeStage = "tu_van" | "chot" | "sau_dat";
export type EpisodeOutcome = "" | "da_dat" | "bo_do" | "tu_choi";

export interface EpisodeFocus {
  code: string;
  name: string;
  brand: string;
  since: string;
  /** What set the focus: "anh_khach_gui" | "khach_nhac" | "ai" | "page_gui". */
  by: string;
}

export interface EpisodeOther {
  code: string;
  name: string;
  role: EpisodeRole;
  at: string;
}

export interface Episode {
  id: string;
  startedAt: string;
  lastAt: string;
  openedBy: string;
  turns: number;
  focus: EpisodeFocus | null;
  others: EpisodeOther[];
  summary: string;
  stage: EpisodeStage;
  outcome: EpisodeOutcome;
  /** "7 giờ" when the customer came back after a gap and the episode was kept; "" otherwise. */
  staleGap: string;
}

export interface PastEpisode {
  id: string;
  startedAt: string;
  endedAt: string;
  focus: { code: string; name: string } | null;
  outcome: string;
  oneLine: string;
}

/** What the model claims about the focus this turn; honoured only with evidence in the customer's text. */
export interface AiFocusClaim {
  product: string;
  changed: boolean;
  roles?: { product: string; role: string }[] | undefined;
}

/** One customer turn as the tracker sees it. */
export interface EpisodeTurn {
  now: string;
  customerText: string;
  intentId?: string | undefined;
  /** Conversation state id ("cart_created", "done", …), matched against the pack's lists. */
  state?: string | undefined;
  /** The product matched with confidence from what the customer typed. */
  reliableTop?: ProductRef | undefined;
  /** The card the page sent. */
  pageProduct?: ProductRef | undefined;
  /** Products recognised from the customer's images. */
  imageProducts?: ProductRef[] | undefined;
  /** The alternative the system offered. */
  alternative?: ProductRef | undefined;
  /** The shoe the customer is wearing now (a size reference, never the item to buy). */
  currentItemName?: string | undefined;
  aiFocus?: AiFocusClaim | undefined;
  aiSummary?: string | undefined;
  /** A page line in the recent history confirmed an order. */
  pageConfirmedOrder?: boolean | undefined;
  /** Products the AI's free text may refer to (the ledger's, this turn's candidates). */
  pool?: ProductRef[] | undefined;
}

export interface EpisodeUpdate {
  episode: Episode;
  past: PastEpisode[];
  /** "first" / "gap:7 giờ" when a new episode opened this turn; "" otherwise. */
  opened: string;
}

/** The episode at READ time (before the model runs): a stale, finished episode is reported as new. */
export interface EpisodeView {
  current: Episode | null;
  past: PastEpisode[];
  justOpened: string;
  staleFocus: EpisodeFocus | null;
  returningAfter: string;
}

function itemKey(p: { code?: string | undefined; name?: string | undefined } | null | undefined): string {
  return normalize((p?.code ?? "") !== "" ? p?.code : p?.name);
}

function sameItem(a: { code?: string | undefined; name?: string | undefined } | null | undefined, b: { code?: string | undefined; name?: string | undefined } | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && itemKey(a) === itemKey(b);
}

function hasIdentity(p: ProductRef | null | undefined): p is ProductRef {
  return p !== null && p !== undefined && ((p.code ?? "") !== "" || (p.name ?? "") !== "");
}

function joinName(p: { code?: string | undefined; name?: string | undefined }): string {
  return [p.code, p.name].filter((x) => (x ?? "") !== "").join(" ");
}

/** Tracks the episode of one conversation. Stateless: takes the stored episode, returns the next. */
export class EpisodeTracker {
  private readonly cfg: EpisodeConfig;
  private readonly brandRe: RegExp | null;
  private readonly noiseWords: Set<string>;

  /**
   * @param dialogue the merged dialogue config (its `episode` part and `nameNoiseWords` are used)
   * @param brands brand words stripped from a name before matching it against the customer's text
   * @param gapHours the silence that makes an episode stale (6h, measured)
   */
  constructor(dialogue: DialogueConfig, brands: readonly string[] = [], private readonly gapHours: number = EPISODE_GAP_HOURS) {
    this.cfg = dialogue.episode;
    const words = brands.map((b) => normalize(b)).filter((b) => b !== "");
    this.brandRe = words.length > 0 ? new RegExp(`\\b(${words.map(escapeRe).join("|")})\\b`, "g") : null;
    this.noiseWords = new Set(dialogue.nameNoiseWords.map((w) => normalize(w)));
  }

  /** Whether the stored episode has gone cold at `now`. */
  isStale(episode: Episode | null | undefined, now: string): boolean {
    if (!episode || episode.lastAt === "") return false;
    const gap = hoursBetween(episode.lastAt, now);
    return Number.isFinite(gap) && gap >= this.gapHours;
  }

  /** Whether a fresh customer message names `candidate`: code, brand-stripped name, "line + number", a word pair or a long word. */
  customerNamesProduct(candidate: ProductRef | null | undefined, customerText: string, imageCodes: readonly string[] = []): boolean {
    if (!hasIdentity(candidate)) return false;
    const text = normalize(customerText);
    const code = normalize(candidate.code);
    if (code !== "" && (text.includes(code) || imageCodes.includes(code))) return true;
    const name = (this.brandRe ? normalize(candidate.name).replace(this.brandRe, "") : normalize(candidate.name)).trim();
    if (name.length >= 5 && text.includes(name)) return true;
    // Line + version ("boston 13", "pegasus 41").
    const line = name.match(/([a-z]+(?: [a-z]+)?) (\d{1,2})\b/);
    if (line && text.includes(`${line[1]} ${line[2]}`)) return true;
    // Two consecutive words of the name ("evo sl", "gel kayano"), or one distinctive word of 6+ letters.
    const words = name.replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w !== "" && !this.noiseWords.has(w));
    for (let i = 0; i + 1 < words.length; i += 1) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (pair.length >= 5 && text.includes(pair)) return true;
    }
    return words.some((w) => w.length >= 6 && !/^\d+$/.test(w) && new RegExp(`(^|\\s)${escapeRe(w)}(\\s|$)`).test(text));
  }

  /** Folds one customer turn into the episode. */
  update(previous: Episode | null | undefined, previousPast: readonly PastEpisode[] | undefined, turn: EpisodeTurn): EpisodeUpdate {
    const cfg = this.cfg;
    const now = turn.now;
    let episode: Episode | null = previous ? this.copy(previous) : null;
    const past = [...(previousPast ?? [])].slice(-PAST_EPISODE_LIMIT);
    let opened = "";

    const norm = normalize(turn.customerText);
    const dismiss = packRegex(cfg.dismiss);
    const compare = packRegex(cfg.compare);
    const imageProducts = (turn.imageProducts ?? []).filter(hasIdentity);
    const imageCodes = imageProducts.map((p) => normalize(p.code)).filter((c) => c !== "");
    const pool: ProductRef[] = [...(turn.pool ?? []), ...imageProducts, ...(hasIdentity(turn.reliableTop) ? [turn.reliableTop] : []), ...(hasIdentity(turn.pageProduct) ? [turn.pageProduct] : [])];
    const resolve = (text: string): ProductRef | null => {
      const n = normalize(text);
      if (n === "") return null;
      return pool.find((p) => (p.code ?? "") !== "" && n.includes(normalize(p.code)))
        ?? pool.find((p) => (p.name ?? "") !== "" && (n.includes(normalize(p.name)) || normalize(p.name).includes(n)))
        ?? null;
    };

    // 1) Boundary (soft): a gap only makes the episode stale. Close it when finished, when the
    //    customer names another item, or when it never had a focus.
    let staleGap = "";
    if (episode !== null && this.isStale(episode, now)) {
      staleGap = humanGap(hoursBetween(episode.lastAt, now), cfg.texts);
      const focus = episode.focus;
      const namesOther = [...imageProducts, turn.reliableTop].some((p) => hasIdentity(p) && !sameItem(p, focus) && this.customerNamesProduct(p, turn.customerText, imageCodes));
      const finished = episode.stage === "sau_dat" || episode.outcome === "tu_choi"
        || (focus !== null && episode.others.some((o) => sameItem(o, focus) && o.role === "da_bo"));
      if (finished || namesOther || focus === null) {
        past.push(this.close(episode, episode.lastAt));
        episode = this.open(now, `gap:${staleGap}`);
        opened = episode.openedBy;
      } else {
        episode.staleGap = staleGap; // keep the focus; tell the prompt the customer came back
      }
    }
    if (episode === null) { episode = this.open(now, "first"); opened = "first"; }
    if (opened === "" && staleGap === "") episode.staleGap = "";
    const ep: Episode = episode;

    // 2) Focus candidates by trust: customer's image > code/name the customer typed > AI claim with evidence > page card.
    interface Candidate { p: ProductRef; by: string; strong: boolean }
    const candidates: Candidate[] = [];
    for (const p of imageProducts) candidates.push({ p, by: "anh_khach_gui", strong: true });
    if (hasIdentity(turn.reliableTop)) candidates.push({ p: turn.reliableTop, by: "khach_nhac", strong: this.customerNamesProduct(turn.reliableTop, turn.customerText, imageCodes) });
    const aiFocus = turn.aiFocus;
    if (aiFocus !== undefined && aiFocus.product !== "") {
      const hit = resolve(aiFocus.product);
      if (hit !== null) candidates.push({ p: hit, by: "ai", strong: aiFocus.changed && this.customerNamesProduct(hit, turn.customerText, imageCodes) });
    }
    if (hasIdentity(turn.pageProduct)) candidates.push({ p: turn.pageProduct, by: "page_gui", strong: false });

    const addOther = (p: ProductRef, role: EpisodeRole): void => {
      if (!hasIdentity(p) || sameItem(p, ep.focus)) return;
      const existing = ep.others.find((o) => sameItem(o, p));
      if (existing !== undefined) {
        if (role === "dang_di" || role === "da_bo" || existing.role === "phu") existing.role = role;
        existing.at = now;
        return;
      }
      ep.others.push({ code: p.code ?? "", name: p.name ?? "", role, at: now });
      ep.others = ep.others.slice(-OTHER_ITEM_LIMIT);
    };
    const setFocus = (p: ProductRef, by: string): void => {
      if (ep.focus !== null && !sameItem(p, ep.focus)) {
        // The old focus becomes a side item: dropped, or merely compared.
        const role: EpisodeRole = dismiss?.test(norm) ? "da_bo" : "khach_so_sanh";
        ep.others = ep.others.filter((o) => !sameItem(o, p));
        ep.others.push({ code: ep.focus.code, name: ep.focus.name, role, at: now });
        ep.others = ep.others.slice(-OTHER_ITEM_LIMIT);
      }
      ep.others = ep.others.filter((o) => !sameItem(o, p));
      ep.focus = { code: p.code ?? "", name: p.name ?? "", brand: p.brand ?? "", since: now, by };
    };

    // 3) The item the customer is wearing: role "dang_di", never the focus (unless they buy it again).
    const current = turn.currentItemName ?? "";
    if (current !== "") {
      const cur = resolve(current) ?? { code: "", name: current };
      const rebuy = packRegex(cfg.rebuy);
      if (!(ep.focus !== null && sameItem(cur, ep.focus) && !(rebuy?.test(norm) ?? false))) addOther(cur, "dang_di");
    }

    // 4) Pick the focus. A price question about another item is browsing (the operator still
    //    sells the old one); only a size / order / photo about the new item flips the focus.
    const transactional = cfg.transactionalIntents.includes(turn.intentId ?? "");
    const worn = (p: ProductRef): boolean => ep.others.some((o) => sameItem(o, p) && o.role === "dang_di");
    const candidateStrong = candidates.find((c) => c.strong && !worn(c.p));
    const candidateAny = candidates.find((c) => hasIdentity(c.p) && !worn(c.p));
    if (ep.focus === null) {
      if (candidateAny !== undefined) setFocus(candidateAny.p, candidateAny.by);
    } else if (candidateStrong !== undefined && !sameItem(candidateStrong.p, ep.focus)) {
      const aiSaysChange = aiFocus !== undefined && aiFocus.changed && sameItem(resolve(aiFocus.product), candidateStrong.p);
      const comparing = compare?.test(norm) ?? false;
      if ((dismiss?.test(norm) ?? false) || (transactional && !comparing) || aiSaysChange || candidateStrong.by === "anh_khach_gui") {
        setFocus(candidateStrong.p, candidateStrong.by);
      } else {
        addOther(candidateStrong.p, "khach_so_sanh");
      }
    }
    // The remaining candidates become side items with a role.
    for (const c of candidates) {
      if (sameItem(c.p, ep.focus)) continue;
      addOther(c.p, c.by === "page_gui" ? "shop_goi_y" : (compare?.test(norm) ? "khach_so_sanh" : "phu"));
    }
    if (hasIdentity(turn.alternative)) addOther(turn.alternative, "shop_goi_y");
    // Roles the model assigned — only to items already in the episode, never new ones.
    for (const r of aiFocus?.roles ?? []) {
      if (!r || r.product === "" || cfg.roleLabels[r.role] === undefined) continue;
      const hit = resolve(r.product);
      const o = hit !== null ? ep.others.find((x) => sameItem(x, hit)) : undefined;
      if (o !== undefined && o.role === "phu") o.role = r.role as EpisodeRole;
    }
    // The customer drops the focus without naming a replacement: focus emptied, waits for the next.
    // The focus is cleared BEFORE it is filed as "da_bo": Desk filed it first, and `addOther`
    // ignores the current focus, so the dropped item was never recorded and a stale episode could
    // never be seen as finished on that ground.
    const dismissLeading = packRegex(cfg.dismissLeading);
    if (ep.focus !== null && (dismiss?.test(norm) ?? false) && candidateStrong === undefined && (dismissLeading?.test(norm) ?? false)) {
      const dropped = ep.focus;
      ep.focus = null;
      addOther(dropped, "da_bo");
    }

    // 5) Stage and outcome.
    const intent = turn.intentId ?? "";
    const state = turn.state ?? "";
    if (cfg.closingIntents.includes(intent) || cfg.checkoutStates.includes(state)) ep.stage = "chot";
    if (cfg.placedStates.includes(state) || turn.pageConfirmedOrder === true) { ep.stage = "sau_dat"; ep.outcome = "da_dat"; }
    if (cfg.afterOrderIntents.includes(intent) && ep.stage === "chot") ep.stage = "sau_dat";

    // 6) The model's CONSOLIDATED summary (it saw the old one) replaces; none keeps.
    const aiSummary = (turn.aiSummary ?? "").trim();
    if (aiSummary !== "") ep.summary = aiSummary.slice(0, 600);
    ep.lastAt = now;
    ep.turns += 1;
    return { episode: ep, past: past.slice(-PAST_EPISODE_LIMIT), opened };
  }

  /** The episode as the prompt should see it at READ time, before the model runs. */
  view(episode: Episode | null | undefined, past: readonly PastEpisode[] | undefined, now: string): EpisodeView {
    const e = episode ? this.copy(episode) : null;
    const p = [...(past ?? [])].slice(-PAST_EPISODE_LIMIT);
    if (e !== null && this.isStale(e, now)) {
      const gap = humanGap(hoursBetween(e.lastAt, now), this.cfg.texts);
      const finished = e.stage === "sau_dat" || e.outcome === "tu_choi";
      if (finished || e.focus === null) {
        return { current: null, past: [...p, this.close(e, e.lastAt)].slice(-PAST_EPISODE_LIMIT), justOpened: gap, staleFocus: e.focus, returningAfter: gap };
      }
      return { current: { ...e, staleGap: gap }, past: p, justOpened: "", staleFocus: null, returningAfter: gap };
    }
    return { current: e, past: p, justOpened: "", staleFocus: null, returningAfter: "" };
  }

  /** The prompt text of the episode (Desk `episodeToText`), with the ledger's details per item. */
  render(episode: Episode | null | undefined, past: readonly PastEpisode[] | undefined, now: string, ledgerProducts: readonly LedgerProduct[] = []): string {
    const t = this.cfg.texts;
    const view = this.view(episode, past, now);
    const parts: string[] = [];
    const detail = (p: { code: string; name: string }): string => {
      const l = ledgerProducts.find((x) => sameItem(x, p));
      if (l === undefined) return "";
      return [
        l.askedSizes.length > 0 ? fillText(t["detailSizes"] ?? "", { size: l.askedSizes.join(", ") }) : "",
        l.quotedPrice ? fillText(t["detailPrice"] ?? "", { gia: l.quotedPrice }) : "",
        l.stockAnswer ? fillText(t["detailStock"] ?? "", { ton: l.stockAnswer }) : "",
        l.status === "chot" ? (t["detailClosed"] ?? "") : l.status === "da_dat" ? (t["detailPlaced"] ?? "") : ""
      ].filter((x) => x !== "").join(", ");
    };
    if (view.justOpened !== "") {
      parts.push(fillText(t["justOpened"] ?? "", { cach: view.justOpened }));
    } else if (view.current !== null) {
      const e = view.current;
      parts.push(fillText(t["current"] ?? "", {
        tu: shortTime(e.startedAt), luot: e.turns,
        giaiDoan: this.cfg.stageLabels[e.stage] ?? e.stage,
        quayLai: e.staleGap !== "" ? fillText(t["returning"] ?? "", { cach: e.staleGap }) : ""
      }));
      if (e.focus !== null) {
        const d = detail(e.focus);
        parts.push(fillText(t["focus"] ?? "", { mau: joinName(e.focus), chiTiet: d !== "" ? ` — ${d}` : "" }));
      } else {
        parts.push(t["noFocus"] ?? "");
      }
      if (e.others.length > 0) {
        parts.push(fillText(t["others"] ?? "", {
          danhSach: e.others.map((o) => {
            const d = detail(o);
            return `${joinName(o)} — ${this.cfg.roleLabels[o.role] ?? o.role}${d !== "" ? ` (${d})` : ""}`;
          }).join(" | ")
        }));
      }
      if (e.summary !== "") parts.push(fillText(t["summary"] ?? "", { tomTat: e.summary }));
    }
    if (view.past.length > 0) {
      parts.push(fillText(t["past"] ?? "", { danhSach: view.past.slice(-3).map((p) => `[${shortTime(p.startedAt)}] ${p.oneLine}`).join(" || ") }));
    }
    return parts.filter((x) => x !== "").join("\n");
  }

  /** Inserts a "new episode from here" note between two history lines more than the gap apart. */
  annotateHistory<T extends { at: string }>(turns: readonly T[]): (T | { note: string })[] {
    const out: (T | { note: string })[] = [];
    for (let i = 0; i < turns.length; i += 1) {
      const m = turns[i];
      const prev = turns[i - 1];
      if (m === undefined) continue;
      if (prev !== undefined && m.at !== "" && prev.at !== "") {
        const gap = hoursBetween(prev.at, m.at);
        if (Number.isFinite(gap) && gap >= this.gapHours) out.push({ note: fillText(this.cfg.texts["gapNote"] ?? "", { cach: humanGap(gap, this.cfg.texts) }) });
      }
      out.push(m);
    }
    return out;
  }

  private open(now: string, openedBy: string): Episode {
    return { id: "ep_" + now.replace(/[^0-9]/g, "").slice(0, 12), startedAt: now, lastAt: now, openedBy, turns: 0, focus: null, others: [], summary: "", stage: "tu_van", outcome: "", staleGap: "" };
  }

  private close(episode: Episode, endedAt: string): PastEpisode {
    const outcome = episode.outcome !== "" ? episode.outcome : (episode.stage === "sau_dat" ? "da_dat" : "bo_do");
    const focusText = episode.focus !== null ? joinName(episode.focus) : (this.cfg.texts["unknownFocus"] ?? "");
    const outcomeText = this.cfg.outcomeLabels[outcome] ?? outcome;
    return {
      id: episode.id, startedAt: episode.startedAt, endedAt: endedAt !== "" ? endedAt : episode.lastAt,
      focus: episode.focus !== null ? { code: episode.focus.code, name: episode.focus.name } : null,
      outcome,
      oneLine: `${focusText} — ${outcomeText}${episode.summary !== "" ? "; " + episode.summary.slice(0, 120) : ""}`
    };
  }

  private copy(e: Episode): Episode {
    return {
      ...e,
      focus: e.focus !== null ? { ...e.focus } : null,
      others: e.others.filter((o) => o && (o.code !== "" || o.name !== "")).slice(-OTHER_ITEM_LIMIT).map((o) => ({ ...o })),
      summary: e.summary.slice(0, 600)
    };
  }
}
