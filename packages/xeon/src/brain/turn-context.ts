/**
 * TURN CONTEXT — tier 1 of Sales Desk, step 1 (24/09/2026).
 *
 * Before any model is asked anything, Desk built the ground the answer stands on
 * (`server.js` runAIRouterForBodyInner, P1c / P1d, v99):
 *   - the transcript with THREE page labels: the bot's own sentences, a person's, and "unknown";
 *   - the note "KHÁCH ĐANG TRẢ LỜI VÀO TIN …" when the customer replied to one message;
 *   - the product a PERSON on the page sent in the last 30 minutes, which beats whatever the bot
 *     was holding on to;
 *   - the conversation ledger and the soft shopping episode kept between turns;
 *   - the dialogue frame: what the page just asked, so "42" or "ok" reads as the answer to it.
 *
 * This class only ARRANGES what the landing and the memory already hold. It calls no model.
 */
import type { ConversationId, TenantId, ToolOutput } from "@sp/contract";
import {
  ConversationLedger, DialogueFrameBuilder, EpisodeTracker, emptyState,
  type ConversationState, type DialogueConfig, type DialogueFrame, type FrameLexicon, type LedgerTexts,
  type ProductRef, type Turn
} from "@sp/brain";
import type { HistoryLine } from "../agent/sales-agent";

type RecentOutput = ToolOutput<"conversation.recent">;
type RecentLine = RecentOutput["tin"][number];

/** Authors the landing writes for the bot's own sentences. */
export const BOT_AUTHORS: ReadonlySet<string> = new Set(["bo-nao"]);
/** A product a PERSON on the page sent within this window is the product in focus (Desk P1d). */
export const HUMAN_PRODUCT_WINDOW_MS = 30 * 60 * 1000;
/** Placeholder the transcript shows for a customer photo the bot has not recognised. */
const IMAGE_PLACEHOLDER = "[khách gửi ảnh]";

export interface FocusedProduct extends ProductRef {
  by: "reply_to" | "human_page";
}

export interface TurnPhoto {
  url: string;
  maTin: string;
  at: string;
}

export interface TurnContext {
  /** The transcript for the agent, labelled; the last line is the message to answer. */
  history: HistoryLine[];
  /** The same history as brain turns (frame, episode). */
  turns: Turn[];
  /** Customer messages of the burst joined with " | " (Desk `collectBurstText`), the current one last. */
  burstText: string;
  replyNote: string;
  focusedProduct: FocusedProduct | null;
  frame: DialogueFrame | null;
  /** Memory as loaded, or fresh; the turn adds to it and saves it. */
  state: ConversationState;
  /** Photos of THIS turn: the message's own, or the ones of the message it replies to. */
  photos: TurnPhoto[];
  daChaoAi: boolean;
  dienThoaiDaCho: boolean;
  /** Codes whose product card the landing sent within six hours (Giai đoạn 7). */
  theDaGui: string[];
}

export interface TurnContextInput {
  tenant: string;
  conversationId: string;
  /** The message being answered. */
  message: { maTin?: string | undefined; chu?: string | undefined; soAnh?: number | undefined; anh?: string[] | undefined; luc?: string | undefined; traLoiTin?: string | undefined };
  recent: RecentOutput;
  state: ConversationState | null;
  now: Date;
  /** Names for the codes the frame / ledger know, so a focused product can be shown by name. */
  lexicon?: FrameLexicon | undefined;
}

export interface TurnContextDeps {
  dialogue: DialogueConfig;
  ledgerTexts: LedgerTexts;
  brands?: readonly string[] | undefined;
}

export class TurnContextBuilder {
  private readonly frames: DialogueFrameBuilder;
  private readonly ledger: ConversationLedger;
  private readonly episodes: EpisodeTracker;

  constructor(deps: TurnContextDeps) {
    this.frames = new DialogueFrameBuilder(deps.dialogue);
    this.ledger = new ConversationLedger(deps.ledgerTexts);
    this.episodes = new EpisodeTracker(deps.dialogue, deps.brands ?? []);
  }

