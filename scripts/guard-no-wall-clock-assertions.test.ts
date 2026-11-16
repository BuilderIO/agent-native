import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findWallClockAssertions,
  isTestFilePath,
} from "./guard-no-wall-clock-assertions.ts";

const FILE = "packages/core/src/db/example.spec.ts";

function allLines(source: string): Set<number> {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function flaggedLines(source: string, added = allLines(source)): number[] {
  return findWallClockAssertions(FILE, source, added).map(
    (finding) => finding.line,
  );
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

  it("only reports assertions this branch touched, at the first line", () => {
    const source = [
      "const startedAt = Date.now();",
      "expect(Date.now() - startedAt).toBeLessThan(1_000);",
      "expect(",
      "  Date.now() - startedAt,",
      ").toBeLessThan(2_000);",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([4])), [3]);
    assert.deepEqual(flaggedLines(source, new Set([1])), []);
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
