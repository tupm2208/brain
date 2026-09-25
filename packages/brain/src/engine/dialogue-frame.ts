/**
 * @file The dialogue frame: a terse customer message read as the ANSWER to what the page just said.
 *
 * Copied from Sales Desk `dialogue_frame.js` (28/08/2026). "42", "ok", "mau nay", "5.45" mean
 * nothing on their own; after "bác đi size bao nhiêu ạ?" the first one is a size and after a bank
 * account number "ok" is an agreement. A 60-day scan found 2,405 such page → short-answer pairs.
 * Pure: no model, no clock. From the page's last cluster of messages it derives the frame that
 * both the router and the prompt read.
 *
 * Every pattern and sentence is data: tier 1 owns the generic ones (agree / decline / asked to
 * confirm / gave bank account), the industry owns how the page asks for its variant and what a
 * bare variant answer looks like (`sizeOnly`), plus the shape of its product codes.
 */

import type { DialogueConfig } from "../pack/types";
import type { Turn } from "../ports/index";
import { anyMatch, fillText, packRegex } from "./fill-text";
import type { ProductRef } from "./ledger";
import { escapeRe, normalize } from "./text-analysis";

/** A product line of the industry ("Adizero Boston" with its aliases), for pages that name a line without a code. */
export interface ProductLine {
  id: string;
  name: string;
  aliases?: string[] | undefined;
}

/** What `productFromPageTurn` may look codes and names up in. */
export interface FrameLexicon {
  /** Catalog items (codes and names) the page may have referred to. */
  products: readonly ProductRef[];
  lines?: readonly ProductLine[] | undefined;
  /** The shop's own hosts ("toprun.site"): a page message with such a link is "sent_link". */
  siteHosts?: readonly string[] | undefined;
}

/** A product the page referred to; `lineOnly` when only the line was named (no catalog code). */
export interface PageProduct extends ProductRef {
  lineId?: string | undefined;
  lineOnly?: boolean | undefined;
}

/** The page's last cluster of messages (consecutive shop turns), with its texts and image count. */
export interface PageTurn {
  texts: string[];
  text: string;
  imageCount: number;
  at: string;
  /** Customer turns that followed it (the message being handled may already be among them). */
  customerAfter: Turn[];
}

export type FrameAnswer = "size" | "agree" | "decline" | "refers_to_page_item" | "short" | "other";

export interface DialogueFrame {
  /** "asked_size", "asked_confirm", "gave_bank", "sent_link", "statement", … (the pack's kinds plus the built-in ones). */
  kind: string;
  answer: FrameAnswer;
  productCode: string;
  productName: string;
  /** The variant value when `answer` is "size": "42", "44 2/3", "41 1/3", "42.5". */
  size: string;
  pageText: string;
  pageImages: number;
  short: boolean;
  /** One sentence for the prompt: `page vừa HỎI SIZE (về mẫu …): "…" → khách ĐANG TRẢ LỜI SIZE.` */
  text: string;
}

export interface FrameInput {
  message: string;
  /** The recent history, oldest first. Shop turns are "the page". */
  turns: readonly Turn[];
  lexicon: FrameLexicon;
  /** The product in focus when the page's message names none. */
  focusedProduct?: ProductRef | null | undefined;
}

/** Builds dialogue frames for one industry (its merged `DialogueConfig`). */
export class DialogueFrameBuilder {
  private readonly placeholderRes: RegExp[];

  constructor(private readonly cfg: DialogueConfig) {
    this.placeholderRes = cfg.imagePlaceholders.filter((p) => p !== "").map((p) => new RegExp(p, "i"));
  }

  private isPlaceholder(text: string): boolean {
    return this.placeholderRes.some((re) => re.test(text.trim()));
  }

