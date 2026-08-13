import { describe, expect, it } from "vitest";

import { formatExplorerPropertyLabel } from "./property-label";

describe("formatExplorerPropertyLabel", () => {
  it("renders camelCase property names as readable labels", () => {
    expect(formatExplorerPropertyLabel("modelName")).toBe("Model name");
    expect(formatExplorerPropertyLabel("userId")).toBe("User id");
    expect(formatExplorerPropertyLabel("content_type")).toBe("Content type");
  });

  it("leaves empty values alone", () => {
    expect(formatExplorerPropertyLabel("")).toBe("");
    expect(formatExplorerPropertyLabel("   ")).toBe("   ");
  });
});
