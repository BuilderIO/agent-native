import { appendAgentChatContextToMessage } from "@agent-native/core/shared";
import { DESIGN_MUTATION_REQUIRED_DIRECTIVE } from "@shared/mutation-turn";
import { describe, expect, it } from "vitest";

import { designFinalResponseGuard } from "../../../server/lib/design-response-guard";
import {
  designGenerationDirectives,
  designIntakeQuestionDirectives,
  designTemplateRefinementDirectives,
  designVariantGenerationDirectives,
  structuralReferenceDirectives,
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

const NO_COVERAGE: IntakeTopicCoverage = {
  formFactor: false,
  aesthetic: false,
  features: false,
  interactions: false,
  variants: false,
};

describe("designIntakeQuestionDirectives", () => {
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

describe("DESIGN_MUTATION_REQUIRED_DIRECTIVE", () => {
  it("rides on directives that must persist, and never on the intake turn", () => {
    for (const directives of [
      designGenerationDirectives("design-1"),
      designVariantGenerationDirectives("design-1"),
      designTemplateRefinementDirectives("design-1", "template-1"),
    ]) {
      expect(directives).toContain(DESIGN_MUTATION_REQUIRED_DIRECTIVE);
    }
    // The intake turn is told to show questions and stop, so carrying the
    // directive would make the response guard reject its own flow.
    expect(designIntakeQuestionDirectives("design-1")).not.toContain(
      DESIGN_MUTATION_REQUIRED_DIRECTIVE,
    );
  });
});

describe("the intake and generation turns against the response guard", () => {
  const guardContext = (requestText: string) =>
    ({
      messages: [
        { role: "user", content: [{ type: "text", text: requestText }] },
      ],
      requestText,
      assistantContent: [],
      text: "What would you like to design?",
      toolCalls: [],
      toolResults: [],
      retryCount: 0,
      executionMode: "act",
    }) as Parameters<typeof designFinalResponseGuard>[0];

  it("lets the intake turn answer a greeting, and holds the generation turn to a save", () => {
    const intake = appendAgentChatContextToMessage(
      "hi",
      designIntakeQuestionDirectives("design-1").join("\n"),
    );
    const generation = appendAgentChatContextToMessage(
      "hi",
      designGenerationDirectives("design-1").join("\n"),
    );

    expect(designFinalResponseGuard(guardContext(intake))).toBeNull();
    expect(designFinalResponseGuard(guardContext(generation))).not.toBeNull();
  });
});
