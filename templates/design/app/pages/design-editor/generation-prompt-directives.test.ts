import { appendAgentChatContextToMessage } from "@agent-native/core/shared";
import { DESIGN_MUTATION_REQUIRED_DIRECTIVE } from "@shared/mutation-turn";
import { describe, expect, it } from "vitest";

import {
  agentChatContentFromImages,
  imageAttachmentsFromUploadedFiles,
  MissingVisualImagePayloadError,
} from "@/lib/chat-image-attachments";

import { designFinalResponseGuard } from "../../../server/lib/design-response-guard";
import {
  builderDesignEmbedSubmitData,
  designCanvasIntentDirectives,
  designGenerationDirectives,
  designIntakeQuestionDirectives,
  designTemplateRefinementDirectives,
  designVariantGenerationDirectives,
  structuralReferenceDirectives,
} from "./generation-prompt-directives";
import type { IntakeTopicCoverage } from "./intake-question-topics";

describe("imageAttachmentsFromUploadedFiles", () => {
  it("requires a visual payload for every attached image", () => {
    expect(() =>
      imageAttachmentsFromUploadedFiles([
        { type: "image/png", originalName: "reference.png" },
      ]),
    ).toThrow(MissingVisualImagePayloadError);
  });

  it("returns visual image data and ignores non-image files", () => {
    const image = "data:image/png;base64,AAAA";

    expect(
      imageAttachmentsFromUploadedFiles([
        { type: "image/png", originalName: "reference.png", dataUrl: image },
        { type: "application/pdf", originalName: "brief.pdf" },
      ]),
    ).toEqual([image]);
  });
});

describe("agentChatContentFromImages", () => {
  it("puts image data in MCP content alongside the visible user message", () => {
    expect(
      agentChatContentFromImages("Review this screenshot", [
        "data:IMAGE/JPG;base64,AQID",
      ]),
    ).toEqual([
      { type: "text", text: "Review this screenshot" },
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ]);
  });

  it("rejects image data the host relay cannot deliver", () => {
    expect(() =>
      agentChatContentFromImages("Review this screenshot", [
        "data:image/bmp;base64,AQID",
      ]),
    ).toThrow(MissingVisualImagePayloadError);
  });
});

describe("builderDesignEmbedSubmitData", () => {
  it("includes reference pixels in the host submit envelope", () => {
    const image = "data:IMAGE/JPG;charset=binary;base64,AQID";

    expect(
      builderDesignEmbedSubmitData("Match this screenshot", [image]),
    ).toEqual({
      message: "Match this screenshot",
      submit: true,
      images: [image],
      content: [
        { type: "text", text: "Match this screenshot" },
        { type: "image", data: "AQID", mimeType: "image/jpeg" },
      ],
      context: expect.stringContaining("1 visual reference image(s)"),
    });
  });

  it("keeps text-only host submissions free of image fields", () => {
    expect(builderDesignEmbedSubmitData("Build a calendar", [])).toEqual({
      message: "Build a calendar",
      submit: true,
    });
  });
});

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

  it("treats a fixed artwork request as having answered form factor", () => {
    const text = designIntakeQuestionDirectives(
      "design-1",
      null,
      0,
      undefined,
      "Create a LinkedIn ad",
    ).join("\n");
    expect(text).toContain("form factor is answered");
    expect(text).not.toContain(
      "covering what's genuinely still open: form factor",
    );
  });

  it("uses an attached screenshot as the complete generation brief", () => {
    const intake = designIntakeQuestionDirectives("design-1", null, 1).join(
      "\n",
    );
    const generation = designGenerationDirectives("design-1", null, 1).join(
      "\n",
    );

    expect(intake).toBe(generation);
    expect(generation).toContain("Inspect the actual image pixels");
    expect(generation).toContain("ask the user to attach it again");
    expect(generation).not.toContain("If the user asked to explore variations");
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
    expect(designIntakeQuestionDirectives("design-1")).not.toContain(
      DESIGN_MUTATION_REQUIRED_DIRECTIVE,
    );
  });
});

describe("designCanvasIntentDirectives", () => {
  it("keeps multiple exact-size outputs fixed during client intake", () => {
    expect(
      designCanvasIntentDirectives(
        "Create a 1080x1080 poster and a 1200x628 banner",
      ),
    ).toEqual([
      "The user requested separate exact-size outputs. Generate each output as its own fixed canvas, using its exact dimensions from the request and passing `devices: []`; do not combine them into responsive breakpoints or add mobile variants.",
      "After generating each output, run `take-design-screenshot` once at that output's exact dimensions.",
    ]);
  });

  it("uses one exact-size screenshot for fixed artwork without requested variants", () => {
    const text = designGenerationDirectives(
      "design-1",
      null,
      0,
      "Create a LinkedIn ad",
    ).join("\n");
    expect(text).toContain("LinkedIn Single Image Ad, 1200×627px");
    expect(text).toContain("devices: []");
    expect(text).toContain("widths: [1200] and heights: [627]");
    expect(text).toContain(
      "Capture additional device viewports only when the user requested those variants.",
    );
    expect(text).not.toContain("After responsive app generation");
  });

  it("preserves only device variants the user explicitly requests for artwork", () => {
    const text = designGenerationDirectives(
      "design-1",
      null,
      0,
      "Create a LinkedIn ad with desktop and mobile versions",
    ).join("\n");
    expect(text).toContain(
      "unless the user explicitly asks for device variants",
    );
    expect(text).toContain(
      "preserve exactly the requested devices and add no others",
    );
    expect(text).toContain(
      "Capture additional device viewports only when the user requested those variants.",
    );
  });

  it("keeps responsive screenshots for app UI even when it mentions advertising", () => {
    const text = designGenerationDirectives(
      "design-1",
      null,
      0,
      "Build a Google Ads dashboard",
    ).join("\n");
    expect(text).toContain(
      "Responsive behavior is required for app and website UI",
    );
    expect(text).toContain(
      "take-design-screenshot` at desktop and mobile viewports",
    );
    expect(text).not.toContain("Fixed canvas:");
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
