// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createVisualEditorExtensions } from "./VisualEditor";

describe("visual editor table resizing", () => {
  it("enables column resizing on inserted tables", () => {
    const table = createVisualEditorExtensions().find(
      (extension) => extension.name === "table",
    );

    expect(table?.options.resizable).toBe(true);
  });
});
