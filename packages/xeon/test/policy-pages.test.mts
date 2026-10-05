/**
 * THE PLATFORM'S LEGAL PAGES (02/10/2026, mockup 2): one copy on Xeon for the developer's Meta app.
 * Names come from configuration, never from code; orders and invoices are said to be kept.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import "./industries.mts";
import { ManualClock, PATHS, PolicyController, createXeonServer, renderPolicyPage } from "@sp/xeon";

const IDENTITY = { operatorName: "Nhà phát triển Mẫu", appName: "Ứng dụng Mẫu", contactEmail: "lienhe@nentang.test" };

test("each page names the configured developer, app and mailbox", () => {
  for (const kind of ["privacy", "terms", "deletion"] as const) {
    const html = renderPolicyPage(kind, IDENTITY, 2026);
    assert.match(html, /Nhà phát triển Mẫu/, kind);
    assert.match(html, /Ứng dụng Mẫu/, kind);
    assert.match(html, /mailto:lienhe@nentang\.test/, kind);
    assert.doesNotMatch(html, /toprun|dasbui|gmail/i, kind);
  }
});

test("orders and invoices are kept; no fixed deadline is promised", () => {
  const html = renderPolicyPage("deletion", IDENTITY, 2026);
  assert.match(html, /lưu theo thời hạn pháp luật về kế toán và thuế/);
  assert.doesNotMatch(html, /30 ngày|72 giờ/);
});

test("nothing configured: the page says so instead of borrowing a name or a mailbox", () => {
  const html = renderPolicyPage("privacy", { operatorName: "", appName: "", contactEmail: "" }, 2026);
  assert.match(html, /nhà phát triển chưa khai/);
  assert.doesNotMatch(html, /mailto:/);
  assert.doesNotMatch(renderPolicyPage("privacy", { ...IDENTITY, operatorName: "<script>x</script>" }, 2026), /<script>x/);
});

test("served at the three public paths over a real socket; other paths fall through", async () => {
  const server = createXeonServer({ controllers: [new PolicyController(IDENTITY, new ManualClock(new Date("2026-10-02T00:00:00Z")))] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  /** One request on its own connection (no pooled socket left open when the test ends). */
  const get = (p: string) => new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body }));
    }).on("error", reject);
  });
  try {
    for (const p of [PATHS.policyPrivacy, PATHS.policyTerms, PATHS.policyDeletion, `${PATHS.policyPrivacy}/`]) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.type, /text\/html/);
      assert.match(r.body, /Ứng dụng Mẫu/);
    }
    assert.notEqual((await get("/chinh-sach/khac")).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