  /** The page's last cluster (even one that is only images), or `null` when the page never spoke. */
  lastPageTurn(turns: readonly Turn[]): PageTurn | null {
    let end = turns.length - 1;
    // Skip customer turns at the end: the message being handled may already be in the list.
    while (end >= 0 && turns[end]?.role !== "shop") end -= 1;
    if (end < 0) return null;
    let start = end;
    while (start - 1 >= 0 && turns[start - 1]?.role === "shop") start -= 1;
    const cluster = turns.slice(start, end + 1);
    const texts = cluster.map((t) => t.text.trim()).filter((t) => t !== "" && !this.isPlaceholder(t));
    const imageCount = cluster.reduce((sum, t) => sum + ((t.imageCount ?? 0) || (this.isPlaceholder(t.text) ? 1 : 0)), 0);
    return { texts, text: texts.join(" ⏎ "), imageCount, at: turns[end]?.at ?? "", customerAfter: turns.slice(end + 1).filter((t) => t.role !== "shop") };
  }

  /** What the page's last cluster did: asked size / purpose / confirmation, gave a bank account, said out of stock, … */
  classifyPageTurn(turn: PageTurn | null, lexicon?: FrameLexicon): string {
    if (turn === null) return "none";
    const n = normalize(turn.text);
    if (n === "" && turn.imageCount > 0) return "sent_images";
    for (const kind of this.cfg.pageTurnOrder) {
      if (anyMatch(this.cfg.pageTurn[kind] ?? [], n)) return kind;
    }
    if (this.hasProductLink(turn.text, lexicon)) return "sent_link";
    if (turn.imageCount > 0) return "sent_images_with_text";
    if (anyMatch(this.cfg.askedOther, n) || /\?\s*$/.test(turn.text.trim())) return "asked_other";
    return "statement";
  }

  private hasProductLink(text: string, lexicon?: FrameLexicon): boolean {
    for (const host of lexicon?.siteHosts ?? []) {
      if (host !== "" && new RegExp(escapeRe(host), "i").test(text)) return true;
    }
    return anyMatch(this.cfg.productLinkPatterns, text);
  }

  /** The product the page's text refers to: a `?p=` / `/product/` link, a product code, or a named line. */
  productFromPageTurn(text: string, lexicon: FrameLexicon): PageProduct | null {
    return productFromPageTurn(text, lexicon, this.cfg.productLinkPatterns, this.cfg.productCodePatterns);
  }

  /** The frame of the message being handled, or `null` when the page never spoke. */
  build(input: FrameInput): DialogueFrame | null {
    const turn = this.lastPageTurn(input.turns);
    if (turn === null) return null;
    const kind = this.classifyPageTurn(turn, input.lexicon);
    const text = input.message.trim();
    const norm = normalize(text);
    const words = norm === "" ? 0 : norm.split(" ").length;
    const short = words <= this.cfg.shortAnswer.maxWords && text.length <= this.cfg.shortAnswer.maxChars;
    const fromPage = this.productFromPageTurn(turn.text, input.lexicon);
    const focused = input.focusedProduct ?? null;
    const product: ProductRef | null = fromPage !== null && (fromPage.code ?? "") !== ""
      ? fromPage
      : focused !== null && (focused.code ?? "") !== "" ? focused : fromPage;
    const sizeOnly = anyMatch(this.cfg.sizeOnly, norm.replace(/\s+/g, " "));
    const ack = packRegex(this.cfg.ack, "i")?.test(text) ?? false;
    const deny = packRegex(this.cfg.deny, "i")?.test(text) ?? false;
    const refers = packRegex(this.cfg.refer)?.test(norm) ?? false;
    let answer: FrameAnswer = "other";
    if (sizeOnly) answer = "size";
    else if (ack) answer = "agree";
    else if (deny) answer = "decline";
    else if (refers) answer = "refers_to_page_item";
    else if (short) answer = "short";
    const frame: DialogueFrame = {
      kind, pageText: turn.text.slice(0, 220), pageImages: turn.imageCount,
      productCode: product?.code ?? "", productName: product?.name ?? "",
      answer, short,
      // "44 2/3", "41-1/3", "42 ruoi" → "44 2/3", "41 1/3", "42.5": one spelling for the stock lookup.
      size: sizeOnly ? norm.replace(/\s*\/\s*/g, "/").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").replace(/\s*\bruoi\b/g, ".5").trim() : "",
      text: ""
    };
    frame.text = this.describe(frame);
    return frame;
  }

