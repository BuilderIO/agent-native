import { describe, it, expect } from "vitest";

describe("BuilderSourceStatus state logic", () => {
  function computeState(builder: {
    builderStatus?: string;
    warning?: string;
    docCount?: number;
    docs?: unknown[];
    tokenValues?: Record<string, string>;
  }) {
    const docs = builder.docCount ?? builder.docs?.length ?? 0;
    const tokens = Object.keys(builder.tokenValues ?? {}).length;

    const hasIndexedResults = docs > 0 || tokens > 0;
    return hasIndexedResults
      ? "indexed"
      : builder.warning
        ? "unavailable"
        : "indexing";
  }

  it("shows 'indexed' when docCount > 0 regardless of status (stuck status case)", () => {
    expect(
      computeState({
        builderStatus: "error",
        docCount: 5,
        tokenValues: { color: "#fff" },
      }),
    ).toBe("indexed");
  });

  it("shows 'indexing' when docCount = 0 (no docs, no warning)", () => {
    expect(
      computeState({
        builderStatus: "in-progress",
        docCount: 0,
        tokenValues: {},
      }),
    ).toBe("indexing");
  });

  it("shows 'unavailable' when warning set and docCount = 0", () => {
    expect(
      computeState({
        warning: "Some warning",
        docCount: 0,
        tokenValues: {},
      }),
    ).toBe("unavailable");
  });

  it("shows 'indexed' when warning set but docCount > 0 (docCount takes priority)", () => {
    expect(
      computeState({
        warning: "Some warning",
        docCount: 3,
        tokenValues: {},
      }),
    ).toBe("indexed");
  });

  it("shows 'indexed' when tokenValues present (implicit docCount > 0)", () => {
    expect(
      computeState({
        builderStatus: "in-progress",
        docCount: 0,
        tokenValues: { primary: "#fff" },
      }),
    ).toBe("indexed");
  });
});
