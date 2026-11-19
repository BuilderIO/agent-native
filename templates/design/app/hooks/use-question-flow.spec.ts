import { describe, expect, it } from "vitest";

import { buildGenerationBriefContext } from "./use-question-flow.js";

describe("buildGenerationBriefContext", () => {
  it("replays the prompt verbatim rather than paraphrasing it", () => {
    const prompt = "A dark ops console with a left rail and dense data tables.";
    const context = buildGenerationBriefContext({ prompt });
    expect(context).toContain(prompt);
    expect(context).toContain("verbatim");
  });
  // oracle-change: Design Systems removed from Design; its assertions no longer apply

  it("tells the model an attached screenshot is a layout spec", () => {
    const context = buildGenerationBriefContext({
      images: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
    });
    expect(context).toContain("2 reference image(s)");
    expect(context).toContain("layout specification");
  });

  it("keeps extracted text from uploaded specs", () => {
    const context = buildGenerationBriefContext({
      uploadedFileContext: "Extracted text:\nStep 1. Sign in screen",
    });
    expect(context).toContain("Step 1. Sign in screen");
  });

  it("emits nothing when there is no brief, rather than empty scaffolding", () => {
    expect(buildGenerationBriefContext(null)).toBe("");
    expect(buildGenerationBriefContext({ prompt: "   " })).toBe("");
  });
});