  /** The one-sentence frame for the prompt, from the pack's `kindTexts` / `answerTexts` / `aboutTexts`. */
  describe(frame: DialogueFrame): string {
    const about = this.cfg.aboutTexts;
    const ve = frame.productCode !== ""
      ? fillText(about["product"] ?? "", { ten: frame.productName, ma: frame.productCode })
      : frame.productName !== ""
        ? fillText(about["line"] ?? "", { ten: frame.productName })
        : frame.pageImages > 0
          ? fillText(about["images"] ?? "", { so: frame.pageImages })
          : frame.kind === "sent_link" ? (about["link"] ?? "") : "";
    const loai = this.cfg.kindTexts[frame.kind] ?? this.cfg.kindTexts["statement"] ?? "";
    const dap = this.cfg.answerTexts[frame.answer] ?? "";
    return fillText(this.cfg.frameFormat, { loai, ve, chuPage: frame.pageText, dap });
  }
}

/**
 * The product a page message refers to: first a link (`?p=CODE`, `/product/CODE`), then a product
 * code by the industry's patterns, each checked against the catalog; failing that, a named LINE
 * ("boston13", "duramo SL2 size 40") keeping the version the page wrote so the lookup hits the
 * right generation.
 *
 * @param linkPatterns regexes whose group 1 is the code in a link (tier 1's)
 * @param codePatterns regexes whose group 1 is a bare product code (the industry's)
 */
export function productFromPageTurn(text: string, lexicon: FrameLexicon, linkPatterns: readonly string[], codePatterns: readonly string[]): PageProduct | null {
  const candidates: string[] = [];
  for (const p of linkPatterns) {
    if (p === "") continue;
    const m = text.match(new RegExp(p));
    if (m?.[1]) candidates.push(m[1]);
  }
  for (const p of codePatterns) {
    if (p === "") continue;
    for (const m of text.matchAll(new RegExp(p, "g"))) if (m[1]) candidates.push(m[1]);
  }
  for (const code of candidates) {
    const wanted = normalize(code);
    const hit = lexicon.products.find((item) => normalize(item.code) === wanted);
    if (hit !== undefined) return { ...hit };
  }
  const lineHit = findLine(text, lexicon.lines ?? []);
  if (lineHit === null) return null;
  // Keep the version the page wrote ("boston13" → "Adizero Boston 13").
  const spaced = normalize(text.replace(/([A-Za-z])(\d)/g, "$1 $2"));
  const aliases = [lineHit.name, ...(lineHit.aliases ?? [])].map(normalize).filter((a) => a !== "").sort((a, b) => b.length - a.length);
  let version = "";
  for (const alias of aliases) {
    const m = spaced.match(new RegExp(`(^|\\s)${escapeRe(alias)}\\s*(\\d{1,2})(?![\\d.,/])`));
    if (m?.[2] && !/\d/.test(alias)) { version = m[2]; break; }
    if (m && /\d/.test(alias)) break;
  }
  const versionInAlias = (aliases.find((alias) => /\d/.test(alias) && spaced.includes(alias)) ?? "").match(/\d{1,2}/);
  const ver = version !== "" ? version : (versionInAlias?.[0] ?? "");
  return { code: "", name: ver !== "" && !/\d/.test(lineHit.name) ? `${lineHit.name} ${ver}` : lineHit.name, lineId: lineHit.id, lineOnly: true };
}

/** The line whose longest alias appears as whole words in the text (Desk `findLineByText`). Shared with the catalog scorer and the stock facts. */
export function findLine(text: string, lines: readonly ProductLine[]): ProductLine | null {
  const spaced = ` ${normalize(text.replace(/([A-Za-z])(\d)/g, "$1 $2"))} `;
  if (spaced.trim() === "") return null;
  let best: { line: ProductLine; length: number } | null = null;
  for (const line of lines) {
    for (const alias of [line.name, ...(line.aliases ?? [])]) {
      const a = normalize(alias);
      if (a.length < 3 || !spaced.includes(` ${a} `)) continue;
      if (best === null || a.length > best.length) best = { line, length: a.length };
    }
  }
  return best?.line ?? null;
}
