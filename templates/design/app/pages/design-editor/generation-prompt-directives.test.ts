import { describe, expect, it } from "vitest";

import {
  designTemplateRefinementDirectives,
  structuralReferenceDirectives,
} from "./generation-prompt-directives";

describe("designTemplateRefinementDirectives", () => {
  it("uses copy-first editing instructions without a positive fresh-generation directive", () => {
    const directives = designTemplateRefinementDirectives(
      "design-1",
      "template-1",
      "system-1",
    );
    const text = directives.join("\n");

    expect(text).toContain("get-design-snapshot");
    expect(text).toContain("edit-design");
    expect(text).toContain("import-from-url");
    expect(text).toContain("Do not call `generate-design`");
    expect(text).not.toContain("When calling `generate-design`");
    expect(text).not.toContain("Use the `generate-design");
  });
});

describe("structuralReferenceDirectives", () => {
  it("leaves the reference-or-edit call to the agent instead of asserting it", () => {
    const text = structuralReferenceDirectives("Pricing card").join("\n");

    expect(text).toContain("Pricing card");
    expect(text).toContain("modeled after, similar to, or based on");
    expect(text).toContain("read the real colors, spacing, typography");
    expect(text).toContain("literal values");
    expect(text).toContain("ignore this reference framing");
    // Never states outright that the selection IS a reference — that would
    // hijack an ordinary "make this bigger" edit request into a rebuild.
    expect(text).not.toMatch(/is a reference|tagged as a reference/i);
  });
});
