import { describe, expect, it } from "vitest";

import { formatExplorerPropertyLabel } from "./property-label";

describe("formatExplorerPropertyLabel", () => {
  it("renders camelCase property names as readable labels", () => {
    expect(formatExplorerPropertyLabel("modelName")).toBe("Model name");
    expect(formatExplorerPropertyLabel("userId")).toBe("User ID");
    expect(formatExplorerPropertyLabel("content_type")).toBe("Content type");
  });

  it("keeps common technical acronyms recognizable", () => {
    expect(formatExplorerPropertyLabel("URL")).toBe("URL");
    expect(formatExplorerPropertyLabel("utmSource")).toBe("UTM source");
  });

  it("leaves empty values alone", () => {
    expect(formatExplorerPropertyLabel("")).toBe("");
    expect(formatExplorerPropertyLabel("   ")).toBe("   ");
  });
});
