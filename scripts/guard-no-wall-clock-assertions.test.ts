import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  findWallClockAssertions,
  isTestFilePath,
} from "./guard-no-wall-clock-assertions.ts";

const FILE = "packages/core/src/db/example.spec.ts";
const FLOORS = { test: 30_000, hook: 10_000 };

function allLines(source: string): Set<number> {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function flaggedLines(
  source: string,
  added: ReadonlySet<number> | null = allLines(source),
): number[] {
  return findWallClockAssertions(FILE, source, added, {
    timeoutFloors: FLOORS,
  }).map((finding) => finding.line);
}

function flaggedKinds(source: string): [number, string][] {
  return findWallClockAssertions(FILE, source, allLines(source), {
    timeoutFloors: FLOORS,
  }).map((finding) => [finding.line, finding.kind]);
}

describe("wall-clock assertion detection", () => {
  it("flags every spelling of an elapsed real-time bound", () => {
    const source = [
      "const startedAt = Date.now();",
      "expect(Date.now() - startedAt).toBeLessThan(1_000);",
      "const t0 = performance.now();",
      "expect(performance.now() - t0).not.toBeGreaterThan(200);",
      "const elapsed = performance.now() - t0;",
      "expect(elapsed).toBeLessThanOrEqual(50);",
      "expect(elapsed < 50).toBe(true);",
      "const seconds = Math.round(elapsed / 1000);",
      "expect.soft(seconds).toBeLessThan(2);",
      "const t1 = Date.now();",
      "expect(t1 - startedAt).toBeGreaterThanOrEqual(10);",
      "assert.ok(Date.now() - startedAt < 5_000);",
      "const ns = process.hrtime.bigint();",
      "expect(process.hrtime.bigint() - ns).toBeLessThan(10n);",
      "const before = new Date().getTime();",
      "expect(new Date().getTime() - before).toBeLessThan(100);",
      "expect(lease.expiresAt - Date.now()).toBeGreaterThan(59_000);",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [2, 4, 6, 7, 9, 11, 12, 14, 16, 17]);
  });

  it("allows clock reads that are not an elapsed-time bound", () => {
    const source = [
      "const before = Date.now();",
      "const row = await create({ since: Date.now() - 60_000 });",
      "expect(row.createdAt).toBeGreaterThanOrEqual(before);",
      "expect(row).toEqual({ since: expect.any(Number) });",
      "expect(result.durationMs).toBeLessThan(1_000);",
      "expect(measureCpuMs(() => parse(input))).toBeLessThan(50);",
      "expect(typeof (Date.now() - before)).toBe('number');",
      "expect(Date.now() - before).toBeTypeOf('number');",
      "// expect(Date.now() - before).toBeLessThan(1_000);",
      "const text = 'expect(Date.now() - before).toBeLessThan(1_000)';",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("resolves each name to its own declaration, not to a same-named one", () => {
    const source = [
      'it("times", () => {',
      "  const start = performance.now();",
      "  run();",
      "  expect(performance.now() - start).toBeLessThan(50);",
      "});",
      'it("counts", () => {',
      "  const start = 5;",
      "  const end = 15;",
      "  expect(end - start).toBe(10);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [4]);
  });

  it("reads an aliased clock import, and not a local named like a clock", () => {
    const source = [
      'import { performance as realPerformance } from "node:perf_hooks";',
      'it("reads the aliased clock", () => {',
      "  const started = realPerformance.now();",
      "  expect(realPerformance.now() - started).toBeLessThan(50);",
      "});",
      'it("reads a local named like the clock", () => {',
      "  const performance = { now: () => 0 };",
      "  const t0 = performance.now();",
      "  expect(performance.now() - t0).toBe(0);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [4]);
  });

  it("follows what local functions return", () => {
    const source = [
      "function timed(run) {",
      "  const started = performance.now();",
      "  run();",
      "  return performance.now() - started;",
      "}",
      "async function measure() {",
      "  const started = Date.now();",
      "  const pulled = await pull();",
      "  const elapsed = Date.now() - started;",
      "  return { pulled, elapsed };",
      "}",
      "const now = () => performance.now();",
      'it("bounds a helper\'s result", async () => {',
      "  expect(timed(() => parse(input))).toBeLessThan(200);",
      "  const { pulled, elapsed } = await measure();",
      "  expect(pulled).toBe(3);",
      "  expect(elapsed).toBeLessThan(20_000);",
      "  const t0 = now();",
      "  expect(stop() - t0).toBeLessThan(50);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [14, 17, 19]);
  });

  it("treats a clock variable the test advances itself as a fake clock", () => {
    const source = [
      "let clockMs = 0;",
      "beforeEach(() => {",
      "  clockMs = Date.now();",
      "});",
      'it("compares against the clock it advances", () => {',
      "  clockMs += 20_000;",
      "  const dispatchedAt = dispatch(clockMs);",
      "  expect(Math.abs(dispatchedAt - clockMs)).toBeLessThan(1_000);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("only reports assertions this branch touched, at the first line", () => {
    const source = [
      "const startedAt = Date.now();",
      "expect(Date.now() - startedAt).toBeLessThan(1_000);",
      "expect(",
      "  Date.now() - startedAt,",
      ").toBeLessThan(2_000);",
      "await run();",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([4])), [3]);
    assert.deepEqual(flaggedLines(source, new Set([6])), []);
  });

  it("reports an unchanged assertion whose clock binding this branch changed", () => {
    const source = [
      'it("a", () => {',
      "  const startedAt = Date.now();",
      "  const elapsed = stop() - startedAt;",
      "  expect(elapsed).toBeLessThan(1_000);",
      "});",
      'it("b", () => {',
      "  const startedAt = Date.now();",
      "  const elapsed = performance.now() - t0;",
      "  expect(elapsed).toBeLessThan(1_000);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([3])), [4]);
    assert.deepEqual(flaggedLines(source, new Set([2])), [4]);
    assert.deepEqual(flaggedLines(source, new Set([7])), []);
  });

  it("reports an assertion whose clock a setup hook assigns when that line changes", () => {
    const source = [
      'describe("timing", () => {',
      "  let startedAt = 0;",
      "  beforeEach(() => {",
      "    startedAt = Date.now();",
      "  });",
      '  it("is quick", async () => {',
      "    await run();",
      "    expect(stop() - startedAt).toBeLessThan(1_000);",
      "  });",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([4])), [8]);
    assert.deepEqual(flaggedLines(source, new Set([2])), []);
  });

  it("reports every finding when measuring the backlog", () => {
    const source = [
      "const startedAt = Date.now();",
      "expect(Date.now() - startedAt).toBeLessThan(1_000);",
    ].join("\n");

    assert.equal(findWallClockAssertions(FILE, source, null).length, 1);
  });
});

describe("fake timers", () => {
  it("skips assertions after a test turns fake timers on", () => {
    const source = [
      'it("debounces", () => {',
      "  vi.useFakeTimers();",
      "  const started = Date.now();",
      "  vi.advanceTimersByTime(20_001);",
      "  expect(Date.now() - started).toBe(20_001);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("skips assertions under a describe or file beforeEach that fakes timers", () => {
    const source = [
      'describe("scheduler", () => {',
      "  beforeEach(() => {",
      "    vi.useFakeTimers();",
      "  });",
      '  it("waits", () => {',
      "    const started = Date.now();",
      "    expect(Date.now() - started).toBe(0);",
      "  });",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("counts a local helper that turns fake timers on", () => {
    const source = [
      "function freezeClock() {",
      "  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));",
      "}",
      'it("stamps", () => {',
      "  freezeClock();",
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBe(0);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("ignores a fake-timer helper the test declares but never calls", () => {
    const source = [
      'it("declares", async () => {',
      "  const freeze = () => vi.useFakeTimers();",
      "  const started = Date.now();",
      "  await run();",
      "  expect(Date.now() - started).toBeLessThan(1_000);",
      "});",
      'it("calls", () => {',
      "  const freeze = () => vi.useFakeTimers();",
      "  freeze();",
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBe(0);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [5]);
  });

  it("lets setSystemTime alone cover Date reads but not performance.now()", () => {
    const source = [
      'it("mocks the date", () => {',
      "  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));",
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBe(0);",
      "  const t0 = performance.now();",
      "  expect(performance.now() - t0).toBeLessThan(50);",
      "});",
      'it("fakes timers, then sets the date", () => {',
      "  vi.useFakeTimers();",
      "  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));",
      "  const t0 = performance.now();",
      "  expect(performance.now() - t0).toBe(0);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [6]);
  });

  it("reads which clocks useFakeTimers fakes from its options", () => {
    const source = [
      'it("fakes timeouts only", () => {',
      '  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });',
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBeLessThan(1_000);",
      "});",
      'it("fakes Date only", () => {',
      '  vi.useFakeTimers({ now: 0, toFake: ["Date"] });',
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBe(0);",
      "  const t0 = performance.now();",
      "  expect(performance.now() - t0).toBeLessThan(50);",
      "});",
      'it("advances with real time", async () => {',
      "  vi.useFakeTimers({ shouldAdvanceTime: true });",
      "  const started = Date.now();",
      "  await run();",
      "  expect(Date.now() - started).toBeLessThan(1_000);",
      "});",
      'it("passes options it cannot read", () => {',
      "  vi.useFakeTimers(timerOptions);",
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBe(0);",
      "});",
      'it("fakes every clock by default", () => {',
      "  vi.useFakeTimers({ now: 0 });",
      "  const t0 = performance.now();",
      "  expect(performance.now() - t0).toBe(0);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [4, 11, 17, 22]);
  });

  it("lets node:test's mock timers cover Date only", () => {
    const source = [
      'test("node timers", (t) => {',
      '  t.mock.timers.enable({ apis: ["Date"] });',
      "  const started = Date.now();",
      "  assert.equal(Date.now() - started, 0);",
      "  const t0 = performance.now();",
      "  assert.ok(performance.now() - t0 < 50);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [6]);
  });

  it("counts a fake-timer helper passed to beforeEach by name", () => {
    const source = [
      "function freezeClock() {",
      "  vi.useFakeTimers();",
      "}",
      "beforeEach(freezeClock);",
      'it("stamps", () => {',
      "  const started = Date.now();",
      "  expect(Date.now() - started).toBe(0);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("still flags a real-timer test beside a fake-timer one", () => {
    const source = [
      'describe("mixed", () => {',
      '  it("fake", () => {',
      "    vi.useFakeTimers();",
      "    const started = Date.now();",
      "    expect(Date.now() - started).toBe(0);",
      "  });",
      '  it("real", async () => {',
      "    const started = Date.now();",
      "    await run();",
      "    expect(Date.now() - started).toBeLessThan(1_000);",
      "  });",
      '  it("switched back", async () => {',
      "    vi.useFakeTimers();",
      "    vi.useRealTimers();",
      "    const started = Date.now();",
      "    expect(Date.now() - started).toBeLessThan(1_000);",
      "  });",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [10, 16]);
  });
});

describe("opt-out", () => {
  it("accepts a reason on the assertion or in the comment block above it", () => {
    const source = [
      "const started = Date.now();",
      "expect(Date.now() - started).toBeLessThan(5_000); // wall-clock-ok: live socket deadline",
      "// wall-clock-ok: the server's idle timeout is real time,",
      "// and nothing in this process can fake it.",
      "expect(Date.now() - started).toBeLessThan(5_000);",
      "/* wall-clock-ok: measured against a real browser frame clock */",
      "expect(Date.now() - started).toBeLessThan(5_000);",
      "expect(Date.now() - started).toBeLessThan(5_000);",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [8]);
  });

  it("finds the comments above from comment ranges, not lines that look like comments", () => {
    const source = [
      'it("waits", async () => {',
      "  const started = Date.now();",
      "  // wall-clock-ok: the browser's frame clock is real time",
      "  await waitFor(() =>",
      "    expect(Date.now() - started).toBeLessThan(5_000),",
      "  );",
      "  const fixture = `",
      "* bullet`; // wall-clock-ok: this comment is about the fixture",
      "  expect(Date.now() - started).toBeLessThan(5_000);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [9]);
  });

  it("rejects a short reason, and pragma text outside a comment", () => {
    const source = [
      "const started = Date.now();",
      "// wall-clock-ok: flaky",
      "expect(Date.now() - started).toBeLessThan(5_000);",
      "const note = 'wall-clock-ok: this string is not a comment';",
      "expect(Date.now() - started).toBeLessThan(5_000);",
    ].join("\n");

    const findings = findWallClockAssertions(FILE, source, allLines(source));
    assert.deepEqual(
      findings.map((finding) => [finding.line, finding.shortReason ?? false]),
      [
        [3, true],
        [5, false],
      ],
    );
  });
});

describe("test file scope", () => {
  it("covers spec and test files in every package", () => {
    for (const rel of [
      "packages/core/src/db/pool-self-deadlock.spec.ts",
      "templates/clips/tests/recording-chapters-scroll.test.ts",
      "templates/content/app/hooks/use-documents.test.tsx",
      "templates/design/e2e/imported-html-export.spec.ts",
      "scripts/qa-deploy-paths-cloud.test.ts",
    ]) {
      assert.equal(isTestFilePath(rel), true, rel);
    }
  });

  it("skips source files and build output", () => {
    for (const rel of [
      "packages/core/src/db/client.ts",
      "packages/core/src/testing/cpu-time.ts",
      "packages/core/dist/db/client.spec.js",
      "templates/content/node_modules/x/a.test.ts",
    ]) {
      assert.equal(isTestFilePath(rel), false, rel);
    }
  });
});

describe("real-time waits", () => {
  it("flags loops that stop on a clock, not loops bounded by the test", () => {
    const source = [
      "async function waitForFile(file, timeoutMs = 5_000) {",
      "  const deadline = Date.now() + timeoutMs;",
      "  while (Date.now() < deadline) {",
      "    if (existsSync(file)) return;",
      "    await new Promise((resolve) => setTimeout(resolve, 10));",
      "  }",
      "  throw new Error(`Timed out waiting for ${file}`);",
      "}",
      "async function waitUntil(predicate, startedAt = performance.now()) {",
      "  while (!predicate()) {",
      "    if (performance.now() - startedAt > 5_000) throw new Error('late');",
      "    await new Promise((resolve) => setTimeout(resolve, 10));",
      "  }",
      "}",
      "async function waitFor(predicate, signal) {",
      "  while (!signal.aborted) {",
      "    if (predicate()) return;",
      "    await new Promise((resolve) => setTimeout(resolve, 10));",
      "  }",
      "  throw new Error('the test timed out first');",
      "}",
    ].join("\n");

    assert.deepEqual(flaggedKinds(source), [
      [3, "real-time deadline loop"],
      [10, "real-time deadline loop"],
    ]);
  });

  it("counts a break as leaving a loop only when it ends that loop", () => {
    const source = [
      "async function drain(queue) {",
      "  while (queue.length > 0) {",
      "    const job = queue.shift();",
      "    switch (job.kind) {",
      "      case 'expiring':",
      "        if (Date.now() > job.expiresAt) break;",
      "        await run(job);",
      "    }",
      "  }",
      "}",
      "async function firstReady(sources) {",
      "  const deadline = Date.now() + 1_000;",
      "  outer: while (true) {",
      "    for (const source of sources) {",
      "      if (Date.now() > deadline) break outer;",
      "      if (await source.ready()) return source;",
      "    }",
      "  }",
      "}",
    ].join("\n");

    assert.deepEqual(flaggedKinds(source), [[13, "real-time deadline loop"]]);
  });

  it("flags a poll that sleeps and gives up after a number of attempts", () => {
    const source = [
      "async function waitForLockWait(minimum) {",
      "  for (let attempt = 0; attempt < 100; attempt += 1) {",
      "    if ((await waitingCount()) >= minimum) return;",
      "    await new Promise((resolve) => setTimeout(resolve, 10));",
      "  }",
      "  throw new Error('no lock wait');",
      "}",
      "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
      "async function waitForSpans() {",
      "  for (let attempt = 0; attempt < 50; attempt++) {",
      "    if (await spans()) return;",
      "    await sleep(20);",
      "  }",
      "  throw new Error('no spans');",
      "}",
      "async function retryRead() {",
      "  for (let attempt = 0; attempt < 3; attempt += 1) {",
      "    const value = await read();",
      "    if (value) return value;",
      "  }",
      "  throw new Error('no value');",
      "}",
    ].join("\n");

    assert.deepEqual(flaggedKinds(source), [
      [2, "poll that gives up after a fixed number of attempts"],
      [10, "poll that gives up after a fixed number of attempts"],
    ]);
  });

  it("flags a poll checked after the loop, not a loop that sleeps between steps", () => {
    const source = [
      "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
      "it('finds the row', async () => {",
      "  let found = false;",
      "  for (let attempt = 0; attempt < 20; attempt++) {",
      "    if (await exists()) { found = true; break; }",
      "    await sleep(50);",
      "  }",
      "  if (!found) throw new Error('no row');",
      "  let attempts = 0;",
      "  let rows = [];",
      "  while (!rows.length && attempts++ < 10) {",
      "    rows = await read();",
      "    await sleep(50);",
      "  }",
      "  expect(rows).toHaveLength(1);",
      "  for (let step = 0; step < 3; step++) {",
      "    await send(step);",
      "    await sleep(10);",
      "  }",
      "  expect(sent).toEqual([0, 1, 2]);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedKinds(source), [
      [4, "poll that gives up after a fixed number of attempts"],
      [11, "poll that gives up after a fixed number of attempts"],
    ]);
    assert.deepEqual(flaggedLines(source, new Set([8, 15])), []);
  });

  it("flags a race against a timer that rejects, not one that paces a poll", () => {
    const source = [
      "it('does not hang', async () => {",
      "  await Promise.race([",
      "    work(),",
      "    new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 5000)),",
      "  ]);",
      "  const timeout = new Promise((_, reject) => setTimeout(reject, 1000));",
      "  await Promise.race([work(), timeout]);",
      "  const pollAgain = new Promise((resolve) => setTimeout(() => resolve(false), 10));",
      "  await Promise.race([finished, pollAgain]);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedKinds(source), [
      [2, "Promise.race against a rejecting timer"],
      [7, "Promise.race against a rejecting timer"],
    ]);
  });

  it("flags Vitest timeouts below the config's defaults", () => {
    const source = [
      "import { test as nodeTest } from 'node:test';",
      "it('boots the database', async () => {",
      "  await boot();",
      "}, 6000);",
      "it('allows more than the default', async () => {",
      "  await boot();",
      "}, 120_000);",
      "test('with options', { timeout: 5_000 }, async () => {});",
      "beforeAll(async () => { await boot(); }, 5_000);",
      "beforeAll(async () => { await boot(); }, 60_000);",
      "it.each([{ timeout: 1 }])('takes rows $timeout', ({ timeout }) => {});",
      "const LIMIT = 2_000;",
      "it('uses a constant', async () => {}, LIMIT);",
      "nodeTest('node:test sets its own', { timeout: 100 }, () => {});",
      "const timeout = 1_000;",
      "it('uses shorthand', { timeout }, async () => {});",
    ].join("\n");

    assert.deepEqual(flaggedKinds(source), [
      [4, "timeout below the config default"],
      [8, "timeout below the config default"],
      [9, "timeout below the config default"],
      [13, "timeout below the config default"],
      [16, "timeout below the config default"],
    ]);
  });

  it("reads each test file's defaults from its nearest vitest config", () => {
    const kinds = (file: string, ms: string) =>
      findWallClockAssertions(
        file,
        `it('boots', async () => {}, ${ms});`,
        null,
      ).map((finding) => finding.kind);
    const short = ["timeout below the config default"];

    assert.deepEqual(
      kinds("templates/content/actions/example.test.ts", "45_000"),
      short,
    );
    assert.deepEqual(
      kinds("templates/slides/server/example.test.ts", "45_000"),
      [],
    );
    assert.deepEqual(
      kinds("packages/dispatch/src/example.test.ts", "20_000"),
      short,
    );
    assert.deepEqual(
      kinds("templates/design/app/example.test.ts", "20_000"),
      short,
    );
    assert.deepEqual(
      kinds("templates/chat/server/example.test.ts", "20_000"),
      [],
    );
  });

  it("follows a config through what it imports, spreads and merges", () => {
    const root = path.resolve(import.meta.dirname, "..");
    mkdirSync(path.join(root, ".tmp"), { recursive: true });
    const dir = mkdtempSync(path.join(root, ".tmp", "wall-clock-configs-"));
    const write = (name: string, source: string) => {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), source);
    };
    const testFile = (config: string) =>
      path.relative(root, path.join(dir, config, "example.test.ts"));
    const source = "it('boots', async () => {}, 20_000);";
    try {
      write("base.ts", "export default { test: { testTimeout: 30_000 } };");
      write("shared.ts", 'export { default } from "./base";');
      write(
        "spread/vitest.config.ts",
        'import base from "../shared";\n' +
          "export default { ...base, test: { ...base.test, include: [] } };",
      );
      write(
        "replaced/vitest.config.ts",
        'import base from "../shared";\n' +
          "export default { ...base, test: { include: [] } };",
      );
      write(
        "unread/vitest.config.ts",
        'import { defineConfig } from "vitest/config";\n' +
          "export default defineConfig(() => ({ test: { testTimeout: 1 } }));",
      );

      assert.deepEqual(
        findWallClockAssertions(testFile("spread"), source, null).map(
          (finding) => finding.kind,
        ),
        ["timeout below the config default"],
      );
      assert.deepEqual(
        findWallClockAssertions(testFile("replaced"), source, null),
        [],
      );
      const guard = path.resolve(
        import.meta.dirname,
        "guard-no-wall-clock-assertions.ts",
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import { findWallClockAssertions } from ${JSON.stringify(pathToFileURL(guard).href)};\n` +
            `findWallClockAssertions(${JSON.stringify(testFile("unread"))}, ${JSON.stringify(source)}, null);`,
        ],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /could not read the testTimeout/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips waits whose clock and timers are faked", () => {
    const source = [
      "it('debounces', async () => {",
      "  vi.useFakeTimers();",
      "  const deadline = Date.now() + 1_000;",
      "  while (Date.now() < deadline) await vi.advanceTimersByTimeAsync(100);",
      "  await Promise.race([work(), new Promise((_, reject) => setTimeout(reject, 50))]);",
      "});",
      "it('fakes Date but not setTimeout', async () => {",
      "  vi.useFakeTimers({ toFake: ['Date'] });",
      "  await Promise.race([work(), new Promise((_, reject) => setTimeout(reject, 50))]);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [9]);
  });

  it("still flags sleeps that fake timers do not replace", () => {
    const source = [
      "import { setTimeout as sleep, scheduler } from 'node:timers/promises';",
      "const tick = () => new Promise((resolve) => setTimeout(resolve, 10));",
      "it('ticks the global timer', async () => {",
      "  vi.useFakeTimers();",
      "  for (let attempt = 0; attempt < 5; attempt++) {",
      "    if (await ready()) return;",
      "    await tick();",
      "  }",
      "  throw new Error('not ready');",
      "});",
      "it('sleeps on node:timers/promises', async () => {",
      "  vi.useFakeTimers();",
      "  for (let attempt = 0; attempt < 5; attempt++) {",
      "    if (await ready()) return;",
      "    await sleep(10);",
      "  }",
      "  throw new Error('not ready');",
      "});",
      "it('waits on the scheduler', async () => {",
      "  vi.useFakeTimers();",
      "  for (let attempt = 0; attempt < 5; attempt++) {",
      "    if (await ready()) return;",
      "    await scheduler.wait(10);",
      "  }",
      "  throw new Error('not ready');",
      "});",
      "it('waits in the browser', async ({ page }) => {",
      "  vi.useFakeTimers();",
      "  for (let attempt = 0; attempt < 5; attempt++) {",
      "    if (await page.isVisible('#done')) return;",
      "    await page.waitForTimeout(10);",
      "  }",
      "  throw new Error('not visible');",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [13, 21, 29]);
  });

  it("reports a wait when its limit changes, and an added call to a helper that waits", () => {
    const source = [
      "async function waitForFile(file, timeoutMs = 5_000) {",
      "  const deadline = Date.now() + timeoutMs;",
      "  while (Date.now() < deadline) {",
      "    if (existsSync(file)) return;",
      "    await new Promise((resolve) => setTimeout(resolve, 10));",
      "  }",
      "  throw new Error('timed out');",
      "}",
      "async function waitForBoth() {",
      "  await waitForFile('a');",
      "  await waitForFile('b');",
      "}",
      "it('waits', async () => {",
      "  await waitForFile('a', 20_000);",
      "  await waitForBoth();",
      "  expect(existsSync('a')).toBe(true);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([1])), [3]);
    assert.deepEqual(flaggedLines(source, new Set([4])), []);
    assert.deepEqual(flaggedLines(source, new Set([14])), [14]);
    assert.deepEqual(flaggedLines(source, new Set([15])), [15]);
    assert.deepEqual(flaggedLines(source, new Set([16])), []);
    assert.deepEqual(flaggedLines(source, null), [3]);
  });

  it("counts a poll's sleep and a race's timer delay as part of its limit", () => {
    const source = [
      "const POLL_MS = 50;",
      "const TIMEOUT_MS = 5_000;",
      "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
      "async function waitForRow() {",
      "  for (let attempt = 0; attempt < 20; attempt++) {",
      "    if (await exists()) return;",
      "    await sleep(POLL_MS);",
      "  }",
      "  throw new Error('no row');",
      "}",
      "it('does not hang', async () => {",
      "  await Promise.race([",
      "    work(),",
      "    new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), TIMEOUT_MS)),",
      "  ]);",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([1])), [5]);
    assert.deepEqual(flaggedLines(source, new Set([3])), [5]);
    assert.deepEqual(flaggedLines(source, new Set([7])), [5]);
    assert.deepEqual(flaggedLines(source, new Set([6])), []);
    assert.deepEqual(flaggedLines(source, new Set([2])), [12]);
  });

  it("lets an opt-out on a helper's wait cover its callers", () => {
    const source = [
      "async function waitForSocket() {",
      "  const deadline = Date.now() + 5_000;",
      "  // wall-clock-ok: the server's idle timeout is real time",
      "  while (Date.now() < deadline) await poll();",
      "}",
      "it('connects', async () => {",
      "  await waitForSocket();",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });
});

describe("guard command", () => {
  it("exits 2, not 0, when it cannot determine the added lines", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "guard-no-wall-clock-assertions.ts"),
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          GUARD_DIFF_BASE: "origin/branch-that-does-not-exist-for-this-test",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /could not determine which lines/);
  });
});
