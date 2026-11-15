import { describe, expect, it } from "vitest";

import { parseMemoryIndex } from "./memory-index.js";

describe("memory index parsing", () => {
  it("accepts local markdown links and rejects traversal and nested paths", () => {
    expect(
      parseMemoryIndex(
        [
          "- [A](a.md) — description",
          "- [B](memory/b.md) - second",
          "- [Traversal](../private.md) — bad",
          "- [Nested](other/x.md) — bad",
          "- [Windows](other\\\\x.md) — bad",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "A", path: "memory/a.md", description: "description" },
      { name: "B", path: "memory/b.md", description: "second" },
    ]);
  });
  it("resolves links relative to the supplied index directory", () => {
    expect(
      parseMemoryIndex("- [A](a.md) — description", "notes/index.md"),
    ).toEqual([{ name: "A", path: "notes/a.md", description: "description" }]);
  });
});
