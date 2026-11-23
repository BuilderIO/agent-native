import { describe, expect, it } from "vitest";

import { addCellOptions } from "./add-cell-options";

describe("add-cell request options", () => {
  it("gives an input cell a renderable parameter type when the toolbar picks none", () => {
    expect(addCellOptions("input", undefined)?.inputType).toBeTruthy();
  });

  it("keeps the parameter type the menu already chose", () => {
    expect(addCellOptions("input", { inputType: "SLIDER" })?.inputType).toBe(
      "SLIDER",
    );
  });

  it("leaves every other kind's options untouched", () => {
    for (const kind of [
      "sql",
      "code",
      "markdown",
      "text",
      "display-table",
    ] as const) {
      expect(addCellOptions(kind, undefined), kind).toBeUndefined();
      expect(addCellOptions(kind, { name: "x" }), kind).toEqual({ name: "x" });
    }
  });
});
