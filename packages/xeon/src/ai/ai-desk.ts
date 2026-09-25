/**
 * @file THE AI DESK (Đ7) — every AI job a shop's OMI asks for, none of which sends anything.
 *
 * OMI → landing → Xeon. The landing authenticates with its inbox token (the shop is derived from
 * it), reads its own settings to decide the conversation's mode, and asks here. Xeon holds the key
 * and the model; the landing holds every piece of data.
 *
 *   - `draft`     — the reply the bot WOULD give, with the steps it took ("AI nghĩ gì"). Never sent.
 *                   Respects the mode the landing computed: an automatic request for a conversation
 *                   that is `off` is skipped; a person pressing "Soạn bot" always gets a draft.
 *   - `sandbox`   — Demo AI: a made-up conversation with a throwaway memory. Tools that write are
 *                   refused even when the landing opens them (a demo must not look up a real order).
 *   - `analyze`   — a batch of archived conversations the LANDING already stripped of personal data
 *                   (stripped here once more — defence in depth) → rules and Q&A candidates. The
 *                   landing files them into a queue that a person approves; nothing here approves.
 *   - `propose`   — a knowledge-library skeleton from a topic.
 *   - `readImage` — what a photo shows (brand, model, code), plus catalogue candidates.
 *
 * Every model call runs inside `withUsage`, so the token ledger knows shop, agent and conversation.
 */

import { redactPII, type ConversationId, type TenantId, type ToolName } from "@sp/contract";
import { TurnEngine, applyShopProfile, blockFingerprint } from "@sp/brain";
import type { ChatModelPort } from "../agent/chat-model";
import { composeSystemPrompt, parseAgentJson, systemCapabilities, type AgentTurnInput } from "../agent/sales-agent";
import type { BrainService } from "../brain/brain-service";
import { readOnlyTools, type TurnOutcome, type TurnStep } from "../brain/turn-pipeline";
import { InMemoryConversationMemory } from "../gateway/conversation-memory";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { withUsage } from "./usage-context";

/** One step of "AI nghĩ gì", in the order it happened. Field names are wire (the landing stores them, OMI draws them). */
export interface DraftStep {
  buoc: number;
  loai: "doc" | "cong-cu" | "loi" | "chan" | "quyet-dinh";
  ten: string;
  chiTiet: string;
}

export type DeskResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; message: string };

export interface DraftBody {
  traLoi: string;
  /** `agent` (the AI model), `may-luat` (the rule engine), or empty when nothing was written. */
  nguonTraLoi: "agent" | "may-luat" | "";
  hanhDong: string;
  /** Whether the landing may send this without a person (the conversation is `auto`). */
  choPhepTuGui: boolean;
  canNguoi: boolean;
  lyDo: string;
  y: string;
  duKien: Record<string, string>;
  canXacNhan: string[];
  dauVet: DraftStep[];
  tinKhach: string;
  boQua?: string;
}

const HISTORY_LIMIT = 25;
const ANALYZE_CONVERSATIONS_MAX = 40;
const ANALYZE_MESSAGES_MAX = 30;
const MESSAGE_CHARS = 300;

export interface AiDeskOptions {
  brain: BrainService;
  /** The (metered) chat model for analysis, proposals and photos. */
  model: ChatModelPort;
  clock: Clock;
  logger: Logger;
}

/** Desk's own step numbering on top of the pipeline's steps. */
function numbered(steps: readonly TurnStep[], from = 1): DraftStep[] {
  return steps.map((s, i) => ({ buoc: from + i, ...s }));
}

/**
 * The pipeline's outcome in the draft's wire shape. `nguonTraLoi` keeps its three values: a script
 * and the engine are both "may-luat" (rules), the agent and LLM#3 are both "agent" (a model); the
 * steps say which one it was.
 */
