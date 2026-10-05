/**
 * @file The PLATFORM's own legal pages (02/10/2026, mockup 2 approved by Dũng):
 *   GET /chinh-sach              privacy policy of the developer's Meta app
 *   GET /chinh-sach/dieu-khoan   terms of the app and the platform
 *   GET /chinh-sach/xoa-du-lieu  how to have data deleted
 *
 * One copy for every shop, because Meta keeps ONE privacy URL and ONE deletion URL per app. Each
 * shop's landing serves the shop's own pages (`landing_page/src/modules/gian-hang/legal-pages.ts`)
 * and links here.
 *
 * Who the developer is, the app's name on Meta and the contact mailbox come from Xeon's `.env`
 * (`NEN_TANG_TEN`, `META_APP_TEN`, `NEN_TANG_EMAIL`) — never from code. A value not set says so on
 * the page instead of borrowing a name.
 *
 * Orders and invoices are the shops' records: they are kept under accounting and tax law, and the
 * deletion page says so rather than promising them away (Dũng, 02/10/2026).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { PATHS } from "../protocol";
import type { Clock } from "../support/clock";
import type { RequestContext, RequestController } from "./http-utils";

export interface PlatformPolicyIdentity {
  /** The developer / operator ("NEN_TANG_TEN"). */
  operatorName: string;
  /** The app's name as registered on Meta ("META_APP_TEN"). */
  appName: string;
  /** Where data requests go ("NEN_TANG_EMAIL"). */
  contactEmail: string;
}

type PolicyKind = "privacy" | "terms" | "deletion";

const NOT_SET = "(nhà phát triển chưa khai)";

const text = (value: unknown): string => String(value ?? "").trim();

