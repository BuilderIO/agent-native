import { describe, expect, it } from "vitest";

// @ts-expect-error - .mjs helper without types
import { parseUnifiedDiff } from "./changed-lines.mjs";

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
    expect(result?.get(`${CWD}/src/a.ts`)).toEqual(new Set([3]));
  });

  // A single NUL byte makes git call a .ts file binary. Git then emits no
  // +++/@@/+ lines for it, so every diff-scoped guard would inspect nothing and
  // report a pass over a file it never read.
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
    expect(result?.get(`${CWD}/src/a.ts`)).toEqual(new Set([1]));
  });
});