function fillBody(body: DraftBody, out: TurnOutcome): DraftBody {
  body.dauVet.push(...numbered(out.steps, body.dauVet.length + 1));
  body.traLoi = out.reply;
  body.nguonTraLoi = out.reply === "" ? "" : out.source === "agent" || out.source === "nhap" ? "agent" : "may-luat";
  body.hanhDong = out.action;
  body.canNguoi = out.needsHuman;
  body.lyDo = out.reason;
  const engine = out.engine;
  if (engine !== null) {
    body.y = engine.intentId ?? "";
    body.duKien = { ...engine.slots, ...(engine.itemCode ? { ma: engine.itemCode } : {}) };
    body.canXacNhan = engine.gates.filter((g) => g.action !== "send").map((g) => g.reason);
  } else if (out.router !== null) {
    body.y = out.router.intent.intent;
    const said = Object.entries(out.router.entities).filter(([, v]) => typeof v === "string" && v !== "");
    body.duKien = Object.fromEntries(said.map(([k, v]) => [k, String(v)]));
  }
  return body;
}

export class AiDeskService {
  constructor(private readonly options: AiDeskOptions) {}

  private notServed(): DeskResult<never> {
    return { ok: false, status: 403, error: "khong_phuc_vu_shop", message: "Xeon không phục vụ shop này (key khoá / hết hạn / chưa đăng ký)." };
  }

  // ------------------------------------------------------------------ draft

  /**
   * The reply the bot WOULD give, with the steps it took: the SAME pipeline as the live door, in
   * "khong-gui" mode — nothing sent, nobody notified, no memory written, tools read-only.
   */
  async draft(input: { tenant: string; maHoiThoai: string; kenh: string; cheDo: string; nguon: string }): Promise<DeskResult<DraftBody>> {
    const binding = await this.options.brain.bindingForTenant(input.tenant);
    if (binding === null) return this.notServed();
    const mode = ["auto", "suggest", "off"].includes(input.cheDo) ? input.cheDo : "auto";
    const empty: DraftBody = { traLoi: "", nguonTraLoi: "", hanhDong: "", choPhepTuGui: mode === "auto", canNguoi: false, lyDo: "", y: "", duKien: {}, canXacNhan: [], dauVet: [], tinKhach: "" };
    if (input.nguon === "tu-dong" && mode === "off") return { ok: true, ...empty, boQua: "bot_tat", lyDo: "Bot đang tắt cho hội thoại / trang này." };

    const tools = binding.gateway.tools;
    if (!tools.available().includes("conversation.recent")) {
      return { ok: false, status: 409, error: "landing_chua_mo_hoi_thoai", message: "Landing chưa mở công cụ đọc hội thoại cho bộ não." };
    }
    const recent = await tools.call("conversation.recent", { conversationId: input.maHoiThoai as ConversationId, limit: HISTORY_LIMIT });
    if (!recent.ok) return { ok: false, status: 502, error: "khong_doc_duoc_hoi_thoai", message: recent.error.message };
    let lastCustomer = -1;
    recent.data.tin.forEach((line, i) => { if (line.chieu === "den") lastCustomer = i; });
    if (lastCustomer < 0) return { ok: false, status: 409, error: "chua_co_tin_khach", message: "Hội thoại chưa có tin nào của khách để soạn trả lời." };
    // Everything the page said after the customer's last message is already an answer: draft for that message.
    const thread = recent.data.tin.slice(0, lastCustomer + 1);
    const last = thread[lastCustomer]!;
    const body: DraftBody = { ...empty, tinKhach: redactPII(last.chu) };

    const out = await this.options.brain.turnPipeline().run({
      tenant: input.tenant, binding, conversationId: input.maHoiThoai, mode: "khong-gui", usageAgent: "ai_draft",
      message: { kenh: input.kenh, nguoi: "", chu: last.chu, maTin: last.maTin, luc: last.luc, soAnh: last.soAnh, anh: last.anh, traLoiTin: last.traLoiTin },
      recent: { tin: thread, ...(recent.data.hoiThoai ? { hoiThoai: recent.data.hoiThoai } : {}) }
    });
    return { ok: true, ...fillBody(body, out) };
  }

  // ------------------------------------------------------------------ sandbox

