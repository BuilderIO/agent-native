import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error - .mjs helper without types
import { parseRemovedLines, parseUnifiedDiff } from "./changed-lines.mjs";

const CWD = "/repo";

describe("parseUnifiedDiff", () => {
  it("collects added line numbers per file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +3 @@",
      "+const x = 1;",
    ].join("\n");

    const result = parseUnifiedDiff(diff, CWD);
    expect(result?.get(path.resolve(CWD, "src/a.ts"))).toEqual(new Set([3]));
  });

  it("keys files so a Windows path.join lookup finds them", () => {
    const diff = [
      "diff --git a/templates/app/en.ts b/templates/app/en.ts",
      "+++ b/templates/app/en.ts",
      "@@ -0,0 +1 @@",
      "+export const en = {};",
    ].join("\n");

    const cwd = "C:\\repo";
    const result = parseUnifiedDiff(diff, cwd, path.win32);
    expect(
      result?.get(path.win32.join(cwd, "templates", "app", "en.ts")),
    ).toEqual(new Set([1]));
  });

  it("leaves prototypes out of the added lines", () => {
    const diff = [
      "diff --git a/prototypes/kit/ui.ts b/prototypes/kit/ui.ts",
      "+++ b/prototypes/kit/ui.ts",
      "@@ -0,0 +1 @@",
      "+} catch {}",
      "diff --git a/src/a.ts b/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +2 @@",
      "+const x = 1;",
    ].join("\n");

    const result = parseUnifiedDiff(diff, CWD);
    expect([...(result?.keys() ?? [])]).toEqual([
      path.resolve(CWD, "src/a.ts"),
    ]);
  });

  it("refuses to scope when a source file diffs as binary", () => {
    const diff = "Binary files a/src/a.ts and b/src/a.ts differ";
    expect(parseUnifiedDiff(diff, CWD)).toBeNull();
  });

  it("refuses even when the binary file is one of several", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +1 @@",
      "+const x = 1;",
      "diff --git a/src/b.tsx b/src/b.tsx",
      "Binary files a/src/b.tsx and b/src/b.tsx differ",
    ].join("\n");

    expect(parseUnifiedDiff(diff, CWD)).toBeNull();
  });

  it("still scopes when the binary file is a genuine asset", () => {
    const diff = [
      "diff --git a/img/logo.png b/img/logo.png",
      "Binary files a/img/logo.png and b/img/logo.png differ",
      "diff --git a/src/a.ts b/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +1 @@",
      "+const x = 1;",
    ].join("\n");

    const result = parseUnifiedDiff(diff, CWD);
    expect(result).not.toBeNull();
    expect(result?.get(path.resolve(CWD, "src/a.ts"))).toEqual(new Set([1]));
  });

  // Inside a hunk the header's counts decide what is body, so an added line
  // whose text begins with "++" never reads as a header or drops out.
  it("counts added lines whose text starts with ++ or +++ as body", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +1,4 @@",
      "+const a = 1;",
      "+++i;",
      "++++x",
      "+const b = 2;",
    ].join("\n");

    const result = parseUnifiedDiff(diff, CWD);
    expect(result?.get(path.resolve(CWD, "src/a.ts"))).toEqual(
      new Set([1, 2, 3, 4]),
    );
  });

  it("does not read an added line like '++ x' as a new file header", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +1,2 @@",
      "+++ x",
      "+const b = 2;",
    ].join("\n");

    const result = parseUnifiedDiff(diff, CWD);
    expect([...(result?.keys() ?? [])]).toEqual([
      path.resolve(CWD, "src/a.ts"),
    ]);
    expect(result?.get(path.resolve(CWD, "src/a.ts"))).toEqual(new Set([1, 2]));
  });

  it("keeps removed lines whose text starts with -- in the hunk", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,2 @@",
      "---y",
      "----z",
      "-const c = 3;",
      "+const d = 4;",
      "+const e = 5;",
    ].join("\n");

    const added = parseUnifiedDiff(diff, CWD);
    expect(added?.get(path.resolve(CWD, "src/a.ts"))).toEqual(new Set([1, 2]));

    const removed = parseRemovedLines(diff, CWD);
    expect(
      removed
        ?.get(path.resolve(CWD, "src/a.ts"))
        .lines.map((line: { text: string }) => line.text),
    ).toEqual(["--y", "---z", "const c = 3;"]);
  });

  it("keeps line numbers across hunks and files in a normal diff", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2 +2,2 @@",
      "-old",
      "+new one",
      "+new two",
      "@@ -9,0 +11 @@",
      "+appended",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+x",
    ].join("\n");

    const result = parseUnifiedDiff(diff, CWD);
    expect(result?.get(path.resolve(CWD, "src/a.ts"))).toEqual(
      new Set([2, 3, 11]),
    );
    expect(result?.get(path.resolve(CWD, "src/b.ts"))).toEqual(new Set([1]));
  });

  it("marks a file created on the branch and a file deleted from it", () => {
    const diff = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+const n = 1;",
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-const o = 1;",
    ].join("\n");

    const removed = parseRemovedLines(diff, CWD);
    expect(removed?.get(path.resolve(CWD, "src/new.ts"))).toMatchObject({
      path: "src/new.ts",
      created: true,
      deleted: false,
    });
    expect(removed?.get(path.resolve(CWD, "src/old.ts"))).toMatchObject({
      path: "src/old.ts",
      created: false,
      deleted: true,
    });
  });
});

describe("git-quoted paths", () => {
  it("parses a non-ASCII path that git leaves unquoted under core.quotePath=false", () => {
    const diff = [
      "diff --git a/café.spec.ts b/café.spec.ts",
      "--- a/café.spec.ts",
      "+++ b/café.spec.ts",
      "@@ -0,0 +1 @@",
      "+it('x', () => {});",
    ].join("\n");

    expect(
      parseUnifiedDiff(diff, CWD)?.get(path.resolve(CWD, "café.spec.ts")),
    ).toEqual(new Set([1]));
    expect(
      parseRemovedLines(diff, CWD)?.get(path.resolve(CWD, "café.spec.ts")),
    ).toMatchObject({
      path: "café.spec.ts",
    });
  });

  it("fails closed on a quoted header in both parsers", () => {
    const diff = [
      'diff --git "a/q\\"x.spec.ts" "b/q\\"x.spec.ts"',
      '--- "a/q\\"x.spec.ts"',
      '+++ "b/q\\"x.spec.ts"',
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    expect(parseUnifiedDiff(diff, CWD)).toBeNull();
    expect(parseRemovedLines(diff, CWD)).toBeNull();
  });

  it("fails closed on a deleted file whose quoted name appears only on the --- line", () => {
    const diff = [
      'diff --git "a/tab\\tx.ts" "b/tab\\tx.ts"',
      "deleted file mode 100644",
      '--- "a/tab\\tx.ts"',
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-const o = 1;",
    ].join("\n");

    expect(parseUnifiedDiff(diff, CWD)).toBeNull();
    expect(parseRemovedLines(diff, CWD)).toBeNull();
  });

  it("fails closed on a quoted binary file, whose extension cannot be read", () => {
    const diff = 'Binary files "a/q\\"x.ts" and "b/q\\"x.ts" differ';
    expect(parseUnifiedDiff(diff, CWD)).toBeNull();
  });
});
