import { describe, expect, it } from "vitest";

import {
  isAgentIncluded,
  presentationSource,
  resolveConnectionPresentation,
  resolveResourceAiUsage,
  type ConnectionAnnotationOverride,
} from "./data-connection-policy.js";

const override = (
  fields: Partial<ConnectionAnnotationOverride>,
): ConnectionAnnotationOverride => ({
  description: "",
  aiUsage: null,
  descriptionInitialized: false,
  aiUsageInitialized: false,
  revision: 1,
  ...fields,
});

describe("canonical connection presentation", () => {
  it("keeps a legacy description through an AI-only annotation", () => {
    const presentation = resolveConnectionPresentation(
      { description: "Legacy warehouse description", includeForAI: true },
      override({ aiUsageInitialized: true, aiUsage: "excluded" }),
    );
    expect(presentation.description).toBe("Legacy warehouse description");
    expect(presentation.effectiveAiUsage).toBe("excluded");
    expect(
      presentationSource(
        { description: "x", includeForAI: true },
        presentation,
      ),
    ).toMatchObject({ description: "legacy", aiUsage: "canonical" });
  });

  it("lets an explicit empty description clear win over legacy", () => {
    const presentation = resolveConnectionPresentation(
      { description: "Legacy", includeForAI: false },
      override({ descriptionInitialized: true, description: "" }),
    );
    expect(presentation.description).toBe("");
  });

  it("preserves legacy true and false before initialization", () => {
    expect(
      resolveConnectionPresentation({ includeForAI: true }, override({}))
        .effectiveAiUsage,
    ).toBe("included");
    expect(
      resolveConnectionPresentation({ includeForAI: false }, override({}))
        .effectiveAiUsage,
    ).toBe("excluded");
  });

  it("defaults a missing legacy AI boolean to excluded, not included", () => {
    const presentation = resolveConnectionPresentation({}, override({}));
    expect(presentation.effectiveAiUsage).toBe("excluded");
    expect(isAgentIncluded(presentation)).toBe(false);
  });

  it("treats an explicit root null as excluded and cannot revive a legacy include", () => {
    const presentation = resolveConnectionPresentation(
      { includeForAI: true },
      override({ aiUsageInitialized: true, aiUsage: null }),
    );
    expect(presentation.effectiveAiUsage).toBe("excluded");
    expect(
      presentationSource({ includeForAI: true }, presentation).aiUsage,
    ).toBe("canonical");
  });

  it("initializes an explicit included policy normally", () => {
    expect(
      resolveConnectionPresentation(
        { includeForAI: false },
        override({ aiUsageInitialized: true, aiUsage: "included" }),
      ).effectiveAiUsage,
    ).toBe("included");
  });

  it("lets children inherit, override, and never overrule an excluded ancestor", () => {
    expect(resolveResourceAiUsage("included", null)).toBe("included");
    expect(resolveResourceAiUsage("included", "excluded")).toBe("excluded");
    expect(resolveResourceAiUsage("included", "included")).toBe("included");
    expect(resolveResourceAiUsage("excluded", "included")).toBe("excluded");
    expect(resolveResourceAiUsage("excluded", null)).toBe("excluded");
  });
});