function esc(value: unknown): string {
  return text(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function emailOf(value: unknown): string {
  const raw = text(value);
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(raw) ? raw : "";
}

interface Resolved { operator: string; app: string; email: string; year: number }

function contact(r: Resolved): string {
  return r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : esc(NOT_SET);
}

const KEPT = "Đơn hàng, hoá đơn và chứng từ thanh toán của mỗi cửa hàng được cửa hàng lưu theo thời hạn pháp luật về kế toán và thuế, và chỉ dùng cho sổ sách.";

function privacyBody(r: Resolved): string {
  return `
    <p class="eyebrow">${esc(r.app)}</p>
    <h1>Chính sách quyền riêng tư</h1>
    <p class="lead">${esc(r.app)} là ứng dụng trên Facebook do <strong>${esc(r.operator)}</strong> phát triển. Ứng dụng giúp các cửa hàng dùng nền tảng OMI trả lời tin nhắn và bình luận trên Fanpage của chính cửa hàng.</p>
    <h2>1. Ai giữ dữ liệu nào</h2>
    <ul>
      <li><strong>${esc(r.operator)}</strong> vận hành máy chủ trung tâm, nơi nhận tin từ Facebook và chuyển tới đúng cửa hàng.</li>
      <li>Mỗi cửa hàng giữ dữ liệu khách hàng của mình (hội thoại, đơn hàng) trên máy chủ riêng của cửa hàng. Chính sách của từng cửa hàng nằm trên website của cửa hàng đó.</li>
    </ul>
    <h2>2. Ứng dụng nhận những gì</h2>
    <ul>
      <li>Khi chủ Fanpage kết nối: tên và mã Fanpage, mã truy cập trang để gửi trả lời.</li>
      <li>Tin nhắn và bình luận gửi tới Fanpage đã kết nối: nội dung, ảnh và mã người gửi theo trang.</li>
      <li>Khi chủ Fanpage đăng nhập bằng Facebook: tên và mã người dùng theo ứng dụng.</li>
    </ul>
    <h2>3. Dùng để làm gì</h2>
    <ul>
      <li>Chuyển tin tới máy chủ của cửa hàng sở hữu Fanpage.</li>
      <li>Soạn câu trả lời bằng trợ lý tự động khi cửa hàng bật tính năng này.</li>
      <li>Gửi câu trả lời của cửa hàng tới người đã nhắn.</li>
    </ul>
    <p>Dữ liệu không được bán và không dùng để quảng cáo.</p>
    <h2>4. Chia sẻ với ai</h2>
    <ul>
      <li>Cửa hàng sở hữu Fanpage nhận tin nhắn gửi tới Fanpage của mình.</li>
      <li>Nhà cung cấp mô hình AI nhận phần nội dung cần cho một lượt soạn trả lời.</li>
      <li>Cơ quan nhà nước khi pháp luật yêu cầu.</li>
    </ul>
    <h2>5. Lưu trong bao lâu</h2>
    <p>Máy chủ trung tâm chỉ giữ nhật ký kỹ thuật có thời hạn để vận hành và sửa lỗi. Hội thoại và đơn hàng nằm ở máy chủ của cửa hàng, theo chính sách của cửa hàng. ${KEPT}</p>
    <h2>6. Quyền của bạn</h2>
    <p>Bạn có quyền xem, sửa, yêu cầu xoá dữ liệu. Cách làm: <a href="${PATHS.policyDeletion}">trang Xoá dữ liệu</a>.</p>
    <h2>7. Liên hệ</h2>
    <p><strong>${esc(r.operator)}</strong> · Email: ${contact(r)}</p>`;
}

function termsBody(r: Resolved): string {
  return `
    <p class="eyebrow">${esc(r.app)}</p>
    <h1>Điều khoản sử dụng</h1>
    <p class="lead">Điều khoản này áp dụng cho các cửa hàng kết nối Fanpage với ứng dụng ${esc(r.app)} và nền tảng OMI do <strong>${esc(r.operator)}</strong> phát triển.</p>
    <h2>1. Dịch vụ</h2>
    <p>Ứng dụng nhận tin nhắn, bình luận gửi tới Fanpage đã kết nối, chuyển tới máy chủ của cửa hàng và gửi trả lời do cửa hàng hoặc trợ lý tự động của cửa hàng soạn.</p>
    <h2>2. Trách nhiệm của cửa hàng</h2>
    <ul>
      <li>Chỉ kết nối Fanpage mà cửa hàng có quyền quản trị.</li>
      <li>Chịu trách nhiệm về nội dung trả lời, sản phẩm, giá và chính sách bán hàng của mình.</li>
      <li>Giữ và xử lý dữ liệu khách hàng của mình theo pháp luật, có chính sách quyền riêng tư riêng trên website.</li>
      <li>Tuân thủ chính sách của Facebook và Meta.</li>
    </ul>
    <h2>3. Tạm ngừng</h2>
    <p>${esc(r.operator)} có thể tạm ngừng kết nối của một Fanpage khi có dấu hiệu lạm dụng, gửi tin rác hoặc vi phạm chính sách của Meta.</p>
    <h2>4. Giới hạn trách nhiệm</h2>
    <p>Trợ lý tự động có thể trả lời chưa đúng. Cửa hàng xem lại các câu trả lời quan trọng như giá, đơn hàng và thanh toán.</p>
    <h2>5. Quyền riêng tư</h2>
    <p>Xem <a href="${PATHS.policyPrivacy}">Chính sách quyền riêng tư</a> và <a href="${PATHS.policyDeletion}">Xoá dữ liệu</a>.</p>
    <h2>6. Luật áp dụng</h2>
    <p>Điều khoản này theo pháp luật Việt Nam.</p>
    <h2>7. Liên hệ</h2>
    <p><strong>${esc(r.operator)}</strong> · Email: ${contact(r)}</p>`;
}

function deletionBody(r: Resolved): string {
  return `
    <p class="eyebrow">${esc(r.app)}</p>
    <h1>Xoá dữ liệu</h1>
    <h2>Bạn đã nhắn tin cho Fanpage của một cửa hàng</h2>
    <p>Hội thoại và đơn hàng do cửa hàng đó giữ. Bạn gửi yêu cầu xoá cho cửa hàng theo trang Xoá dữ liệu trên website của cửa hàng. Nếu không tìm được cách liên hệ cửa hàng, bạn gửi email tới ${contact(r)}, kèm tên Fanpage đã nhắn; yêu cầu sẽ được chuyển tới đúng cửa hàng.</p>
    <h2>Bạn là chủ Fanpage đã kết nối ứng dụng</h2>
    <ol>
      <li>Trên Facebook, vào Cài đặt và quyền riêng tư → Cài đặt → Tích hợp kinh doanh (hoặc Ứng dụng và trang web), chọn ${esc(r.app)} rồi Gỡ. Mã truy cập trang bị thu hồi ngay.</li>
      <li>Khi gỡ, chọn xoá cả dữ liệu: máy chủ trung tâm TỰ xoá thông tin kết nối và mã truy cập trang do tài khoản của bạn cấp, rồi Facebook đưa bạn một mã yêu cầu để xem trạng thái tại <a href="/meta/xoa-du-lieu/trang-thai">trang trạng thái xoá dữ liệu</a> (dán mã vào cuối địa chỉ: <code>?ma=MÃ</code>). Cần hỗ trợ thêm thì gửi email tới ${contact(r)} kèm tên Fanpage.</li>
    </ol>
    <h2>Những gì được giữ lại</h2>
    <p>${KEPT}</p>
    <h2>Thời hạn</h2>
    <p>Yêu cầu được xác nhận và xử lý trong thời hạn pháp luật quy định.</p>`;
}

const TITLES: Record<PolicyKind, string> = { privacy: "Chính sách quyền riêng tư", terms: "Điều khoản sử dụng", deletion: "Xoá dữ liệu" };

const STYLE = `
  :root { --ink:#1d2b26; --muted:#5c6b65; --paper:#ffffff; --bg:#f3f5f2; --line:#dbe3dd; --brand:#1f6b52; }
  * { box-sizing:border-box; }
  body { margin:0; color:var(--ink); background:var(--bg); font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header,main,footer { width:min(860px,calc(100% - 32px)); margin:auto; }
  header { padding:28px 0 16px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  .brand { color:var(--brand); font-weight:700; font-size:20px; }
  nav { display:flex; flex-wrap:wrap; gap:6px 16px; }
  a { color:var(--brand); }
  main { background:var(--paper); border:1px solid var(--line); border-radius:16px; padding:clamp(20px,5vw,48px); }
  .eyebrow { color:var(--brand); font-weight:700; font-size:13px; letter-spacing:.08em; text-transform:uppercase; margin:0; }
  h1 { margin:.2em 0 .4em; font-size:clamp(28px,5vw,40px); line-height:1.2; }
  h2 { margin-top:1.8em; font-size:20px; }
  .lead { color:var(--muted); font-size:18px; }
  li { margin:.35em 0; }
  footer { padding:22px 0 36px; color:var(--muted); font-size:14px; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e3ebe6; --muted:#a3b2ab; --paper:#18201c; --bg:#111613; --line:#2c3833; --brand:#6cc79f; } }`;

/** One whole HTML document for `kind`. Exported for the tests. */
export function renderPolicyPage(kind: PolicyKind, identity: PlatformPolicyIdentity, year: number): string {
  const r: Resolved = {
    operator: text(identity.operatorName) || NOT_SET,
    app: text(identity.appName) || "Ứng dụng nhắn tin của nền tảng OMI",
    email: emailOf(identity.contactEmail),
    year
  };
  const body = kind === "privacy" ? privacyBody(r) : kind === "terms" ? termsBody(r) : deletionBody(r);
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <title>${esc(`${TITLES[kind]} | ${r.app}`)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header>
    <span class="brand">${esc(r.app)}</span>
    <nav aria-label="Trang pháp lý"><a href="${PATHS.policyPrivacy}">Quyền riêng tư</a><a href="${PATHS.policyTerms}">Điều khoản</a><a href="${PATHS.policyDeletion}">Xoá dữ liệu</a></nav>
  </header>
  <main>${body}
  </main>
  <footer>© ${r.year} ${esc(r.operator)}</footer>
</body>
</html>
`;
}

export class PolicyController implements RequestController {
  constructor(private readonly identity: PlatformPolicyIdentity, private readonly clock: Clock) {}

  async handle(_req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<boolean> {
    if (ctx.method !== "GET") return false;
    const path = ctx.path.replace(/\/+$/, "") || "/";
    const kind: PolicyKind | null = path === PATHS.policyPrivacy ? "privacy" : path === PATHS.policyTerms ? "terms" : path === PATHS.policyDeletion ? "deletion" : null;
    if (kind === null) return false;
    const html = renderPolicyPage(kind, this.identity, this.clock.now().getFullYear());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
    res.end(html);
    return true;
  }
}
