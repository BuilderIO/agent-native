import { describe, expect, it } from "vitest";

import {
  applySourceContentPatch,
  applySourceEdit,
  normalizeInlineSourcePath,
  previewSourceDiff,
  sourceContentHash,
  sourceContentPatch,
} from "./source-workspace";

describe("source workspace helpers", () => {
  it("normalizes inline source paths and rejects traversal", () => {
    expect(normalizeInlineSourcePath("/index.html")).toBe("index.html");
    expect(() => normalizeInlineSourcePath("../index.html")).toThrow(
      /invalid source path/i,
    );
  });

  it("applies full replacement edits", () => {
    const result = applySourceEdit("<h1>Before</h1>", {
      kind: "full-replace",
      content: "<h1>After</h1>",
    });

    expect(result).toEqual({
      content: "<h1>After</h1>",
      changed: true,
      editsApplied: 1,
    });
  });

  it("requires exact replacement searches to be unique", () => {
    expect(() =>
      applySourceEdit("<p>A</p><p>A</p>", {
        kind: "exact-replace",
        search: "<p>A</p>",
        replace: "<p>B</p>",
      }),
    ).toThrow(/more than once/i);
  });

  it("reports compact diff metadata", () => {
    const before = "<html>\n<body>\n<h1>Before</h1>\n</body>\n</html>";
    const after = "<html>\n<body>\n<h1>After</h1>\n</body>\n</html>";
    const diff = previewSourceDiff(before, after);

    expect(diff.changed).toBe(true);
    expect(diff.lineStart).toBe(3);
    expect(diff.bytesBefore).toBe(before.length);
    expect(diff.bytesAfter).toBe(after.length);
  });

  it("patches carry only the changed span and rebuild the exact document", () => {
    const base = `<main>${"x".repeat(5000)}<h1>Before</h1>${"y".repeat(5000)}</main>`;
    const next = base.replace("Before", "After");
    const patch = sourceContentPatch(base, next);

    expect(patch.text.length).toBeLessThan(10);
    expect(patch.resultHash).toBe(sourceContentHash(next));
    expect(applySourceContentPatch(base, patch)).toBe(next);
  });

  it("patches rebuild documents whose change overlaps a repeated prefix or suffix", () => {
    for (const [base, next] of [
      ["aaa", "aa"],
      ["aa", "aaa"],
      ["abcabc", "abc"],
      ["", "<p>new</p>"],
      ["<p>old</p>", ""],
      ["same", "same"],
    ] as const) {
      expect(
        applySourceContentPatch(base, sourceContentPatch(base, next)),
      ).toBe(next);
    }
  });

  it("hashes content with length included", () => {
    expect(sourceContentHash("abc")).toMatch(/^3:/);
    expect(sourceContentHash("abc")).toBe(sourceContentHash("abc"));
    expect(sourceContentHash("abc")).not.toBe(sourceContentHash("abcd"));
  });
});
