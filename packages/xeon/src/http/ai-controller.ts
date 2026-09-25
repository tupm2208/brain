/**
 * @file `/ai/*` — the AI desk and the token ledger, for a merchant's landing (Đ7).
 *
 * AUTHENTICATION IS THE SAME AS `/tin-den` and `/viet-bai`: the landing carries its PRIVATE INBOX
 * TOKEN and the shop is derived from the token, never read from the body — otherwise shop A could
 * read shop B's token ledger or spend B's model budget.
 *
 * The price table is read by every shop but WRITTEN only by the shops named in
 * `XEON_SHOP_SUA_BANG_GIA` (the operator's own): one table serves every merchant, so a merchant
 * editing it would change everybody's numbers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AiDeskService, DeskResult } from "../ai/ai-desk";
import { cleanPricing, type PriceTable } from "../ai/price-table";
import { readOpenAiUsage } from "../agent/chat-model";
import type { UsageLedger } from "../ai/usage-ledger";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import type { AgentId } from "../ai/usage-context";
import { PATHS } from "../protocol";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface AiControllerOptions {
  desk: AiDeskService;
  ledger: UsageLedger;
  prices: PriceTable;
  license: LicenseService | null;
  sharedToken?: string | undefined;
  /** Shops allowed to change the price table. */
  priceEditors: readonly string[];
  clock: Clock;
  logger: Logger;
}

const AI_PATHS = new Set<string>([PATHS.aiDraft, PATHS.aiSandbox, PATHS.aiWebAdvisor, PATHS.aiAnalyze, PATHS.aiKnowledge, PATHS.aiImage, PATHS.aiTokens, PATHS.aiUsageReport, PATHS.aiPricing, PATHS.aiProfileTemplate, PATHS.aiPromptPreview]);

/**
 * The agents a LANDING may report a call for. Only the two the landing genuinely runs on its own
 * key: a merchant must not be able to write rows that look like the bot answering customers, or
 * its own token book stops meaning anything.
 */
const REPORTABLE_AGENTS = new Set<AgentId>(["tag_scan", "stock_image"]);

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);

export class AiController implements RequestController {
  constructor(private readonly options: AiControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!AI_PATHS.has(ctx.path)) return false;
    const isPricingRead = ctx.method === "GET" && ctx.path === PATHS.aiPricing;
    if (ctx.method !== "POST" && !isPricingRead) { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }

