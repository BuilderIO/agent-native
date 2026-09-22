import { describe, expect, it } from "vitest";

import {
  actionPreparationContinuationNote,
  incrementalActionGuidance,
} from "./action-continuation-guidance.js";

describe("Plan action continuation guidance", () => {
  it("keeps live plan recovery on targeted update patches", () => {
    const guidance = incrementalActionGuidance("update-visual-plan");
    const note = actionPreparationContinuationNote("update-visual-plan");

    expect(guidance).toContain("update-visual-plan");
    expect(guidance).toContain("contentPatches");
    expect(guidance).not.toContain("patch-visual-plan-source");
    expect(note).toContain("contentPatches");
    expect(note).not.toContain("patch-visual-plan-source");
  });

  it("keeps exported source recovery on targeted MDX patches", () => {
    const guidance = incrementalActionGuidance("patch-visual-plan-source");

    expect(guidance).toContain("patch-visual-plan-source");
    expect(guidance).toContain("MDX AST");
    expect(guidance).toContain("replace-file");
    expect(guidance).not.toContain("update-visual-plan");
  });
});
