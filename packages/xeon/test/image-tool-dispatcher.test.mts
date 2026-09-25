import test from "node:test";
import assert from "node:assert/strict";
import { ImageJobQueue, ImageToolDispatcher, MemoryLogger } from "@sp/xeon";

/** Records every knock, and can refuse or hang on demand. */
function fakeTool(behaviour: { ok?: boolean; status?: number; throws?: string } = {}) {
  const calls: { url: string; auth: string; body: string }[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, auth: init.headers["Authorization"] ?? "", body: init.body });
    if (behaviour.throws) throw new Error(behaviour.throws);
    return { ok: behaviour.ok !== false, status: behaviour.status ?? 202 };
  };
  return { calls, fetch };
}

function build(behaviour = {}, options: { url?: string; key?: string } = {}) {
  const queue = new ImageJobQueue(null);
  const logger = new MemoryLogger();
  const tool = fakeTool(behaviour);
  const dispatcher = new ImageToolDispatcher({
    url: options.url ?? "https://imagetool.elevenvoice.site",
    key: options.key ?? "ma-cua-tool",
    queue, logger, fetch: tool.fetch
  });
  return { queue, logger, tool, dispatcher };
}

test("Image Tool: nua cau hinh thi TAT — dia chi ma khong co ma la cua mo khong khoa", () => {
  assert.equal(build({}, { key: "" }).dispatcher.ready(), false);
  assert.equal(build({}, { url: "" }).dispatcher.ready(), false);
  assert.equal(build().dispatcher.ready(), true);
});

test("Image Tool: go cua kem ma, dung duong /jobs", async () => {
  const { tool, dispatcher } = build();
  assert.equal(await dispatcher.knock("HQ2053"), true);
  assert.equal(tool.calls[0]?.url, "https://imagetool.elevenvoice.site/jobs");
  assert.equal(tool.calls[0]?.auth, "Bearer ma-cua-tool");
  assert.equal(JSON.parse(tool.calls[0]!.body).code, "HQ2053");
});

test("Image Tool: khong co ma nao cho thi KHONG go cua", async () => {
  const { tool, dispatcher } = build();
  assert.equal(await dispatcher.sweep(), false);
  assert.equal(tool.calls.length, 0);
});

test("Image Tool: mot lan go cho ca hang doi, khong phai moi ma mot lan", async () => {
  // Tool tu rut het hang doi cho den khi Xeon bao het, nen 1.000 ma nap mot luc
  // van chi la mot cuoc goi — khong phai mot nghin.
  const { queue, tool, dispatcher } = build();
  for (const code of ["A1", "B2", "C3"]) queue.enqueue(code);
  assert.equal(await dispatcher.sweep(), true);
  assert.equal(tool.calls.length, 1);
});

test("Image Tool: tool tra loi loi thi KHONG nem, viec van nam trong hang doi", async () => {
  const { queue, dispatcher, logger } = build({ ok: false, status: 502 });
  queue.enqueue("A1");
  assert.equal(await dispatcher.sweep(), false, "go cua that bai tra false, khong nem");
  assert.equal(queue.control().waiting, 1, "mat mot lan go KHONG duoc lam mat viec");
  assert.match(logger.warnings.join("\n"), /502/);
});

test("Image Tool: tunnel chet thi chi canh bao MOT lan mot phut", async () => {
  const { queue, dispatcher, logger } = build({ throws: "ECONNREFUSED" });
  queue.enqueue("A1");
  for (let i = 0; i < 5; i += 1) await dispatcher.sweep();
  const warnings = logger.warnings.filter((line) => line.includes("khong goi duoc"));
  assert.equal(warnings.length, 1, "dong ho go moi phut: 5 lan hong khong duoc thanh 5 dong nhat ky");
});
