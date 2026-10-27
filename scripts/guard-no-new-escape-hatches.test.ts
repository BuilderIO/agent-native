import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import {
  countEscapeHatches,
  isInScope,
  runEscapeHatchGuard,
} from "./guard-no-new-escape-hatches.js";

describe("escape hatch counting", () => {
  it("separates as-any from every other any", () => {
    const counts = countEscapeHatches(
      [
        "const a = x as any;",
        "const b = <any>x;",
        "let c: any;",
        "let d: Record<string, any> = {};",
        "let e: any[] = [];",
      ].join("\n"),
    );
    assert.equal(counts["as-any"], 2);
    assert.equal(counts["any-type"], 3);
  });

  it("counts x! but not !== or a definite-assignment property", () => {
    const counts = countEscapeHatches(
      "const a = x!; const b = y!.z; if (a !== b) {} class C { p!: string }",
    );
    assert.equal(counts["non-null"], 2);
  });

  it("ignores hatches that only appear inside strings, templates, and JSX text", () => {
    const counts = countEscapeHatches(
      [
        'const a = "x as any";',
        'const b = "// @ts-ignore";',
        "const c = `/* eslint-disable */ ${1}`;",
        "const d = <p>// @ts-ignore</p>;",
        "const e = /@ts-ignore/;",
      ].join("\n"),
      "file.tsx",
    );
    for (const kind of Object.keys(counts) as Array<keyof typeof counts>) {
      assert.equal(counts[kind], 0, kind);
    }
  });

  it("counts directives in real comments, including before a closing brace", () => {
    const counts = countEscapeHatches(
      [
        "// @ts-ignore",
        "const a = 1;",
        "/* @ts-expect-error */ const b = 2;",
        "function f() {",
        "  return 1;",
        "  // @ts-ignore",
        "}",
        "// plain prose that mentions @ts-ignore is not a directive",
      ].join("\n"),
    );
    assert.equal(counts["ts-ignore"], 2);
    assert.equal(counts["ts-expect-error"], 1);
  });

  it("counts both eslint-disable and oxlint-disable forms", () => {
    const counts = countEscapeHatches(
      [
        "/* eslint-disable no-console */",
        "// oxlint-disable-next-line no-explicit-any",
        "const a = 1; // eslint-disable-line",
        "/* oxlint-disable */",
      ].join("\n"),
    );
    assert.equal(counts["lint-disable"], 4);
  });

  it("scopes shipped code only", () => {
    for (const file of [
      "packages/core/src/a.ts",
      "templates/mail/app/b.tsx",
      "scripts/c.mts",
    ]) {
      assert.equal(isInScope(file), true, file);
    }
    for (const file of [
      "a.d.ts",
      "a.spec.ts",
      "a.test.tsx",
      "a.test-d.ts",
      "x/__tests__/a.ts",
      "x/e2e/a.ts",
      "x/dist/a.ts",
      "x/node_modules/a.ts",
      "x/.generated/a.ts",
      "prototypes/a.ts",
      "a.js",
    ]) {
      assert.equal(isInScope(file), false, file);
    }
  });
});

describe("escape hatch guard in a repository", () => {
  const roots: string[] = [];
  const diffBaseVariables = ["GUARD_DIFF_BASE", "GITHUB_BASE_REF"] as const;
  let previousDiffBase: Array<[string, string | undefined]>;
  beforeEach(() => {
    previousDiffBase = diffBaseVariables.map((name) => [
      name,
      process.env[name],
    ]);
    delete process.env.GITHUB_BASE_REF;
    process.env.GUARD_DIFF_BASE = "main";
  });
  afterEach(() => {
    for (const [name, value] of previousDiffBase) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]) {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=guard-test",
        "-c",
        "user.email=guard-test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  }

  function write(root: string, relative: string, text: string) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  function repo(files: Record<string, string>) {
    const root = mkdtempSync(path.join(os.tmpdir(), "escape-hatch-guard-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    write(root, "README.md", "base\n");
    for (const [file, text] of Object.entries(files)) write(root, file, text);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "checkout", "-q", "-b", "feature");
    return root;
  }

  const BEFORE = "export const a = (x as any).y;\nexport const b = 1;\n";

  it("fails when an existing file gains an as any", () => {
    const root = repo({ "src/a.ts": BEFORE });
    write(root, "src/a.ts", `${BEFORE}export const c = (x as any).z;\n`);
    git(root, "commit", "-q", "-am", "grow");
    const outcome = runEscapeHatchGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /src\/a\.ts: as-any 1 -> 2/);
    assert.match(outcome.message, /no opt-out pragma/);
  });

  it("fails on growth in one kind even when another kind shrinks", () => {
    const root = repo({ "src/a.ts": "export const a = x!;\n" });
    write(root, "src/a.ts", "export const a = x as any;\n");
    const outcome = runEscapeHatchGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /as-any 0 -> 1/);
  });

  it("passes when a hatch is removed", () => {
    const root = repo({ "src/a.ts": BEFORE });
    write(root, "src/a.ts", "export const a = 1;\n");
    const outcome = runEscapeHatchGuard(root);
    assert.equal(outcome.code, 0);
    assert.match(outcome.message, /OK \(1 changed TypeScript files/);
  });

  it("passes a rename that keeps its hatches", () => {
    const root = repo({ "src/a.ts": BEFORE });
    git(root, "mv", "src/a.ts", "src/renamed.ts");
    git(root, "commit", "-q", "-m", "rename");
    assert.equal(runEscapeHatchGuard(root).code, 0);
  });

  it("fails a new file with a non-null assertion, committed or not", () => {
    const root = repo({ "src/a.ts": BEFORE });
    write(root, "src/new.ts", "export const n = maybe!;\n");
    assert.equal(runEscapeHatchGuard(root).code, 1);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "new");
    assert.equal(runEscapeHatchGuard(root).code, 1);
  });

  it("ignores a new spec file", () => {
    const root = repo({ "src/a.ts": BEFORE });
    write(root, "src/new.spec.ts", "export const n = x as any;\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "spec");
    assert.equal(runEscapeHatchGuard(root).code, 0);
  });

  it("exits 2, not 0, when no base ref resolves", () => {
    const root = repo({ "src/a.ts": BEFORE });
    git(root, "update-ref", "-d", "refs/remotes/origin/main");
    git(root, "branch", "-D", "main");
    delete process.env.GUARD_DIFF_BASE;
    const outcome = runEscapeHatchGuard(root);
    assert.equal(outcome.code, 2);
    assert.match(outcome.message, /git fetch origin main/);
  });
});
