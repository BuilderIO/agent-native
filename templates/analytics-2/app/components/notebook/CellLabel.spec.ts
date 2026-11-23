import { describe, expect, it } from "vitest";

import { cellLabelFromInput } from "./utils";

describe("cellLabelFromInput", () => {
  it("keeps a typed title and trims the edges", () => {
    expect(cellLabelFromInput("  Weekly revenue  ")).toBe("Weekly revenue");
  });

  it("clears the custom title when the field is blank", () => {
    expect(cellLabelFromInput("")).toBeNull();
    expect(cellLabelFromInput("   ")).toBeNull();
  });
});
