import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  filterStrictDiagnostics,
  lintBatches,
  oxlintArgs,
} from "./guard-strict-lint.ts";
import {
  WINDOWS_COMMAND_LINE_LIMIT,
  windowsCommandLine,
} from "./lib/pnpm-command.ts";

const cwd = "/repo";
const file = "templates/mail/app/x.ts";
const diag = (code: string | undefined, line: number, filename = file) => ({
  message: `msg ${code}`,
  ...(code ? { code } : {}),
  filename,
  labels: [{ span: { line } }],
});
const out = (...diagnostics: object[]) => JSON.stringify({ diagnostics });
const added = new Map([[path.resolve(cwd, file), new Set([3, 4])]]);

test("reports a strict rule on an added line", () => {
  const r = filterStrictDiagnostics(
    out(diag("typescript(no-floating-promises)", 3)),
    added,
    cwd,
  );
  assert.deepEqual(r, {
    ok: true,
    findings: [
      {
        file,
        line: 3,
        rule: "typescript/no-floating-promises",
        message: "msg typescript(no-floating-promises)",
      },
    ],
  });
});

test("ignores a strict rule on an unchanged line or unchanged file", () => {
  const r = filterStrictDiagnostics(
    out(
      diag("typescript(no-explicit-any)", 10),
      diag("typescript(no-explicit-any)", 3, "other.ts"),
    ),
    added,
    cwd,
  );
  assert.deepEqual(r, { ok: true, findings: [] });
});

test("ignores rules outside the strict set even on added lines", () => {
  const r = filterStrictDiagnostics(
    out(
      diag("eslint(no-unused-vars)", 3),
      diag("typescript(no-base-to-string)", 4),
    ),
    added,
    cwd,
  );
  assert.deepEqual(r, { ok: true, findings: [] });
});

test("malformed JSON is could-not-run, not a pass", () => {
  const r = filterStrictDiagnostics("Failed to parse config", added, cwd);
  assert.equal(r.ok, false);
  assert.equal(filterStrictDiagnostics("{}", added, cwd).ok, false);
});

test("a rule-less diagnostic (syntax error) is could-not-run", () => {
  const r = filterStrictDiagnostics(out(diag(undefined, 3)), added, cwd);
  assert.equal(r.ok, false);
});

test("a strict test run must inspect every selected file", () => {
  for (const number_of_files of [undefined, 0, 1]) {
    assert.equal(
      filterStrictDiagnostics(
        JSON.stringify({ diagnostics: [], number_of_files }),
        added,
        cwd,
        2,
      ).ok,
      false,
    );
  }
  assert.deepEqual(
    filterStrictDiagnostics(
      JSON.stringify({ diagnostics: [], number_of_files: 2 }),
      added,
      cwd,
      2,
    ),
    { ok: true, findings: [] },
  );
});

test("oxlint args deny all seven rules through the repo config", () => {
  const args = oxlintArgs(["a.ts"]);
  assert.equal(args.filter((a) => a === "-D").length, 7);
  assert.ok(args.includes("--type-aware") && args.includes(".oxlintrc.json"));
  assert.equal(args.at(-1), "a.ts");
});

test("lint runs hold 400 files, and fit cmd.exe's command line on Windows", () => {
  const files = Array.from(
    { length: 900 },
    (_, i) => `templates/content/app/components/editor/file-${i}.tsx`,
  );
  assert.deepEqual(
    lintBatches(files, "linux").map((batch) => batch.length),
    [400, 400, 100],
  );

  const windows = lintBatches(files, "win32");
  assert.deepEqual(windows.flat(), files);
  assert.ok(windows.length > 3);
  for (const batch of windows) {
    assert.ok(
      windowsCommandLine(oxlintArgs(batch)).length <=
        WINDOWS_COMMAND_LINE_LIMIT,
    );
  }
});

test("strict test lint reaches ignored spec files and catches malformed or conditional assertions", () => {
  const root = path.resolve(import.meta.dirname, "..");
  mkdirSync(path.join(root, ".tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(root, ".tmp", "strict-test-lint-"));
  const fixture = path.join(dir, "example.spec.ts");
  const source = [
    'import { test, expect } from "vitest";',
    'test("bad assertion", () => {',
    "  const value: any = 1;",
    "  if (value) expect(value).toBe(1);",
    "  expect(value);",
    "});",
    'test("bad assertion", () => { expect(2).toBe(2); });',
    "async function task() { return 1; }",
    'test("dropped promise", () => { task(); expect(1).toBe(1); });',
  ].join("\n");
  try {
    writeFileSync(fixture, source);
    const command = oxlintArgs([fixture], true);
    const run = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules", "oxlint", "bin", "oxlint"),
        ...command.slice(2),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 1, run.stderr);
    const result = filterStrictDiagnostics(
      run.stdout,
      new Map([[fixture, new Set([3, 4, 5, 7, 9])]]),
      root,
      1,
    );
    if (!result.ok) throw new Error(result.reason);
    assert.deepEqual(
      new Set(result.findings.map((finding) => finding.rule)),
      new Set([
        "typescript/no-explicit-any",
        "typescript/no-floating-promises",
        "vitest/no-conditional-expect",
        "vitest/valid-expect",
        "vitest/no-identical-title",
      ]),
    );
    writeFileSync(
      fixture,
      'import { test, expect } from "vitest";\ntest("valid", () => { expect(1).toBe(1); });',
    );
    const valid = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules", "oxlint", "bin", "oxlint"),
        ...command.slice(2),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
