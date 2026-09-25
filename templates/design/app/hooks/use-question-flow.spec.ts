/**
 * The intake turn is forced to emit only a questionnaire and stop, so the
 * continuation is the turn that actually writes HTML. Anything the user
 * supplied at kickoff — their words, their reference screenshot, their design
 * system — reaches generation only if this builder replays it.
 */

import { describe, expect, it } from "vitest";

import { buildGenerationBriefContext } from "./use-question-flow.js";

const DESIGN_SYSTEM_CONTEXT =
  "## Selected Design System Context\nUse Flo System as the visual source of truth.";

describe("buildGenerationBriefContext", () => {
  it("replays the prompt verbatim rather than paraphrasing it", () => {
    const prompt = "A dark ops console with a left rail and dense data tables.";
    const context = buildGenerationBriefContext({ prompt }, "");
    expect(context).toContain(prompt);
    expect(context).toContain("verbatim");
  });

  it("carries the design system into the generating turn", () => {
    const context = buildGenerationBriefContext(
      { prompt: "Build it", designSystemId: "ds_1" },
      DESIGN_SYSTEM_CONTEXT,
    );
    expect(context).toContain("Flo System");
  });

  it("tells the model an attached screenshot is a layout spec", () => {
    const context = buildGenerationBriefContext(
      { images: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"] },
      "",
    );
    expect(context).toContain("2 reference image(s)");
    expect(context).toContain("layout specification");
  });

  it("keeps extracted text from uploaded specs", () => {
    const context = buildGenerationBriefContext(
      { uploadedFileContext: "Extracted text:\nStep 1. Sign in screen" },
      "",
    );
    expect(context).toContain("Step 1. Sign in screen");
  });

  it("emits nothing when there is no brief, rather than empty scaffolding", () => {
    expect(buildGenerationBriefContext(null, "")).toBe("");
    expect(buildGenerationBriefContext({ prompt: "   " }, "")).toBe("");
  });
});
