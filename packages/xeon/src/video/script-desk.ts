/**
 * @file WRITING THE VIDEO SCRIPT — the one part of making a video that stays on Xeon (Đ9, 21/09/2026).
 *
 * Rendering moved to the shop's own machine because it is minutes of CPU and GPU per clip. This did
 * not: it needs the model key, and the key has lived only on Xeon since 14/09/2026 — a shop never
 * buys one, never types one, never has one on its machine.
 *
 * The loop is the tool's (`toprun-video-studio`, README "viết → kiểm → chưa đạt thì báo đúng lỗi và
 * bắt viết lại, tối đa 3 vòng"): ASKING FOR "BETTER" CHANGES NOTHING, naming the mistakes does. The
 * checker is code, not prompt, for the same reason the reply reviewer is (`sales-agent.ts`): a model
 * told "never read the price out" still does, now and then.
 *
 * Every call is metered like any other (Đ7): one ledger row, priced from the one table on Xeon.
 */

import type { ChatMessage, ChatModelPort } from "../agent/chat-model";
import { withUsage } from "../ai/usage-context";
import type { Clock } from "../support/clock";
import type { Logger } from "../support/logger";
import {
  buildVideoFixPrompt, buildVideoScriptPrompt, parseScript, validateScript,
  type ScriptCheck, type ScriptPost, type ScriptProduct, type ShopVoice, type VideoScript
} from "./script-prompt";

/** Write, check, rewrite. Three rounds: past that the model is not going to get there this time. */
export const MAX_ROUNDS = 3;
export const ROUND_TIMEOUT_MS = 60_000;

export interface WriteScriptInput {
  shop: string;
  tenShop: string;
  nganh: string;
  bai: ScriptPost;
  sanPham?: Record<string, ScriptProduct> | undefined;
  /** For the token ledger: which conversation/post this belongs to. */
  maViec?: string | undefined;
}

export type WriteScriptResult =
  | { ok: true; kichBan: VideoScript; vong: number; canhBao: string[]; model: string }
  | { ok: false; viSao: string; vong: number; loi: string[] };

export interface VideoScriptDeskOptions {
  model: ChatModelPort;
  logger: Logger;
  clock: Clock;
}

export class VideoScriptDesk {
  constructor(private readonly options: VideoScriptDeskOptions) {}

  ready(): boolean {
    return this.options.model.ready();
  }

  async write(input: WriteScriptInput): Promise<WriteScriptResult> {
    const codes = (input.bai.codes ?? []).filter(Boolean);
    if (codes.length === 0) return { ok: false, viSao: "bai_khong_co_ma", vong: 0, loi: ["Bài không có mã hàng nào để dựng video."] };

    const shop: ShopVoice = { tenShop: input.tenShop || input.shop, nganh: input.nganh || "hàng" };
    const built = buildVideoScriptPrompt(input.bai, input.sanPham ?? {}, shop);
    const convo: ChatMessage[] = [
      { role: "system", content: built.system },
      { role: "user", content: built.user }
    ];

    let lastCheck: ScriptCheck = { ok: false, errors: ["Chưa gọi được model."], warnings: [] };
    let model = "";
    for (let vong = 1; vong <= MAX_ROUNDS; vong += 1) {
      const answer = await withUsage(
        { shop: input.shop, agent: "content_optimize", channel: "video", ...(input.maViec ? { postId: input.maViec } : {}) },
        () => this.options.model.complete(convo, { timeoutMs: ROUND_TIMEOUT_MS })
      );
      if (!answer.ok) {
        this.options.logger.warn(`[video] mo hinh loi vong ${vong}: ${answer.viSao}`);
        // A gateway that is down is not a bad script: say so plainly instead of blaming the writing.
        if (!answer.transient || vong === MAX_ROUNDS) return { ok: false, viSao: answer.viSao, vong, loi: [answer.viSao] };
        continue;
      }
      model = answer.model;
      const script = parseScript(answer.text);
      lastCheck = validateScript(script, codes);
      if (lastCheck.ok && script !== null) {
        if (lastCheck.warnings.length > 0) this.options.logger.info(`[video] kich ban dat, con ${lastCheck.warnings.length} canh bao`);
        return { ok: true, kichBan: { ...script, scriptedBy: "llm" }, vong, canhBao: lastCheck.warnings, model };
      }
      this.options.logger.warn(`[video] kich ban vong ${vong} chua dat: ${lastCheck.errors.slice(0, 3).join("; ")}`);
      if (vong === MAX_ROUNDS) break;
      // Tell it exactly what was wrong and make it write again.
      convo.push({ role: "assistant", content: answer.text });
      convo.push({ role: "user", content: buildVideoFixPrompt(script, lastCheck) });
    }
    return { ok: false, viSao: "kich_ban_chua_dat", vong: MAX_ROUNDS, loi: lastCheck.errors };
  }
}
