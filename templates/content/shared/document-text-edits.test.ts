import { describe, expect, it } from "vitest";

import {
  applyDocumentTextEdits,
  parseDocumentTextEditsJson,
  resolveDocumentTextEdits,
} from "./document-text-edits.js";

describe("parseDocumentTextEditsJson", () => {
  it("rejects non-string fields in JSON edit batches", () => {
    expect(() =>
      parseDocumentTextEditsJson('[{"find":42,"replace":"valid"}]'),
    ).toThrow("non-empty string 'find'");
    expect(() =>
      parseDocumentTextEditsJson('[{"find":"alpha","replace":42}]'),
    ).toThrow("string 'replace'");
  });
});

describe("applyDocumentTextEdits", () => {
  it("applies bounded edits without rebuilding surrounding MDX", () => {
    const source = [
      "# Original publishing workflow",
      "",
      "| Step | Owner |",
      "| --- | --- |",
      "| Draft | Alice |",
      "",
      "<Aside>Keep this component.</Aside>",
    ].join("\n");

    const result = applyDocumentTextEdits(source, [
      { find: "Original publishing workflow", replace: "Publishing workflow" },
    ]);

    expect(result.changeCount).toBe(1);
    expect(result.content).toBe(
      source.replace("Original publishing workflow", "Publishing workflow"),
    );
  });
});

describe("resolveDocumentTextEdits", () => {
  it("resolves every match against the immutable base so replacements cannot cascade", () => {
    expect(
      resolveDocumentTextEdits("alpha beta", [
        { find: "alpha", replace: "beta" },
        { find: "beta", replace: "gamma" },
      ]),
    ).toMatchObject({ ok: true, content: "beta gamma" });
  });

  it("rejects missing and ambiguous matches without returning partial content", () => {
    expect(
      resolveDocumentTextEdits("one two", [{ find: "three", replace: "x" }]),
    ).toEqual({
      ok: false,
      error: { kind: "missing", editIndex: 0, find: "three" },
    });
    expect(
      resolveDocumentTextEdits("one one", [{ find: "one", replace: "x" }]),
    ).toEqual({
      ok: false,
      error: { kind: "ambiguous", editIndex: 0, find: "one", matches: 2 },
    });
  });

  it("rejects overlapping base ranges", () => {
    expect(
      resolveDocumentTextEdits("abcdef", [
        { find: "abcd", replace: "x" },
        { find: "cdef", replace: "y" },
      ]),
    ).toEqual({
      ok: false,
      error: { kind: "overlapping", editIndexes: [0, 1] },
    });
  });
});
