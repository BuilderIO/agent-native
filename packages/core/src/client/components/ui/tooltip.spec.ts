import { describe, expect, it } from "vitest";
import { normalizeTooltipText } from "./tooltip.js";

describe("normalizeTooltipText", () => {
  it("renders escaped shortcut glyphs as readable text", () => {
    expect(normalizeTooltipText("search(\\u2318P)")).toBe("Search (⌘P)");
  });

  it("leaves ordinary tooltip text alone", () => {
    expect(normalizeTooltipText("Chat history")).toBe("Chat history");
  });
});
