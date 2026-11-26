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

test("only a standalone leading timer exception applies to the following statement", () => {
  const text = [
    "await page.waitForTimeout(100); // fixed-sleep-ok: first timer is under test",
    "await page.waitForTimeout(100);",
    "const duration = 100; /* fixed-sleep-ok: a trailing block is still trailing */",
    "await page.waitForTimeout(duration);",
    "  /* fixed-sleep-ok: this timer is the behavior being tested */",
    "  await page.waitForTimeout(duration);",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => finding.line),
    [1, 2, 4],
  );
});

test("checks promises returned by test and hook callbacks without reporting ordinary timer creation", () => {
  const text = [
    'import { test as check, beforeEach as prepare } from "vitest";',
    'import { test as browserTest } from "@playwright/test";',
    'import { it as local } from "./helpers";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'check("expression", () => page.waitForTimeout(100));',
    "prepare(() => { return new Promise(resolve => setTimeout(resolve, 20)); });",
    "browserTest.afterEach(() => delay(100));",
    'test("global", () => { if (ready) return delay(100); });',
    'it("awaited", async () => await delay(100));',
    'local("unrelated", () => delay(100));',
    'describe("collection", () => delay(100));',
    'test("deferred", async () => { const timer = delay(100); await vi.advanceTimersByTimeAsync(100); observe(timer); });',
    'test("signal", () => { function helper() { return delay(100); } return emitter.once("ready"); });',
    'function register(test) { test("local", () => delay(100)); }',
    "const pause = () => delay(100);",
    'test("helper", () => pause());',
    "const waitCase = () => delay(100);",
    "const waitAgain = waitCase;",
    'check("named", waitAgain);',
    'check("same callback reused", waitAgain);',
    "function waitHook() {",
    "  return delay(100);",
    "}",
    "prepare(waitHook);",
    'check.each([1])("each", () => delay(100));',
    'test.for([1])("for", () => delay(100));',
    "const parameterized = check.each([1]);",
    'parameterized("aliased builder", () => delay(100));',
    'import { waitCase as externalWait } from "./tests";',
    'check("unresolved callback", externalWait);',
    "let replaced = () => delay(100);",
    "replaced = () => ready();",
    'check("mutable callback", replaced);',
    "const unregistered = () => delay(100);",
    "check.each([unregistered]);",
    "check.each`value",
    "  ${1}",
    '`("tagged table", () => delay(100));',
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => finding.line),
    [5, 6, 7, 8, 9, 16, 17, 22, 25, 26, 28, 38],
  );
  assert.deepEqual(
    findings(text, undefined, new Set([15])).map((finding) => finding.line),
    [16],
  );
  for (const [changed, expected] of [
    [18, 17],
    [20, 17],
    [24, 22],
    [27, 28],
  ]) {
    assert.deepEqual(
      findings(text, undefined, new Set([changed])).map(
        (finding) => finding.line,
      ),
      [expected],
    );
  }
});

test("reports only changed waits, including multiline awaits", () => {
  const text =
    "await page.waitForTimeout(100);\nawait new Promise(resolve =>\n  setTimeout(resolve, 20)\n);";
  assert.deepEqual(
    findings(text, undefined, new Set([3])).map((finding) => finding.line),
    [2],
  );
});

test("follows fixed-wait declarations that establish the timer, not its inputs", () => {
  const text = [
    "const page = makePage();",
    "const duration = configuredDelay;",
    "await page.waitForTimeout(duration);",
    "import {",
    "  setTimeout as wait,",
    "  setImmediate,",
    '} from "node:timers/promises";',
    "const pause = () => wait(duration);",
    "const pauseAgain = pause;",
    "await pauseAgain();",
    "const waitForPage =",
    "  page.waitForTimeout;",
    "await waitForPage(duration);",
  ].join("\n");
  assert.deepEqual(findings(text, undefined, new Set([1, 2, 6])), []);
  for (const line of [5, 7, 8, 9]) {
    assert.deepEqual(
      findings(text, undefined, new Set([line])).map((finding) => finding.line),
      [10],
    );
  }
  assert.deepEqual(
    findings(text, undefined, new Set([12])).map((finding) => finding.line),
    [13],
  );
});

