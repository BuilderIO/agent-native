import { describe, expect, it } from "vitest";

import {
  designIntakeQuestionDirectives,
  designTemplateRefinementDirectives,
} from "./generation-prompt-directives";
import type { IntakeTopicCoverage } from "./intake-question-topics";

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
    expect(text).toContain("Do not call `generate-design`");
    expect(text).not.toContain("When calling `generate-design`");
    expect(text).not.toContain("Use the `generate-design");
  });
});

const NO_COVERAGE: IntakeTopicCoverage = {
  formFactor: false,
  aesthetic: false,
  features: false,
  interactions: false,
  variants: false,
};

describe("designIntakeQuestionDirectives", () => {
  it("asks about every topic when nothing is passed (no context signal)", () => {
    const text = designIntakeQuestionDirectives("design-1").join("\n");
    expect(text).toContain("form factor");
    expect(text).toContain("aesthetic direction");
    expect(text).toContain("important features/content");
    expect(text).toContain("special interactions/polish");
    expect(text).toContain("whether to explore variations");
    expect(text).not.toContain("already answers");
  });

  it("asks about every topic when coverage is explicitly all-false", () => {
    const text = designIntakeQuestionDirectives("design-1", null, 0, {
      coverage: NO_COVERAGE,
    }).join("\n");
    expect(text).toContain("form factor");
    expect(text).toContain("aesthetic direction");
    expect(text).toContain("important features/content");
    expect(text).toContain("special interactions/polish");
    expect(text).toContain("whether to explore variations");
    expect(text).not.toContain("already answers");
  });

  it("omits only the covered topic (aesthetic) and still asks the rest", () => {
    const text = designIntakeQuestionDirectives("design-1", null, 0, {
      coverage: { ...NO_COVERAGE, aesthetic: true },
    }).join("\n");
    expect(text).toContain("already answers: aesthetic direction");
    expect(text).toContain(
      "covering what's genuinely still open: form factor, important features/content, special interactions/polish, whether to explore variations",
    );
    expect(text).not.toContain("still open: form factor, aesthetic direction");
  });

  it("surfaces an unavailable Creative Context lookup distinctly, not as silent no-context", () => {
    const text = designIntakeQuestionDirectives("design-1", null, 0, {
      coverage: NO_COVERAGE,
      contextUnavailable: true,
      unavailableReason: "context service down",
    }).join("\n");
    expect(text).toContain("could not be checked");
    expect(text).toContain("context service down");
    expect(text).toContain('not treat it as "nothing saved"');
  });
});
