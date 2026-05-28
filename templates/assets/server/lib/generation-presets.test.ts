import { describe, expect, it } from "vitest";
import { applyPromptTemplate } from "./generation-presets.js";

describe("applyPromptTemplate", () => {
  it("replaces prompt placeholders", () => {
    expect(
      applyPromptTemplate(
        "Create a social image about {{prompt}}.",
        "launch day",
      ),
    ).toBe("Create a social image about launch day.");
  });

  it("appends the user request when no placeholder is present", () => {
    expect(applyPromptTemplate("Create a blog hero.", "edge caching")).toBe(
      "Create a blog hero.\n\nUser request:\nedge caching",
    );
  });
});
