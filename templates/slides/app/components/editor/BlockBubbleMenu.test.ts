import { describe, expect, it } from "vitest";

import { buildReviseSelectionPrompt } from "./BlockBubbleMenu";

describe("buildReviseSelectionPrompt", () => {
  it("quotes the selection verbatim so the agent can find it in the slide HTML", () => {
    const prompt = buildReviseSelectionPrompt({
      selectedText: "Breathe cleaner air at home — naturally.",
      instruction: "make it punchier",
      slideId: "slide-42",
    });

    expect(prompt).toContain("Breathe cleaner air at home — naturally.");
    expect(prompt).toContain("How to revise it: make it punchier");
    expect(prompt).toContain("Slide id: `slide-42`");
  });

  it("keeps the edit bounded to the selection", () => {
    const prompt = buildReviseSelectionPrompt({
      selectedText: "Perfect LIGHT for every home",
      instruction: "shorter",
      slideId: "slide-1",
    });

    expect(prompt).toContain("replaces only the quoted text");
    expect(prompt).toContain("update-slide --fullContent");
  });

  it("omits the slide id line when the slide is unknown", () => {
    const prompt = buildReviseSelectionPrompt({
      selectedText: "Some text",
      instruction: "fix grammar",
    });

    expect(prompt).not.toContain("Slide id:");
    expect(prompt).toContain("How to revise it: fix grammar");
  });

  it("preserves multi-line selections", () => {
    const prompt = buildReviseSelectionPrompt({
      selectedText: "Line one\nLine two",
      instruction: "merge into one sentence",
    });

    expect(prompt).toContain("Line one\nLine two");
  });
});
