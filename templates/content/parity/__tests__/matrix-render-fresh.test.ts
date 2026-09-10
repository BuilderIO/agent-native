import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderParityMatrixMarkdown } from "../render-matrix";

describe("Content parity matrix generated Markdown", () => {
  it("matches the typed source of truth", () => {
    const committed = readFileSync(
      new URL("../matrix.md", import.meta.url),
      "utf8",
    );

    expect(committed).toBe(renderParityMatrixMarkdown());
  });
});