  /**
   * `mucDich: "web"` (21/09/2026) is the same machinery serving a VISITOR on the shop's website —
   * the "AI tư vấn" box of the storefront, ported from the running site where it was a bare GPT
   * call with the shop's own key. Here it is the shop's own brain: read-only tools, a memory
   * thrown away after the answer, nothing sent anywhere, and its own row in the token ledger.
   */
  async sandbox(input: { tenant: string; lichSu: { ai: string; chu: string }[]; chu: string; mucDich?: "demo" | "web"; anh?: string[] | undefined }): Promise<DeskResult<DraftBody>> {
    const binding = await this.options.brain.bindingForTenant(input.tenant);
    if (binding === null) return this.notServed();
    const forWeb = input.mucDich === "web";
    const text = input.chu.trim();
    const anh = (input.anh ?? []).filter((u) => /^https:\/\//i.test(u)).slice(0, 4);
    const channel = forWeb ? "web" : "demo";
    const nowIso = this.options.clock.now().toISOString();
    // The made-up thread in the landing's wire shape, a person on duty standing in for the page.
    const thread = [
      ...input.lichSu.map((m) => ({ maTin: "", chieu: m.ai === "khach" ? "den" as const : "di" as const, boi: m.ai === "khach" ? "khach" : "nguoi-truc", chu: m.chu, soAnh: 0, luc: nowIso })),
      { maTin: "", chieu: "den" as const, boi: "khach", chu: text, soAnh: anh.length, luc: nowIso, ...(anh.length > 0 ? { anh } : {}) }
    ];
    const body: DraftBody = { traLoi: "", nguonTraLoi: "", hanhDong: "", choPhepTuGui: false, canNguoi: false, lyDo: "", y: "", duKien: {}, canXacNhan: [], dauVet: [], tinKhach: redactPII(text) };
    body.dauVet.push(forWeb
      ? { buoc: 1, loai: "doc", ten: "Khách trên web", chiTiet: `${thread.length} tin của khách trên web; bộ nhớ dùng một lần, không gửi, công cụ chỉ đọc.` }
      : { buoc: 1, loai: "doc", ten: "Hộp cát", chiTiet: `${thread.length} tin mô phỏng; bộ nhớ dùng một lần, không gửi, công cụ chỉ đọc.` });
    // A throwaway memory. When no agent can answer, the engine will: replay the made-up customer
    // lines into it first, so a follow-up ("size 42") still knows the item — as before the pipeline.
    const memory = new InMemoryConversationMemory(1);
    const id = `${channel}:${this.options.clock.now().getTime()}`;
    if (this.options.brain.readyAgent() === null) {
      const shop = await this.options.brain.shopProfileFor(binding);
      for (const line of input.lichSu.filter((m) => m.ai === "khach")) {
        const engine = new TurnEngine(applyShopProfile(binding.pack, shop?.hoSo ?? null, binding.chung.cauCam), { tools: readOnlyTools(binding.gateway.tools), catalog: binding.gateway.catalog, memory, clock: this.options.clock });
        await engine.handle({ tenant: input.tenant as TenantId, conversationId: id as ConversationId, text: line.chu, at: nowIso });
      }
    }
    const out = await this.options.brain.turnPipeline().run({
      tenant: input.tenant, binding, conversationId: id, mode: "khong-gui", usageAgent: forWeb ? "web_advisor" : "sandbox",
      message: { kenh: channel, nguoi: "", chu: text, soAnh: anh.length, ...(anh.length > 0 ? { anh } : {}), luc: nowIso },
      recent: { tin: thread }, memory
    });
    return { ok: true, ...fillBody(body, out) };
  }

  // ------------------------------------------------------------------ the Chatbot tab (tier 3 screen)

  /**
   * What OMI's Chatbot tab needs from the industry (tier 2) and the platform (tier 1): the
   * suggested profile values, the policy text suggestions, and every block with its fingerprint so
   * the screen can say which block the shop may rewrite and whether the industry's text moved.
   */
  async profileTemplate(input: { tenant: string }): Promise<DeskResult<{ nganh: string; mauHoSo: Record<string, unknown>; khoi: Record<string, unknown>[]; khoiChung: Record<string, unknown>[] }>> {
    const binding = await this.options.brain.bindingForTenant(input.tenant);
    if (binding === null) return this.notServed();
    const agent = binding.pack.agent;
    const block = (b: { id: string; tieuDe: string; shopSua: boolean; loiDan: string }) => ({ id: b.id, tieuDe: b.tieuDe, shopSua: b.shopSua, loiDan: b.loiDan, phienBan: blockFingerprint(b.loiDan) });
    return {
      ok: true,
      nganh: binding.packId,
      mauHoSo: agent ? { goiY: agent.mauHoSo.goiY, chinhSach: agent.mauHoSo.chinhSach } : { goiY: {}, chinhSach: { doiTra: "", ship: "", baoHanh: "" } },
      khoi: (agent?.khoi ?? []).map(block),
      khoiChung: binding.chung.khoi.map((b) => ({ ...block(b), shopSua: false }))
    };
  }

  /**
   * The system message the agent would be given RIGHT NOW for this shop, with the profile the
   * landing holds — so a person filling the Chatbot tab can read what the bot will be told.
   */
  async promptPreview(input: { tenant: string }): Promise<DeskResult<{ loiDan: string; nangLuc: string[]; hoSoPhienBan: number }>> {
    const binding = await this.options.brain.bindingForTenant(input.tenant);
    if (binding === null) return this.notServed();
    const profile = binding.pack.agent;
    if (profile === undefined) return { ok: false, status: 409, error: "nganh_khong_co_agent", message: "Ngành này chưa có sổ tay agent; bot chỉ trả lời bằng máy luật." };
    const shop = await this.options.brain.shopProfileFor(binding);
    const hoSo = shop?.hoSo ?? null;
    const open = binding.gateway.tools.available();
    const nangLuc = systemCapabilities({ open, visionReady: this.options.brain.visionReady(), hoSo });
    const turn: AgentTurnInput = {
      agent: profile, chung: binding.chung, hoSo, chinhSach: shop?.chinhSach, nangLuc,
      site: binding.origin, shopName: binding.shopName, history: [],
      neverSay: applyShopProfile(binding.pack, hoSo, binding.chung.cauCam).identity.neverSay,
      extraContext: ""
    };
    return { ok: true, loiDan: composeSystemPrompt(turn), nangLuc, hoSoPhienBan: hoSo?.phienBan ?? 0 };
  }

  // ------------------------------------------------------------------ analysis, proposals, photos

  private modelMissing(): DeskResult<never> {
    return { ok: false, status: 503, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình AI (XEON_AI_CHAT_URL / XEON_AI_CHAT_KEY)." };
  }

  private async askJson(context: Parameters<typeof withUsage>[0], system: string, user: string, images: string[] = []): Promise<Record<string, unknown> | string> {
    const outcome = await withUsage(context, () => this.options.model.complete([
      { role: "system", content: system },
      { role: "user", content: user, ...(images.length > 0 ? { images } : {}) }
    ], { timeoutMs: 60_000 }));
    if (!outcome.ok) return outcome.viSao;
    return parseAgentJson(outcome.text) ?? "Mô hình không trả JSON đọc được.";
  }

  async analyze(input: { tenant: string; hoiThoai: { ma: string; tin: { chieu: string; chu: string }[] }[] }): Promise<DeskResult<{ ketQua: Record<string, unknown> }>> {
    if ((await this.options.brain.bindingForTenant(input.tenant)) === null) return this.notServed();
    if (!this.options.model.ready()) return this.modelMissing();
    const conversations = input.hoiThoai.slice(0, ANALYZE_CONVERSATIONS_MAX).map((c, i) =>
      `### Hoi thoai ${i + 1}\n${c.tin.slice(-ANALYZE_MESSAGES_MAX).map((m) => `${m.chieu === "den" ? "KHACH" : "SHOP"}: ${redactPII(String(m.chu ?? "")).replace(/\s+/g, " ").slice(0, MESSAGE_CHARS)}`).join("\n")}`);
    const system = [
      "Ban doc lich su chat that cua mot shop ban hang tren Facebook de rut kinh nghiem huan luyen chatbot.",
      "Thong tin ca nhan da duoc che bang [da an]. KHONG doan lai, KHONG dua ten/so dien thoai vao ket qua.",
      "Tra DUY NHAT mot JSON: {\"tomTat\":\"...\",\"nguyenTac\":[{\"tieuDe\":\"...\",\"chiTiet\":\"...\",\"loai\":\"tu_van|hoi_lai|chuyen_nguoi|chinh_sach\"}],\"cauHoi\":[{\"intent\":\"ask_size|ask_price|product_advice|shipping|return_exchange|place_order|khac\",\"cauHoi\":\"cau khach hay hoi\",\"traLoi\":\"cach shop tra loi tot nhat, dung bien {product} {size} {price} thay cho so cu the\",\"loai\":\"static_qa|dynamic_rule|clarification_rule|handoff_rule|knowledge_rule\",\"lyDo\":\"vi sao\"}]}.",
      "Toi da 8 nguyen tac va 15 cau hoi. Gia, ton kho, size luon phai tra du lieu hien tai — dung loai dynamic_rule cho nhung cau do."
    ].join("\n");
    const answer = await this.askJson({ shop: input.tenant, agent: "training", channel: "", conversationId: "" }, system, conversations.join("\n\n"));
    if (typeof answer === "string") return { ok: false, status: 502, error: "mo_hinh_loi", message: answer };
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === "object") as Record<string, unknown>[] : []);
    const clean = (v: unknown, n: number) => redactPII(String(v ?? "")).trim().slice(0, n);
    return {
      ok: true,
      ketQua: {
        tomTat: clean(answer["tomTat"], 1000),
        nguyenTac: list(answer["nguyenTac"]).slice(0, 8).map((x) => ({ tieuDe: clean(x["tieuDe"], 160), chiTiet: clean(x["chiTiet"], 800), loai: clean(x["loai"], 40) })).filter((x) => x.tieuDe),
        cauHoi: list(answer["cauHoi"]).slice(0, 15).map((x) => ({ intent: clean(x["intent"], 60), cauHoi: clean(x["cauHoi"], 500), traLoi: clean(x["traLoi"], 1500), loai: clean(x["loai"], 40), lyDo: clean(x["lyDo"], 300) })).filter((x) => x.cauHoi && x.traLoi),
        soHoiThoai: conversations.length
      }
    };
  }