  ledgerOf(): ConversationLedger { return this.ledger; }
  episodesOf(): EpisodeTracker { return this.episodes; }

  build(input: TurnContextInput): TurnContext {
    const state = input.state ?? emptyState(input.tenant as TenantId, input.conversationId as ConversationId);
    const labels = state.imageLabels ?? {};
    const nowMs = input.now.getTime();
    const message = input.message;
    const text = String(message.chu ?? "");
    const at = String(message.luc || input.now.toISOString());
    const lines = [...input.recent.tin];
    // The message being answered is usually already the last line of the thread; make sure it is
    // there exactly once, so the transcript ends with the customer's words.
    const last = lines.at(-1);
    const present = last !== undefined && last.chieu === "den" && (
      (message.maTin && last.maTin === message.maTin) || last.chu === text
    );
    if (!present) {
      lines.push({ maTin: String(message.maTin ?? ""), chieu: "den", boi: "khach", chu: text, soAnh: Number(message.soAnh ?? 0), luc: at, ...(message.anh?.length ? { anh: message.anh } : {}), ...(message.traLoiTin ? { traLoiTin: message.traLoiTin } : {}) });
    }

    const who = (m: RecentLine): HistoryLine["who"] => m.chieu === "den" ? "khach" : BOT_AUTHORS.has(m.boi) ? "bot" : m.boi === "" ? "khong_ro" : "nguoi";
    const history: HistoryLine[] = lines.map((m) => {
      const label = m.maTin ? labels[m.maTin] : undefined;
      const shown = m.chu.trim() !== "" ? m.chu : label ?? (m.chieu === "den" && m.soAnh > 0 ? IMAGE_PLACEHOLDER : m.chu);
      return { who: who(m), text: shown, images: m.chieu === "den" ? m.soAnh : 0, at: m.luc };
    });
    const turns: Turn[] = lines.map((m) => ({ role: m.chieu === "den" ? "customer" : "shop", text: m.chu, at: m.luc, imageCount: m.chieu === "den" ? m.soAnh : 0 }));

    // Burst: customer messages after the page's last REAL sentence, joined (Desk `collectBurstText`).
    const burst: string[] = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const m = lines[i]!;
      if (m.chieu === "di") break;
      if (m.chu.trim() !== "") burst.unshift(m.chu.trim());
    }
    const burstText = burst.join(" | ") || text;