test("identifies test setup by a test basename or a test directory", () => {
  const text = "await page.waitForTimeout(100);";
  for (const file of [
    "packages/desktop-app/src/main/computer-control/setup.ts",
    "templates/crm/app/routes/setup.tsx",
  ]) {
    assert.deepEqual(findings(text, file), []);
  }
  for (const file of [
    "e2e/setup.ts",
    "src/setupTests.ts",
    "src/vitest.setup.ts",
  ]) {
    assert.equal(findings(text, file).length, 1);
  }
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

test("follows MSW strategy and factory bindings without following unrelated inputs", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    "const handlers = getHandlers();",
    "const server = setupServer(",
    "  ...handlers,",
    ");",
    "const showLogs = true;",
    'const mode = "warn";',
    "const config = {",
    "  quiet: showLogs,",
    "  onUnhandledRequest: mode,",
    "};",
    "const options = config;",
    "server.listen(options);",
    "const otherOptions = {",
    '  misspelledOnUnhandledRequest: "error",',
    "};",
    "server.listen(otherOptions);",
  ].join("\n");
  assert.deepEqual(findings(text, undefined, new Set([2, 4, 6, 9])), []);
  for (const [line, expected] of [
    [1, [13, 17]],
    [3, [13, 17]],
    [7, [13]],
    [10, [13]],
    [12, [13]],
    [15, [17]],
  ] as const) {
    assert.deepEqual(
      findings(text, undefined, new Set([line])).map((finding) => finding.line),
      expected,
    );
  }
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

test("detects resolving timers alongside other statements in executors and callbacks", () => {
  const text = [
    "await new Promise(resolve => { setTimeout(resolve, 20); log(); });",
    "await new Promise(resolve => { const timer = setTimeout(resolve, 20); log(timer); });",
    "await new Promise(resolve => setTimeout(() => { log(); resolve(); }, 20));",
    'await new Promise((resolve, reject) => { emitter.once("ready", resolve); setTimeout(reject, 20); });',
    'await new Promise((resolve, reject) => { emitter.once("ready", resolve); setTimeout(() => { log(); reject(); }, 20); });',
    'await new Promise(resolve => { function unused() { setTimeout(resolve, 20); } emitter.once("ready", resolve); });',
    'await new Promise((resolve, reject) => { emitter.once("ready", resolve); setTimeout(() => { const unused = () => resolve(); reject(); }, 20); });',
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => [finding.line, finding.rule]),
    [1, 2, 3].map((line) => [line, "test/no-fixed-sleep"]),
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

test("uses the effective MSW strategy when object keys are computed", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    "const server = setupServer();",
    'const otherKey = "quiet";',
    'const strictKey = "onUnhandledRequest";',
    'const strategy = "error";',
    'server.listen({ onUnhandledRequest: "warn", [otherKey]: "error" });',
    'server.listen({ onUnhandledRequest: "warn", [strictKey]: "error" });',
    'server.listen({ onUnhandledRequest: "error", [otherKey]: false });',
    'server.listen({ onUnhandledRequest: "warn", [unknownKey]: "error" });',
    'server.listen({ onUnhandledRequest: "error", [unknownKey]: "warn" });',
    'server.listen({ [unknownKey]: "warn", [strictKey]: strategy });',
    'const onUnhandledRequest = "error";',
    "server.listen({ onUnhandledRequest });",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => [finding.line, finding.rule]),
    [6, 9, 10].map((line) => [line, "test/strict-msw"]),
  );
});

test("MSW starts cannot rely on mutable or escaped options", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    "const server = setupServer();",
    'const options = { onUnhandledRequest: "error" };',
    "const alias = options;",
    'alias.onUnhandledRequest = "warn";',
    "server.listen(options);",
    'const escaped = { onUnhandledRequest: "error" };',
    "configure({ escaped });",
    "server.listen(escaped);",
    'let reassigned = { onUnhandledRequest: "error" };',
    'reassigned = { onUnhandledRequest: "warn" };',
    "server.listen(reassigned);",
    'let strategy = "error";',
    'strategy = "warn";',
    "server.listen({ onUnhandledRequest: strategy });",
    'export const exposed = { onUnhandledRequest: "error" };',
    "server.listen(exposed);",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => [finding.line, finding.rule]),
    [6, 9, 12, 15, 17].map((line) => [line, "test/strict-msw"]),
  );
  assert.deepEqual(
    findings(text, undefined, new Set([5, 8, 11, 14])).map(
      (finding) => finding.line,
    ),
    [6, 9, 12, 15],
  );
});

test("identifies MSW instances returned by simple local wrappers", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    'import { setupWorker } from "msw/browser";',
    "const createServer = () => setupServer();",
    "function createWorker() { return setupWorker(); }",
    "const server = createServer();",
    "const worker = createWorker();",
    "server.listen();",
    'await worker.start({ onUnhandledRequest: "warn" });',
    'createServer().listen({ onUnhandledRequest: "error" });',
  ].join("\n");
  assert.deepEqual(
    findings(text, undefined, new Set([3, 4])).map((finding) => finding.line),
    [7, 8],
  );
});

test("accepts explicit MSW error strategy through a local options constant and ignores unrelated servers", () => {
  const text = [
    'import { setupServer } from "msw/node";',
    "const server = setupServer();",
    'const strict = { "onUnhandledRequest": "error" } as const;',
    "server.listen(strict);",
    "const alias = strict;",
    "server.listen(alias);",
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
        'import callbackTimers from "node:timers";',
        'import promiseTimers from "node:timers/promises";',
        "await new Promise(resolve => schedule(() => { resolve(); }, 20));",
        "await new Promise(resolve => setTimeout(function () { resolve(); }, 20));",
        "await new Promise(resolve => callbackTimers.setTimeout(resolve, 20));",
        "await promiseTimers.setTimeout(20);",
      ].join("\n"),
    ).map((finding) => finding.line),
    [4, 5, 6, 7],
  );
});

test("resolves destructured timer members through scoped imported bindings", () => {
  const text = [
    'import * as timers from "node:timers/promises";',
    'import callbackTimers from "node:timers";',
    'import * as other from "./fake-timers";',
    "const { setTimeout: sleep, scheduler: { wait } } = timers;",
    "const { setTimeout: schedule } = callbackTimers;",
    "const { setTimeout: fake } = other;",
    "await sleep(100);",
    "await wait(100);",
    "await new Promise(resolve => schedule(resolve, 100));",
    "await fake(100);",
  ].join("\n");
  assert.deepEqual(
    findings(text).map((finding) => finding.line),
    [7, 8, 9],
  );
  assert.deepEqual(
    findings(text, undefined, new Set([4, 5])).map((finding) => finding.line),
    [7, 8, 9],
  );
});

test("resolves imported timer and MSW symbols for Windows-style source paths", () => {
  const text = [
    'import { setTimeout } from "node:timers/promises";',
    'import { setupServer } from "msw/node";',
    "await setTimeout(100);",
    "setupServer().listen();",
  ].join("\n");
  assert.deepEqual(
    findings(text, "packages\\core\\src\\example.spec.ts").map(
      (finding) => finding.rule,
    ),
    ["test/no-fixed-sleep", "test/strict-msw"],
  );
});
