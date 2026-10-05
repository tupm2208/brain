/**
 * @file `/kho/*` — the shop's PRICE TABLES (02/10/2026): ready-made tables to start from, and the
 * shop's own words turned into a table.
 *
 * AUTHENTICATION IS THE SAME AS `/noi-dung/*`: the landing carries its PRIVATE INBOX TOKEN, the shop
 * is derived from the token and its industry from what Xeon serves it (the licence) — never from
 * the body. A shop cannot ask for another industry's templates by naming it, nor spend another
 * shop's model budget. Nothing here stores anything: the table lives on the landing.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constantTimeEqual } from "../license/key-format";
import type { LicenseService } from "../license/license-service";
import { PATHS } from "../protocol";
import type { CatalogChoices } from "../selling-price/price-rules";
import type { PriceRuleResult, PriceRuleTranslator } from "../selling-price/price-rule-translator";
import type { PriceTemplateLibrary } from "../selling-price/price-templates";
import type { Logger } from "../support/logger";
import { bearerToken, sendJson, type RequestContext, type RequestController } from "./http-utils";

export interface SellingPriceControllerOptions {
  templates: PriceTemplateLibrary;
  translator: PriceRuleTranslator;
  /** The industry of a merchant Xeon serves; `null` when it serves none (no key, locked, expired). */
  industryOf: (tenant: string) => string | null;
  license: LicenseService | null;
  sharedToken?: string | undefined;
  logger: Logger;
}

/**
 * The industry of a licensed shop, read off its licence. Price tables belong to the warehouse
 * module every key carries, so this asks only for an active key and a registered landing — NOT for
 * the chatbot, as the brain's own binding (`serviceEligibility`) does: a shop that never bought the
 * chatbot still prices its goods.
 */
export function licensedIndustry(license: LicenseService): (tenant: string) => string | null {
  return (tenant) => (license.landingFor(tenant).ok ? license.industryOf(tenant) : null);
}

const PATHS_OWNED = new Set<string>([PATHS.priceTemplates, PATHS.priceRulesFromWords]);
const text = (v: unknown, n = 4000): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown, n: number, len: number): string[] => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, len)).filter(Boolean))].slice(0, n);

/** The catalogue values the landing counted on the shop's own items. */
function catalogChoices(v: unknown): CatalogChoices {
  const o = asObject(v);
  return { loai: strings(o["loai"], 200, 80), hang: strings(o["hang"], 200, 80), mon: strings(o["mon"], 200, 80), gioiTinh: strings(o["gioiTinh"], 200, 80) };
}

export class SellingPriceController implements RequestController {
  constructor(private readonly options: SellingPriceControllerOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (!PATHS_OWNED.has(ctx.path)) return false;
    if (ctx.method !== "POST") { sendJson(res, 405, { ok: false, error: "sai_phuong_thuc" }); return true; }

    const token = bearerToken(req);
    if (!token) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }
    let tenant = this.options.license ? this.options.license.tenantForInboxToken(token) : null;
    const shared = this.options.sharedToken ?? "";
    const viaSharedToken = tenant === null && shared !== "" && constantTimeEqual(token, shared);
    if (tenant === null && !viaSharedToken) { sendJson(res, 401, { ok: false, error: "thieu_ma" }); return true; }

    const body = await ctx.readJson();
    if (body === null) return true;
    if (viaSharedToken) tenant = text(body["tenant"], 64);
    else if (body["tenant"] && String(body["tenant"]) !== tenant) { sendJson(res, 403, { ok: false, error: "tenant_khong_khop" }); return true; }
    const shop = String(tenant || "");
    if (!shop) { sendJson(res, 400, { ok: false, error: "thieu_tenant" }); return true; }

    try {
      const industry = this.options.industryOf(shop);
      if (industry === null) {
        sendJson(res, 403, { ok: false, error: "khong_phuc_vu_shop", message: "Xeon không phục vụ shop này (key khoá / hết hạn / chưa đăng ký)." });
        return true;
      }
      if (ctx.path === PATHS.priceTemplates) {
        const list = this.options.templates.forIndustry(industry);
        if (list.problems.length > 0) this.options.logger.warn(`[kho] bang gia mau co cho sai, da bo qua:\n- ${list.problems.join("\n- ")}`);
        sendJson(res, 200, { ok: true, nganh: industry, mau: list.mau });
        return true;
      }
      const result = await this.options.translator.understand({
        tenant: shop, loiKe: text(body["loiKe"], 4000), bangHienTai: asObject(body["bangHienTai"]),
        huongDan: asObject(body["huongDan"]), giaTriCoSan: catalogChoices(body["giaTriCoSan"])
      });
      if (result.ok) this.options.logger.info(`[kho] shop "${shop}" ke cach tinh gia: ${result.bang.dong.length} dong, ${result.chuaRo.length} cho chua ro`);
      return this.reply(res, result);
    } catch (error) {
      this.options.logger.warn(`[kho] ${ctx.path} hong: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: "loi_he_thong" });
      return true;
    }
  }

  private reply(res: ServerResponse, result: PriceRuleResult): boolean {
    if (result.ok) sendJson(res, 200, result);
    else sendJson(res, result.status, { ok: false, error: result.error, message: result.message });
    return true;
  }
}