    // Photos of this turn: the message's own; a reply to a photo message borrows that photo (P1c).
    const own = (m: RecentLine): TurnPhoto[] => (m.anh ?? []).filter((u) => /^https:\/\//i.test(u)).map((url) => ({ url, maTin: m.maTin ?? "", at: m.luc }));
    let photos = own(lines.at(-1)!);
    if (photos.length === 0 && (message.anh ?? []).length > 0) photos = (message.anh ?? []).map((url) => ({ url, maTin: String(message.maTin ?? ""), at }));

    // P1c: the customer replied to one message. That message's product (or photo) is what this turn is about.
    let replyNote = "";
    let focusedProduct: FocusedProduct | null = null;
    const lexicon: FrameLexicon = input.lexicon ?? { products: (state.ledger?.products ?? []).map((p) => ({ code: p.code, name: p.name, brand: p.brand })) };
    const replyTo = String(message.traLoiTin ?? lines.at(-1)?.traLoiTin ?? "");
    if (replyTo !== "") {
      const orig = lines.find((m) => m.maTin === replyTo);
      if (orig !== undefined) {
        const origPhotos = own(orig);
        const label = orig.maTin ? labels[orig.maTin] ?? "" : "";
        let product: ProductRef | null = orig.chieu === "di" ? this.frames.productFromPageTurn(orig.chu, lexicon) : null;
        if (product === null && label !== "") {
          // "[ảnh: JP9252 Adizero Boston 13]" — the label the ledger wrote when the photo was recognised.
          const m = /\[ảnh:\s*([A-Za-z0-9-]{4,20})\s*([^\]]*)\]/.exec(label);
          const code = m?.[1] ?? "";
          const hit = lexicon.products.find((p) => String(p.code ?? "").toLowerCase() === code.toLowerCase());
          if (hit !== undefined) product = hit;
          else if (code !== "") product = { code, name: (m?.[2] ?? "").trim() };
        }
        if (product !== null && (product.code ?? "") !== "") focusedProduct = { ...product, by: "reply_to" };
        if (origPhotos.length > 0 && photos.length === 0 && focusedProduct === null) photos = origPhotos.slice(0, 3);
        const origIsPageText = orig.chieu === "di" && origPhotos.length === 0 && focusedProduct === null;
        const quoted = label || orig.chu.slice(0, 400) || (origPhotos.length > 0 ? "[ảnh]" : "");
        replyNote = `KHÁCH ĐANG TRẢ LỜI (reply) VÀO TIN ${orig.chieu === "di" ? "CỦA PAGE" : "CỦA CHÍNH KHÁCH"}: "${quoted}"`
          + (focusedProduct ? ` → mẫu ${focusedProduct.name ?? ""} (${focusedProduct.code})` : "")
          + ". Câu hiện tại nói về TIN ĐÓ, không phải mẫu khác trong sổ."
          + (origIsPageText ? " Khách hỏi \"là sao/nghĩa là gì/sao vậy\" → GIẢI THÍCH LẠI đúng nội dung tin đó bằng lời dễ hiểu hơn (giá/chính sách/size trong tin), KHÔNG hỏi size hay chuyển đề tài." : "");
      }
    }
    // P1d: a PERSON on the page sent a product in the last 30 minutes — that beats the bot's focus.
    if (focusedProduct === null) {
      const latestCustomerAt = Date.parse(lines.at(-1)?.luc ?? "") || nowMs;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const m = lines[i]!;
        if (m.chieu !== "di") continue;
        const sentAt = Date.parse(m.luc) || 0;
        if (sentAt > latestCustomerAt) continue;
        if (latestCustomerAt - sentAt > HUMAN_PRODUCT_WINDOW_MS) break;
        if (who(m) !== "nguoi") continue;
        const hit = this.frames.productFromPageTurn(m.chu, lexicon);
        if (hit !== null && (hit.code ?? "") !== "") { focusedProduct = { ...hit, by: "human_page" }; break; }
      }
    }

    const lastLine = history.at(-1);
    if (lastLine !== undefined) {
      if (replyNote !== "") lastLine.note = replyNote;
      if (photos.length > 0) lastLine.imageUrls = photos.slice(0, 3).map((p) => p.url);
    }

    const focusFromState: ProductRef | null = state.episode?.focus ? { code: state.episode.focus.code, name: state.episode.focus.name } : state.focusItemCode ? { code: state.focusItemCode } : null;
    const frame = this.frames.build({ message: text, turns: turns.slice(0, -1), lexicon, focusedProduct: focusedProduct ?? focusFromState });

    return {
      history, turns, burstText, replyNote, focusedProduct, frame, state, photos,
      daChaoAi: input.recent.hoiThoai?.daChaoAi === true,
      dienThoaiDaCho: input.recent.hoiThoai?.dienThoaiDaCho === true,
      theDaGui: [...(input.recent.hoiThoai?.theDaGui ?? [])]
    };
  }

  /** The frame in words for the agent's note ("Page vừa hỏi size; khách trả lời '42'"). */
  describeFrame(frame: DialogueFrame): string {
    return this.frames.describe(frame);
  }

  /** The SO_HOI_THOAI text: ledger + episode, as Desk's `summaryText` for the level-2 note. */
  renderMemory(state: ConversationState, nowIso: string): string {
    const parts = [
      this.ledger.render(state.ledger),
      this.episodes.render(state.episode, state.episodesPast, nowIso, state.ledger?.products ?? [])
    ].filter((p) => p.trim() !== "");
    return parts.join("\n");
  }
}
