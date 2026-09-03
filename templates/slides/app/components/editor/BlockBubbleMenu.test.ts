import { describe, expect, it } from "vitest";

import { buildReviseSelectionContext } from "./BlockBubbleMenu";

describe("buildReviseSelectionContext", () => {
  it("quotes the selection verbatim so the agent can find it in the slide HTML", () => {
    const prompt = buildReviseSelectionContext({
      selectedText: "Breathe cleaner air at home — naturally.",
      instruction: "make it punchier",
      slideId: "slide-42",
    });

    expect(prompt).toContain("Breathe cleaner air at home — naturally.");
    expect(prompt).toContain("How to revise it: make it punchier");
    expect(prompt).toContain("Slide id: `slide-42`");
  });

  it("keeps the edit bounded to the selection", () => {
    const prompt = buildReviseSelectionContext({
      selectedText: "Perfect LIGHT for every home",
      instruction: "shorter",
      slideId: "slide-1",
    });

    expect(prompt).toContain("using the quoted text as `find`");
    expect(prompt).toContain(
      "update-slide` once with one `edits` literal replacement",
    );
    expect(prompt).toContain("expectedMatches: 1");
    expect(prompt).not.toContain("update-slide --fullContent");
  });

  it("omits the slide id line when the slide is unknown", () => {
    const prompt = buildReviseSelectionContext({
      selectedText: "Some text",
      instruction: "fix grammar",
    });

    expect(prompt).not.toContain("Slide id:");
    expect(prompt).toContain("How to revise it: fix grammar");
  });

  it("preserves multi-line selections", () => {
    const prompt = buildReviseSelectionContext({
      selectedText: "Line one\nLine two",
      instruction: "merge into one sentence",
    });

    expect(prompt).toContain("Line one\nLine two");
  });
});
