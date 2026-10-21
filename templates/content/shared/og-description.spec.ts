import { describe, expect, it } from "vitest";

import {
  buildDocumentExcerpt,
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

describe("buildDocumentExcerpt", () => {
  it("joins the first paragraphs as plain text, leaving out headings, images, and code", () => {
    expect(
      buildDocumentExcerpt({
        title: "Launch plan",
        content: `# Launch plan

Launch plan

![Hero](https://example.com/hero.png)

**Partners** go first, then a [small beta](https://example.com).

\`\`\`ts
const flag = true;
\`\`\`

- Write the announcement
- Brief support`,
      }),
    ).toBe(
      "Partners go first, then a small beta. Write the announcement Brief support",
    );
  });

  it("uses headings only when the page has nothing else", () => {
    expect(buildDocumentExcerpt({ content: "## Agenda\n\n### Notes" })).toBe(
      "Agenda Notes",
    );
  });

  it("tells frontmatter from a divider at the top of the page", () => {
    expect(
      buildDocumentExcerpt({ content: "---\ntitle: Draft\n---\n\nThe body." }),
    ).toBe("The body.");
    expect(
      buildDocumentExcerpt({
        content: "---\n\nAfter the rule.\n\n---\n\nMore after another.",
      }),
    ).toBe("After the rule. More after another.");
    expect(
      buildDocumentExcerpt({
        content: "---\nFirst paragraph.\n\n---\n\nSecond paragraph.",
      }),
    ).toBe("First paragraph. Second paragraph.");
  });

  it("separates headings and dividers from the text around them", () => {
    expect(
      buildDocumentExcerpt({
        content: "# Plan\nWhat we ship.\n## Risks\n***\nWhat could slip.",
      }),
    ).toBe("What we ship. What could slip.");
    expect(
      buildDocumentExcerpt({ content: "Plan\n---\n\nWhat we ship." }),
    ).toBe("What we ship.");
  });

  it("skips a first paragraph that repeats a title in any script", () => {
    expect(
      buildDocumentExcerpt({
        title: "日本語の題名",
        content: "日本語の題名\n\n本文です。",
      }),
    ).toBe("本文です。");
  });

  it("is empty for an empty page or a prefix cut off inside its frontmatter", () => {
    expect(buildDocumentExcerpt({ content: "" })).toBe("");
    expect(buildDocumentExcerpt({ content: "<empty-block/>" })).toBe("");
    expect(
      buildDocumentExcerpt({
        content: "---\ntitle: Draft\nstatus: open",
        truncated: true,
      }),
    ).toBe("");
  });

  it("ends with an ellipsis when the text stops early", () => {
    expect(
      buildDocumentExcerpt({ content: "One two three fou", truncated: true }),
    ).toBe("One two three...");
    const long = buildDocumentExcerpt({
      content: "word ".repeat(200),
      maxLength: 40,
    });
    expect(long).toMatch(/^word( word)*\.\.\.$/);
    expect(long.length).toBeLessThanOrEqual(40);
  });

  it("drops a word only when the cut splits text the excerpt keeps", () => {
    expect(
      buildDocumentExcerpt({ content: "One two three ", truncated: true }),
    ).toBe("One two three...");
    expect(
      buildDocumentExcerpt({
        content: "One two three.\n\n```ts\nconst hidden =",
        truncated: true,
      }),
    ).toBe("One two three...");
    expect(
      buildDocumentExcerpt({
        content: "Read the [launch plan](https://exa",
        truncated: true,
      }),
    ).toBe("Read the...");
  });

  it("keeps the ellipsis inside the length limit", () => {
    const excerpt = buildDocumentExcerpt({
      content: `${"界".repeat(300)}${" ".repeat(700)}`,
      truncated: true,
    });
    expect(excerpt).toBe(`${"界".repeat(297)}...`);
  });
});
