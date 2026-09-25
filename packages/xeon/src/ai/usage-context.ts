/**
 * @file WHO a model call works for — carried implicitly through the call chain (Đ7 token ledger).
 *
 * Sales Desk learned this the hard way (`ai_usage_kit.js`, 15/09/2026): the place that knows the
 * shop, the channel and the conversation is the ENTRY point (a customer message, a draft request),
 * while the place that knows the tokens is the model adapter three calls deeper. Threading a
 * context argument through the agent loop, the writer and every tool would touch every signature.
 * `AsyncLocalStorage` carries it instead: the entry point wraps its work in `withUsage`, the metered
 * model reads `currentUsage()`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Agents (Desk's `AGENTS` table, Xeon's subset). Wire values: the Token AI screen groups on them. */
export const AGENTS = {
  bot_l2: { label: "Bot trả lời khách", group: "tra_loi_khach" },
  context_analysis: { label: "Phân tích ngữ cảnh (LLM#1)", group: "tra_loi_khach" },
  draft_l3: { label: "Soạn nháp dự phòng (LLM#3)", group: "tra_loi_khach" },
  verify_match: { label: "Xác nhận mẫu (LLM#2)", group: "tra_loi_khach" },
  ai_draft: { label: "Nháp gợi ý cho người trực", group: "tra_loi_khach" },
  image_match: { label: "Đọc ảnh khách gửi", group: "tra_loi_khach" },
  web_advisor: { label: "Trợ lý AI trên web", group: "tra_loi_khach" },
  external_product_vision: { label: "Đọc ảnh hàng ngoài catalog", group: "tra_loi_khach" },
  sandbox: { label: "Demo AI (hộp cát)", group: "training" },
  training: { label: "Phân tích hội thoại lưu trữ", group: "training" },
  knowledge: { label: "Đề xuất kho kiến thức", group: "training" },
  content_writer: { label: "Viết bài Facebook", group: "content" },
  content_review: { label: "Phản biện bài (ba người chấm)", group: "content" },
  content_optimize: { label: "Tối ưu bài theo góp ý", group: "content" },
  content_trend: { label: "Nghiên cứu xu hướng", group: "content" },
  content_profile: { label: "Hiểu lời shop kể về cách làm content", group: "content" },
  knowledge_research: { label: "Nghiên cứu sản phẩm mẫu", group: "training" },
  tag_scan: { label: "Đọc tem quét kho", group: "kho" },
  stock_image: { label: "Đọc ảnh tồn đối tác", group: "kho" },
  khac: { label: "Chưa gắn nhãn", group: "khac" }
} as const;

export type AgentId = keyof typeof AGENTS;

export const GROUP_LABELS: Record<string, string> = {
  tra_loi_khach: "Trả lời khách", content: "Content", kho: "Kho và quét tem", training: "Training AI", video: "Video Studio", khac: "Khác"
};

/** Channel groups as the screen filters them (Desk `CHANNEL_GROUPS`). */
export const CHANNEL_LABELS: Record<string, string> = {
  fanpage: "Fanpage", zalo: "Zalo nhóm", personal: "FB cá nhân", comment: "Bình luận", demo: "Demo AI", web: "Khách trên web"
};

/** The landing's channel names mapped to the screen's channel groups. */
export function channelGroup(channel: string): string {
  if (channel === "facebook") return "fanpage";
  if (channel === "facebook-binh-luan") return "comment";
  if (channel === "zalo") return "zalo";
  if (channel === "fb-ca-nhan") return "personal";
  if (channel === "demo") return "demo";
  if (channel === "web") return "web";
  return "";
}

export interface UsageContext {
  shop: string;
  agent: AgentId;
  /** The landing's channel (`facebook`, `zalo`, ...) or `demo`. */
  channel?: string | undefined;
  conversationId?: string | undefined;
  /** A content post id, when the call writes one. */
  postId?: string | undefined;
}

const store = new AsyncLocalStorage<UsageContext>();

/** Runs `work` with `context` visible to every model call it makes. */
export function withUsage<T>(context: UsageContext, work: () => Promise<T>): Promise<T> {
  return store.run(context, work);
}

/** The context of the running call, or `null` outside any `withUsage`. */
export function currentUsage(): UsageContext | null {
  return store.getStore() ?? null;
}
