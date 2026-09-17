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

import { TOOLS, redactPII, type ConversationId, type TenantId, type ToolName } from "@sp/contract";
import { TurnEngine, stripDiacritics, type MemoryPort, type ToolPort } from "@sp/brain";
import type { ChatModelPort } from "../agent/chat-model";
import { SalesAgent, parseAgentJson, type AgentTrace, type HistoryLine } from "../agent/sales-agent";
import { AGENT_TOOLS, COMMENT_CHANNEL, type BrainService, type MerchantBinding } from "../brain/brain-service";
import { InMemoryConversationMemory } from "../gateway/conversation-memory";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { renderKnowledge } from "./knowledge";
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

/** Only tools that READ. A draft or a demo must never leave a trace on the shop's data. */
export function readOnlyTools(inner: ToolPort): ToolPort {
  return {
    available: () => inner.available().filter((t) => TOOLS[t]?.effect === "read"),
    online: () => inner.online(),
    call: async (tool, input, ctx) => {
      if (TOOLS[tool]?.effect !== "read") return { ok: false, tool, error: { code: "tool_unknown", message: `Nháp/hộp cát không được gọi "${tool}" (công cụ có ghi).` } };
      return inner.call(tool, input, ctx);
    }
  };
}

/** A memory that reads the real one and writes nowhere: a draft must not move the conversation's state. */
function readOnlyMemory(inner: MemoryPort): MemoryPort {
  return { load: (tenant, id) => inner.load(tenant, id), save: async () => undefined };
}

function traceSteps(trace: AgentTrace[], from: number): DraftStep[] {
  return trace.map((t, i) => {
    if (t.tool) return { buoc: from + i, loai: "cong-cu" as const, ten: t.tool, chiTiet: `${JSON.stringify(t.args ?? {})}${t.result ? ` → ${t.result.slice(0, 300)}` : ""}` };
    const blocked = String(t.error ?? "").startsWith("chan:");
    return { buoc: from + i, loai: blocked ? "chan" as const : "loi" as const, ten: blocked ? "Câu bị chặn" : "Lỗi", chiTiet: String(t.error ?? "") };
  });
}

export interface AiDeskOptions {
  brain: BrainService;
  /** The (metered) chat model for analysis, proposals and photos. */
  model: ChatModelPort;
  clock: Clock;
  logger: Logger;
}

export class AiDeskService {
  constructor(private readonly options: AiDeskOptions) {}

  private notServed(): DeskResult<never> {
    return { ok: false, status: 403, error: "khong_phuc_vu_shop", message: "Xeon không phục vụ shop này (key khoá / hết hạn / chưa đăng ký)." };
  }

  // ------------------------------------------------------------------ draft

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
    const history: HistoryLine[] = recent.data.tin.map((m) => ({
      who: m.chieu === "den" ? "khach" : m.boi === "bo-nao" ? "bot" : "nguoi", text: m.chu, images: m.chieu === "den" ? m.soAnh : 0
    }));
    let lastCustomer = -1;
    history.forEach((line, i) => { if (line.who === "khach") lastCustomer = i; });
    if (lastCustomer < 0) return { ok: false, status: 409, error: "chua_co_tin_khach", message: "Hội thoại chưa có tin nào của khách để soạn trả lời." };
    // Everything the page said after the customer's last message is already an answer: draft for that message.
    const thread = history.slice(0, lastCustomer + 1);
    const text = thread[lastCustomer]!.text;
    const body: DraftBody = { ...empty, tinKhach: redactPII(text) };
    body.dauVet.push({ buoc: 1, loai: "doc", ten: "Đọc hội thoại", chiTiet: `${history.length} tin gần nhất; tin khách cần trả lời: "${redactPII(text).slice(0, 200)}"${thread[lastCustomer]!.images > 0 ? ` (+${thread[lastCustomer]!.images} ảnh)` : ""}` });