    const token = bearerToken(req);
    if (!token) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    let tenant = this.options.license ? this.options.license.tenantForInboxToken(token) : null;
    const shared = this.options.sharedToken ?? "";
    const viaSharedToken = tenant === null && shared !== "" && constantTimeEqual(token, shared);
    if (tenant === null && !viaSharedToken) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }

    const body = isPricingRead ? {} : await ctx.readJson();
    if (body === null) return true;
    if (viaSharedToken) tenant = text(body["tenant"], 64);
    else if (body["tenant"] && String(body["tenant"]) !== tenant) { sendJson(res, 403, { ok: false, error: "tenant_khong_khop" }); return true; }
    const shop = String(tenant || "");
    if (!shop) { sendJson(res, 400, { ok: false, error: "thieu_tenant" }); return true; }

    try {
      switch (ctx.path) {
        case PATHS.aiDraft: {
          const maHoiThoai = text(body["maHoiThoai"], 191);
          if (!maHoiThoai) { sendJson(res, 400, { ok: false, error: "thieu_ma_hoi_thoai" }); return true; }
          return this.reply(res, await this.options.desk.draft({ tenant: shop, maHoiThoai, kenh: text(body["kenh"], 40) || maHoiThoai.split(":")[0] || "facebook", cheDo: text(body["cheDo"], 16), nguon: text(body["nguon"], 16) }));
        }
        case PATHS.aiSandbox:
        case PATHS.aiWebAdvisor: {
          const chu = text(body["chu"]);
          if (!chu) { sendJson(res, 400, { ok: false, error: "thieu_chu", message: "Nhập tin nhắn khách." }); return true; }
          const lichSu = (Array.isArray(body["lichSu"]) ? body["lichSu"] : []).slice(-30).map((m) => {
            const o = m !== null && typeof m === "object" ? (m as Record<string, unknown>) : {};
            return { ai: o["ai"] === "khach" ? "khach" : "shop", chu: text(o["chu"]) };
          }).filter((m) => m.chu !== "");
          // Same machinery, two purposes: a shop trying the bot out, and a visitor on the shop's site.
          const mucDich = ctx.path === PATHS.aiWebAdvisor ? "web" as const : "demo" as const;
          const anh = (Array.isArray(body["anh"]) ? body["anh"] : []).map((a) => String(a ?? "")).filter((a) => /^https:\/\//i.test(a)).slice(0, 4);
          return this.reply(res, await this.options.desk.sandbox({ tenant: shop, lichSu, chu, mucDich, anh }));
        }
        case PATHS.aiProfileTemplate: return this.reply(res, await this.options.desk.profileTemplate({ tenant: shop }));
        case PATHS.aiPromptPreview: return this.reply(res, await this.options.desk.promptPreview({ tenant: shop }));
        case PATHS.aiAnalyze: {
          const hoiThoai = (Array.isArray(body["hoiThoai"]) ? body["hoiThoai"] : []).slice(0, 60).map((c) => {
            const o = c !== null && typeof c === "object" ? (c as Record<string, unknown>) : {};
            const tin = (Array.isArray(o["tin"]) ? o["tin"] : []).map((m) => {
              const x = m !== null && typeof m === "object" ? (m as Record<string, unknown>) : {};
              return { chieu: x["chieu"] === "di" ? "di" : "den", chu: text(x["chu"], 1000) };
            }).filter((m) => m.chu !== "");
            return { ma: text(o["ma"], 191), tin };
          }).filter((c) => c.tin.length > 0);
          if (hoiThoai.length === 0) { sendJson(res, 400, { ok: false, error: "thieu_hoi_thoai" }); return true; }
          return this.reply(res, await this.options.desk.analyze({ tenant: shop, hoiThoai }));
        }
        case PATHS.aiKnowledge: {
          const chuDe = text(body["chuDe"], 1000);
          if (!chuDe) { sendJson(res, 400, { ok: false, error: "thieu_chu_de", message: "Nhập chủ đề kho kiến thức." }); return true; }
          return this.reply(res, await this.options.desk.propose({ tenant: shop, chuDe }));
        }
        case PATHS.aiImage: {
          const anh = (Array.isArray(body["anh"]) ? body["anh"] : []).map((a) => String(a ?? "")).filter((a) => /^(https:\/\/|data:image\/)/i.test(a)).slice(0, 4);
          if (anh.length === 0) { sendJson(res, 400, { ok: false, error: "thieu_anh", message: "Cần ảnh https hoặc data:image." }); return true; }
          return this.reply(res, await this.options.desk.readImage({ tenant: shop, anh, goiY: text(body["goiY"], 300), maHoiThoai: text(body["maHoiThoai"], 191), kenh: text(body["kenh"], 40), mucDich: text(body["mucDich"], 20) }));
        }
        case PATHS.aiTokens: {
          const summary = this.options.ledger.summarize({ shop, days: Number(body["soNgay"]) || 7, channel: text(body["kenh"], 20), model: text(body["model"], 120), now: this.options.clock.now() });
          sendJson(res, 200, { ok: true, soToken: summary });
          return true;
        }
        case PATHS.aiUsageReport: {
          const viec = text(body["viec"], 40) as AgentId;
          if (!REPORTABLE_AGENTS.has(viec)) {
            sendJson(res, 400, { ok: false, error: "viec_khong_ghi_duoc", message: `Landing chỉ ghi được lượt của ${[...REPORTABLE_AGENTS].join(", ")}.` });
            return true;
          }
          const model = text(body["model"], 120);
          if (!model) { sendJson(res, 400, { ok: false, error: "thieu_model", message: "Thiếu tên model của lượt gọi." }); return true; }
          // The raw `usage` block of the gateway travels verbatim: reading it (the gateway counts
          // reasoning tokens outside `completion_tokens`) and pricing it stay in ONE place.
          const row = this.options.ledger.record({
            context: { shop, agent: viec, channel: text(body["kenh"], 40) || "kho", conversationId: text(body["maHoiThoai"], 191) },
            model, ok: body["ok"] !== false, usage: readOpenAiUsage(body["soLieu"]),
            error: text(body["loi"], 160) || undefined, at: this.options.clock.now()
          });
          sendJson(res, 200, { ok: true, daGhi: row !== null, ...(row ? { chiPhiVnd: row.costVnd } : {}) });
          return true;
        }
        case PATHS.aiPricing: {
          const editable = this.options.priceEditors.includes(shop);
          if (ctx.method === "GET") {
            const { pricing, source } = this.options.prices.read();
            sendJson(res, 200, { ok: true, pricing, source, duocSua: editable });
            return true;
          }
          if (!editable) { sendJson(res, 403, { ok: false, error: "khong_duoc_sua_bang_gia", message: "Bảng giá AI dùng chung mọi shop, do nơi cấp phần mềm quản lý trên Xeon." }); return true; }
          const cleaned = cleanPricing(body);
          if (!cleaned.ok) { sendJson(res, 400, { ok: false, error: "bang_gia_sai", message: cleaned.viSao }); return true; }
          this.options.prices.save(cleaned.pricing);
          this.options.logger.info(`[ai] shop "${shop}" luu bang gia AI: ${cleaned.pricing.models.length} dong`);
          sendJson(res, 200, { ok: true, pricing: cleaned.pricing, source: "file", duocSua: true });
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      this.options.logger.warn(`[ai] ${ctx.path} hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
      return true;
    }
  }

  private reply(res: ServerResponse, result: DeskResult<object>): boolean {
    if (result.ok) sendJson(res, 200, result);
    else sendJson(res, result.status, { ok: false, error: result.error, message: result.message });
    return true;
  }
}
