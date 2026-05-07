import { describe, expect, it } from "vitest";
import {
  buildPublicDocumentDescription,
  stripMarkdownForPreview,
} from "./og-description";

describe("Open Graph description helpers", () => {
  it("skips leading headings and strips inline markdown", () => {
    const description = buildPublicDocumentDescription({
      title: "Design System Differentiation & Figma-to-Code Tax",
      content: `### The Figma-to-Code Translation Tax: How to Lean In Without Owning "One-Click Conversion"

**The pain is real and universal.** Across 80 closed/lost deals, the same pattern came up.`,
    });

    expect(description).toBe(
      "The pain is real and universal. Across 80 closed/lost deals, the same pattern came up.",
    );
  });

  it("skips content blocks that only repeat the document title", () => {
    const description = buildPublicDocumentDescription({
      title: "Quarterly Launch Plan",
      content: `# Quarterly Launch Plan

Quarterly Launch Plan

**Launch** work starts with partner interviews and a lightweight beta.`,
    });

    expect(description).toBe(
      "Launch work starts with partner interviews and a lightweight beta.",
    );
  });

  it("removes common markdown syntax without dropping useful text", () => {
    expect(
      stripMarkdownForPreview(
        `1. [Read the brief](https://example.com)
2. **Ship** faster with \`notes\`
3. ![Diagram](https://example.com/image.png)`,
      ),
    ).toBe("Read the brief Ship faster with notes Diagram");
  });

  it("falls back when the content has no body text beyond the title", () => {
    expect(
      buildPublicDocumentDescription({
        title: "Only Title",
        content: "# Only Title",
      }),
    ).toBe("Read this public document in Agent-Native Content.");
  });

  it("truncates descriptions at a word boundary", () => {
    const description = buildPublicDocumentDescription({
      title: "Launch Notes",
      maxLength: 48,
      content:
        "This document walks through positioning, release timing, enablement, and customer follow-up for the launch.",
    });

    expect(description).toBe("This document walks through positioning...");
    expect(description.length).toBeLessThanOrEqual(48);
  });
});