    if (SalesAgent.mustHuman(binding.pack, text)) {
      body.canNguoi = true;
      body.hanhDong = "human_handoff";
      body.lyDo = "Khiếu nại / tiền / đổi trả cụ thể — người thật xử lý (luật của bộ luật ngành).";
      body.dauVet.push({ buoc: 2, loai: "quyet-dinh", ten: "Chuyển người thật", chiTiet: body.lyDo });
      return { ok: true, ...body };
    }

    const context = { shop: input.tenant, agent: "ai_draft" as const, channel: input.kenh, conversationId: input.maHoiThoai };
    const agentResult = await this.runAgent(binding, input.kenh, thread, input.maHoiThoai, text, body, context);
    if (agentResult) return { ok: true, ...body };
    await this.runEngine(binding, input.tenant, input.maHoiThoai, text, thread[lastCustomer]!.images, readOnlyMemory(binding.gateway.memory), body);
    return { ok: true, ...body };
  }

  /** The agent, when configured and the landing opens its tools. Fills `body`; false = the engine must answer. */
  private async runAgent(
    binding: MerchantBinding, channel: string, history: HistoryLine[], conversationId: string, text: string, body: DraftBody,
    context: { shop: string; agent: "ai_draft" | "sandbox"; channel: string; conversationId: string }
  ): Promise<boolean> {
    const agent = this.options.brain.readyAgent();
    const profile = binding.pack.agent;
    const open = binding.gateway.tools.available();
    if (agent === null || profile === undefined || channel === COMMENT_CHANNEL || !AGENT_TOOLS.every((t) => open.includes(t))) {
      body.dauVet.push({ buoc: body.dauVet.length + 1, loai: "quyet-dinh", ten: "Không dùng mô hình", chiTiet: agent === null ? "Xeon chưa cấu hình mô hình cho agent — máy luật soạn." : "Kênh / công cụ chưa hợp với agent — máy luật soạn." });
      return false;
    }
    const knowledge = await this.options.brain.knowledgeFor(binding, conversationId, text);
    if (knowledge) {
      body.dauVet.push({ buoc: body.dauVet.length + 1, loai: "doc", ten: "Kiến thức shop đã duyệt", chiTiet: `${knowledge.hoiDap.length} hỏi đáp, ${knowledge.quyTac.length} quy tắc, ${knowledge.cauMau.length} câu mẫu, ${knowledge.kienThuc.length} ghi chú fit${knowledge.spNgoai ? `, SP ngoài đang chốt ${knowledge.spNgoai.ma}` : ""}` });
    }
    const outcome = await withUsage(context, () => agent.run({
      agent: profile, site: binding.origin, history, neverSay: binding.pack.identity.neverSay,
      extraContext: renderKnowledge(knowledge),
      tools: this.options.brain.agentToolBox(binding, profile.fallbackPolicy, knowledge)
    }));
    body.dauVet.push(...traceSteps(outcome.trace, body.dauVet.length + 1));
    if (!outcome.ok) {
      body.dauVet.push({ buoc: body.dauVet.length + 1, loai: "loi", ten: "Agent không viết được", chiTiet: `${outcome.viSao} — máy luật soạn thay.` });
      return false;
    }
    body.traLoi = outcome.reply;
    body.nguonTraLoi = "agent";
    body.hanhDong = "ai_fallback_draft";
    body.canNguoi = new RegExp(profile.handoffReplyPattern).test(stripDiacritics(outcome.reply).toLowerCase());
    body.lyDo = body.canNguoi ? "Agent gọi người phụ trách vào." : `Agent trả lời sau ${outcome.steps} bước.`;
    body.dauVet.push({ buoc: body.dauVet.length + 1, loai: "quyet-dinh", ten: "Đề xuất phản hồi", chiTiet: body.lyDo });
    return true;
  }

  /** The rule engine on read-only tools. */
  private async runEngine(binding: MerchantBinding, tenant: string, conversationId: string, text: string, images: number, memory: MemoryPort, body: DraftBody): Promise<void> {
    const engine = new TurnEngine(binding.pack, { tools: readOnlyTools(binding.gateway.tools), catalog: binding.gateway.catalog, memory, clock: this.options.clock });
    const result = await engine.handle({ tenant: tenant as TenantId, conversationId: conversationId as ConversationId, text, imageCount: images, at: this.options.clock.now().toISOString() });
    for (const fact of result.facts) body.dauVet.push({ buoc: body.dauVet.length + 1, loai: "cong-cu", ten: fact.source, chiTiet: fact.text.slice(0, 300) });
    body.y = result.intentId ?? "";
    body.duKien = { ...result.slots, ...(result.itemCode ? { ma: result.itemCode } : {}) };
    body.canXacNhan = result.gates.filter((g) => g.action !== "send").map((g) => g.reason);
    body.traLoi = result.action === "handoff" ? "" : result.reply;
    body.nguonTraLoi = result.action === "handoff" ? "" : "may-luat";
    body.hanhDong = result.action === "handoff" ? "human_handoff" : result.action === "ask_back" ? "ask_clarification" : "script_reply";
    body.canNguoi = result.action === "handoff";
    body.lyDo = result.action === "handoff" ? String(result.gates.find((g) => g.action === "handoff" || g.action === "block")?.reason ?? "máy luật không chắc — chuyển người thật") : result.intentId ? `Máy luật nhận ý "${result.intentId}".` : "Máy luật chưa hiểu câu này.";
    body.dauVet.push({ buoc: body.dauVet.length + 1, loai: "quyet-dinh", ten: "Đề xuất phản hồi", chiTiet: body.lyDo });
  }

  // ------------------------------------------------------------------ sandbox

  async sandbox(input: { tenant: string; lichSu: { ai: string; chu: string }[]; chu: string }): Promise<DeskResult<DraftBody>> {
    const binding = await this.options.brain.bindingForTenant(input.tenant);
    if (binding === null) return this.notServed();
    const text = input.chu.trim();
    const history: HistoryLine[] = [
      ...input.lichSu.map((m) => ({ who: m.ai === "khach" ? "khach" as const : "nguoi" as const, text: m.chu, images: 0 })),
      { who: "khach", text, images: 0 }
    ];
    const body: DraftBody = { traLoi: "", nguonTraLoi: "", hanhDong: "", choPhepTuGui: false, canNguoi: false, lyDo: "", y: "", duKien: {}, canXacNhan: [], dauVet: [], tinKhach: redactPII(text) };
    body.dauVet.push({ buoc: 1, loai: "doc", ten: "Hộp cát", chiTiet: `${history.length} tin mô phỏng; bộ nhớ dùng một lần, không gửi, công cụ chỉ đọc.` });
    if (SalesAgent.mustHuman(binding.pack, text)) {
      body.canNguoi = true;
      body.hanhDong = "human_handoff";
      body.lyDo = "Câu này bộ luật ngành giao người thật.";
      return { ok: true, ...body };
    }
    const context = { shop: input.tenant, agent: "sandbox" as const, channel: "demo", conversationId: "" };
    if (await this.runAgent(binding, "demo", history, "", text, body, context)) return { ok: true, ...body };
    // The engine keeps state across turns: replay the made-up customer lines into a throwaway memory.
    const memory = new InMemoryConversationMemory(1);
    const id = `demo:${this.options.clock.now().getTime()}`;
    for (const line of input.lichSu.filter((m) => m.ai === "khach")) {
      const engine = new TurnEngine(binding.pack, { tools: readOnlyTools(binding.gateway.tools), catalog: binding.gateway.catalog, memory, clock: this.options.clock });
      await engine.handle({ tenant: input.tenant as TenantId, conversationId: id as ConversationId, text: line.chu, at: this.options.clock.now().toISOString() });
    }
    await this.runEngine(binding, input.tenant, id, text, 0, memory, body);
    return { ok: true, ...body };
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
