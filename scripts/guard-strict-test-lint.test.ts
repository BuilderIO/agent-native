import assert from "node:assert/strict";
import { test } from "node:test";

import { findStrictTestIssues } from "./guard-strict-test-lint.ts";

const allLines = (text: string) =>
  new Set(text.split("\n").map((_, index) => index + 1));
const findings = (
  text: string,
  file = "packages/core/src/example.spec.ts",
  added = allLines(text),
) => findStrictTestIssues(file, text, added);

test("rejects fixed waits in tests, hooks, helpers, and test setup", () => {
  const text = [
    'import { setTimeout as wait } from "node:timers/promises";',
    'import * as timers from "timers/promises";',
    'import { scheduler } from "node:timers/promises";',
    "beforeEach(async () => { await wait(100); });",
    'test("race", async () => {',
    "  await new Promise(resolve => setTimeout(resolve, 50));",
    "  await new Promise(resolve => setTimeout(() => resolve(), 50));",
    "  await page.waitForTimeout(100);",
    "  await Bun.sleep(100);",
    "  await scheduler.wait(100);",
    "});",
    "const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));",
    "async function helper() { await pause(200); }",
    "const waitAgain = timers.setTimeout;",
    "await waitAgain(100);",
    "await timers.scheduler.wait(100);",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => finding.line),
    [4, 6, 7, 8, 9, 10, 13, 15, 16],
  );
  assert.equal(
    findings("await page.waitForTimeout(100);", "e2e/helpers.ts").length,
    1,
  );
  assert.equal(
    findings("await page.waitForTimeout(100);", "vitest.setup.ts").length,
    1,
  );
  assert.equal(
    findings("await page.waitForTimeout(100);", "src/worker.ts").length,
    0,
  );
});

test("ignores imports whose names happen to match timer APIs", () => {
  assert.deepEqual(
    findings(
      [
        'import { delay, sleep as complete } from "./api";',
        'import { scheduler } from "./job-queue";',
        "await delay();",
        "await complete();",
        "await scheduler.wait();",
      ].join("\n"),
    ),
    [],
  );
});

test("allows signals, fake-timer advancement, and a scoped timer-subject exception", () => {
  const text = [
    "await operation.finished;",
    'await new Promise(resolve => emitter.once("ready", resolve));',
    'await new Promise(resolve => { emitter.once("ready", resolve); setTimeout(fail, 100); });',
    "await vi.advanceTimersByTimeAsync(100);",
    "// fixed-sleep-ok: the timer firing is the behavior being tested",
    "await new Promise(resolve => setTimeout(resolve, 20));",
    "await page.waitForTimeout(50);",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => finding.line),
    [7],
  );
});

test("a sibling fake timer or a marker in a string does not exempt a real sleep", () => {
  const text = [
    'test("fake", () => { vi.useFakeTimers(); });',
    'const note = "fixed-sleep-ok: this is not an exception comment";',
    'test("real", async () => { await page.waitForTimeout(100); });',
    "// fixed-sleep-ok: short",
    "await page.waitForTimeout(100);",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => finding.line),
    [3, 5],
  );
});

test("reports only changed waits, including multiline awaits", () => {
  const text =
    "await page.waitForTimeout(100);\nawait new Promise(resolve =>\n  setTimeout(resolve, 20)\n);";
  assert.deepEqual(
    findings(text, undefined, new Set([3])).map((finding) => finding.line),
    [2],
  );
});

test("rechecks unchanged calls when a local sleep helper or MSW options becomes unsafe", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    "const server = setupServer();",
    'const options = { onUnhandledRequest: "warn" };',
    "server.listen(options);",
    "const pause = () => new Promise(resolve => setTimeout(resolve, 20));",
    "await pause();",
  ].join("\n");
  assert.deepEqual(
    findings(text, undefined, new Set([3, 5])).map((finding) => finding.line),
    [4, 6],
  );
});

test("rejects lenient MSW starts from aliased factories and namespace imports", () => {
  const text = [
    'import { setupServer as createServer } from "msw/node";',
    'import * as browser from "msw/browser";',
    "const server = createServer();",
    "server.listen();",
    'server.listen({ onUnhandledRequest: "warn" });',
    "server.listen({ onUnhandledRequest: () => {} });",
    "const worker = browser.setupWorker();",
    'await worker.start({ onUnhandledRequest: "bypass" });',
    'server.listen({ onUnhandledRequest: "error", ...unknown });',
    'server.listen({ ...unknown, onUnhandledRequest: "error" });',
    'server.listen({ onUnhandledRequest: "error", onUnhandledRequest() {} });',
    'server.listen({ ["onUnhandledRequest"]: "warn" });',
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => [finding.line, finding.rule]),
    [4, 5, 6, 8, 9, 11, 12].map((line) => [line, "test/strict-msw"]),
  );
});

test("attributes existing lenient MSW starts to the factory binding and its module", () => {
  const text = [
    "import {",
    "  setupServer as createServer,",
    "  unrelatedExport,",
    '} from "msw/node";',
    "import * as browser from",
    '  "msw/browser";',
    "const server = createServer();",
    "server.listen();",
    "const worker = browser.setupWorker();",
    "await worker.start();",
  ].join("\n");
  assert.deepEqual(findings(text, undefined, new Set([3])), []);
  for (const [changed, call] of [
    [2, 8],
    [4, 8],
    [6, 10],
  ]) {
    assert.deepEqual(
      findings(text, undefined, new Set([changed])).map((finding) => [
        finding.line,
        finding.rule,
      ]),
      [[call, "test/strict-msw"]],
    );
  }
});

test("accepts explicit MSW error strategy through a local options constant and ignores unrelated servers", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    "const server = setupServer();",
    'const strict = { "onUnhandledRequest": "error" } as const;',
    "server.listen(strict);",
    "function run(server) { server.listen(); }",
    "const other = http.createServer(); other.listen();",
    'const text = "server.listen()";',
    "// server.listen();",
  ].join("\n");
  assert.deepEqual(findings(text), []);
  assert.equal(
    findings(
      'import { setupServer } from "msw/node";\nsetupServer().listen();',
      "src/network-harness.ts",
    ).length,
    1,
  );
});

test("does not mistake a shadowed timer for a real fixed sleep or inspect generated/vendor", () => {
  assert.deepEqual(
    findings(
      'const setTimeout = (resolve, ms) => emitter.once(ms, resolve);\nawait new Promise(resolve => setTimeout(resolve, "ready"));',
    ),
    [],
  );
  assert.deepEqual(
    findings("await page.waitForTimeout(100);", "vendor/example.test.ts"),
    [],
  );
});

test("recognizes a callback timer import and a resolving callback block", () => {
  assert.deepEqual(
    findings(
      [
        'import { setTimeout as schedule } from "node:timers";',
        "await new Promise(resolve => schedule(() => { resolve(); }, 20));",
        "await new Promise(resolve => setTimeout(function () { resolve(); }, 20));",
      ].join("\n"),
    ).map((finding) => finding.line),
    [2, 3],
  );
});