  async propose(input: { tenant: string; chuDe: string }): Promise<DeskResult<{ deXuat: Record<string, unknown> }>> {
    if ((await this.options.brain.bindingForTenant(input.tenant)) === null) return this.notServed();
    if (!this.options.model.ready()) return this.modelMissing();
    const system = [
      "Ban thiet ke mot kho kien thuc nho cho chatbot ban hang doc khi tu van.",
      "Tra DUY NHAT JSON: {\"id\":\"snake_case\",\"name\":\"ten hien thi\",\"path\":\"knowledge/<nhom>/<ten>.md\",\"priority\":1-100,\"useWhen\":[\"tu khoa/tinh huong\"],\"description\":\"mo ta de he thong hieu\",\"content\":\"noi dung markdown: muc tieu, quy tac, cau hoi can hoi lai, dieu KHONG lam\"}.",
      "Khong bia gia, ton kho, chinh sach cu the cua shop."
    ].join("\n");
    const answer = await this.askJson({ shop: input.tenant, agent: "knowledge" }, system, `Chu de: ${input.chuDe.slice(0, 1000)}`);
    if (typeof answer === "string") return { ok: false, status: 502, error: "mo_hinh_loi", message: answer };
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const id = s(answer["id"], 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "kien_thuc_moi";
    return {
      ok: true,
      deXuat: {
        id, name: s(answer["name"], 160), path: s(answer["path"], 200) || `knowledge/${id}.md`,
        priority: Math.min(100, Math.max(1, Math.round(Number(answer["priority"]) || 80))),
        useWhen: (Array.isArray(answer["useWhen"]) ? answer["useWhen"] : []).map((w) => s(w, 80)).filter(Boolean).slice(0, 12),
        description: s(answer["description"], 1000), content: s(answer["content"], 20000), source: "ai_model"
      }
    };
  }

  async readImage(input: { tenant: string; anh: string[]; goiY: string; maHoiThoai: string; kenh: string; mucDich: string }): Promise<DeskResult<{ doc: Record<string, unknown>; ungVien: Record<string, unknown>[] }>> {
    const binding = await this.options.brain.bindingForTenant(input.tenant);
    if (binding === null) return this.notServed();
    if (!this.options.model.ready()) return this.modelMissing();
    // Đ10: two more purposes — a box TAG being scanned into stock ("tem") and a partner's STOCK PHOTO
    // (sizes still available, maybe a price: "ton-anh"). Same door, same model, their own prompt and ledger row.
    const tag = input.mucDich === "tem";
    const stockPhoto = input.mucDich === "ton-anh";
    const system = tag ? [
      "Anh la tro ly doc TEM/NHAN san pham the thao (tem hop giay, tag treo, tem quan ao).",
      "Tra JSON DUY NHAT: {\"brand\":\"\",\"model\":\"\",\"code\":\"ma article tren tem\",\"sizes\":[\"moi he size nhin thay\"],\"primarySize\":\"size EU/FR (36-50) hoac chu S/M/L\",\"text\":\"chu doc duoc\",\"confidence\":0-1}.",
      "Ma thuong dang 2 CHU IN HOA + 4 SO (IT2132) hoac JI8190-100. Chi ghi thong tin NHIN THAY. Khong doan."
    ] : stockPhoto ? [
      "Anh chup ton kho doi tac gui (anh giay kem size con, co the kem gia).",
      "Tra JSON DUY NHAT: {\"brand\":\"\",\"model\":\"ten dong\",\"code\":\"ma neu doc duoc\",\"sizes\":[\"cac size CON HANG, vd 42 42.5\"],\"price\":0,\"text\":\"chu doc duoc tren anh\",\"confidence\":0-1}.",
      "Gia la so dong (1tr490 = 1490000, 850k = 850000). Khong bia size, khong bia gia."
    ] : [
      "Anh chup giay / do the thao ma khach gui hoac shop sap ban. Nhan dien de tra catalog.",
      "Tra JSON DUY NHAT: {\"brand\":\"adidas|nike|asics|...\",\"model\":\"ten dong + phien ban\",\"color\":\"mau chu dao tieng Viet\",\"code\":\"ma tren tem/hop neu doc duoc, khong thi rong\",\"confidence\":0-1}.",
      "Khong doan ma neu khong thay tem. Khong bia gia."
    ];
    const agent = input.mucDich === "sp-ngoai" ? "external_product_vision" as const : tag ? "tag_scan" as const : stockPhoto ? "stock_image" as const : "image_match" as const;
    const answer = await this.askJson({ shop: input.tenant, agent, channel: input.kenh, conversationId: input.maHoiThoai }, system.join("\n"),
      input.goiY ? `Chu go kem anh: ${JSON.stringify(input.goiY.slice(0, 300))}` : "Nhan dien anh nay.", input.anh.slice(0, 4));
    if (typeof answer === "string") return { ok: false, status: 502, error: "mo_hinh_loi", message: answer };
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const doc: Record<string, unknown> = {
      brand: s(answer["brand"], 40), model: s(answer["model"], 120), color: s(answer["color"], 60),
      code: s(answer["code"], 24).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16),
      confidence: Math.min(1, Math.max(0, Number(answer["confidence"]) || 0))
    };
    if (tag || stockPhoto) {
      doc["sizes"] = (Array.isArray(answer["sizes"]) ? answer["sizes"] : []).map((x) => s(x, 16)).filter(Boolean).slice(0, 40);
      doc["text"] = s(answer["text"], 2000);
      if (tag) doc["primarySize"] = s(answer["primarySize"], 16);
      if (stockPhoto) doc["price"] = Math.max(0, Math.round(Number(answer["price"]) || 0));
    }
    const ungVien: Record<string, unknown>[] = [];
    const tools = binding.gateway.tools;
    const code = String(doc["code"]), modelName = String(doc["model"]);
    if (tools.available().includes("catalog.find" as ToolName) && (code || modelName)) {
      const found = await tools.call("catalog.find", { ...(code ? { ma: code } : {}), ...(modelName ? { ten: `${String(doc["brand"])} ${modelName}`.trim() } : {}) });
      if (found.ok && Array.isArray(found.data.ketQua)) {
        for (const item of found.data.ketQua.slice(0, 5)) {
          ungVien.push({ ma: item.ma, ten: item.ten, anh: item.anh, link: item.link, gia: item.cac_size[0]?.gia ?? 0, sizes: item.cac_size.map((c) => c.size) });
        }
      }
    }
    return { ok: true, doc, ungVien };
  }
}
