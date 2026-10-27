import { describe, expect, it } from "vitest";

import {
  buildDocumentExcerpt,
  buildListRowExcerpt,
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
    // Frontmatter can open with a comment and hold lists.
    expect(
      buildDocumentExcerpt({
        content: "---\n# Metadata\ntags:\n  - news\n---\n\nBody.",
      }),
    ).toBe("Body.");
    // A quoted key can hold a colon.
    expect(
      buildDocumentExcerpt({
        content:
          "---\n\"og:title\": Launch\n'og:type': article\n\n---\n\nBody.",
      }),
    ).toBe("Body.");
    // Text that isn't YAML after a top divider is page text, colon or not.
    expect(
      buildDocumentExcerpt({
        content: "---\nNote: this matters\nand goes on.\n\n---\n\nMore.",
      }),
    ).toBe("Note: this matters and goes on. More.");
    expect(
      buildDocumentExcerpt({
        content: "---\n# Plan\nOwner: Alice\nWe ship in May.\n\n---\n\nMore.",
      }),
    ).toBe("Owner: Alice We ship in May. More.");
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
    expect(
      buildDocumentExcerpt({
        content: "Plan\n---\nWhat we ship.\n\nGoals\n===\nWhat we want.",
      }),
    ).toBe("What we ship. What we want.");
    expect(
      buildDocumentExcerpt({
        content: "What we ship.\n***\nWhat could slip.\n_ _ _\nWhat we cut.",
      }),
    ).toBe("What we ship. What could slip. What we cut.");
    // An underlined heading can run over several lines of text.
    expect(
      buildDocumentExcerpt({
        content: "Plan for the\nautumn launch\n---\nWhat we ship.",
      }),
    ).toBe("What we ship.");
    // Under a list, `---` is a divider, so the list stays.
    expect(
      buildDocumentExcerpt({
        content: "- Write the notes\n---\nWhat we ship.",
      }),
    ).toBe("Write the notes What we ship.");
    expect(buildDocumentExcerpt({ content: "Agenda\n======" })).toBe("Agenda");
  });

  it("leaves out code fences indented up to three spaces", () => {
    const content =
      "Intro.\n\n   ```ts\n   const hidden = 1;\n   ```\n\nAfter.";
    expect(buildDocumentExcerpt({ content })).toBe("Intro. After.");
    expect(
      buildPublicDocumentDescription({
        content: "  ~~~\n  const hidden = 1;\n  ~~~\n\nThe real text.",
      }),
    ).toBe("The real text.");
    // Only a bare fence at least as long as the opening one closes a block.
    for (const block of [
      "```md\n```js\nconst hidden = 1;\n```",
      "````\n```\nconst hidden = 1;\n```\n````",
    ]) {
      expect(
        buildDocumentExcerpt({ content: `Intro.\n\n${block}\n\nAfter.` }),
      ).toBe("Intro. After.");
    }
  });

  it("skips a first paragraph that repeats a title in any script", () => {
    expect(
      buildDocumentExcerpt({
        title: "日本語の題名",
        content: "日本語の題名\n\n本文です。",
      }),
    ).toBe("本文です。");
    // Vowel signs tell these Hindi words apart.
    expect(
      buildDocumentExcerpt({
        title: "दिन",
        content: "दान\n\nFollowing paragraph.",
      }),
    ).toBe("दान Following paragraph.");
    expect(
      buildPublicDocumentDescription({
        title: "दिन",
        content: "दान\n\nFollowing paragraph.",
      }),
    ).toBe("दान");
  });

  it("drops frontmatter whose keys are in any script", () => {
    expect(
      buildDocumentExcerpt({
        content: "---\n作者: Alice\n状态: draft\n---\n\nBody.",
      }),
    ).toBe("Body.");
    expect(
      buildDocumentExcerpt({
        content: "---\n作者: Alice\n状态: draft",
        truncated: true,
      }),
    ).toBe("");
  });

  it("separates headings indented up to three spaces", () => {
    expect(
      buildDocumentExcerpt({
        content: "   # Plan\nWhat we ship.\n\nAnother paragraph.",
      }),
    ).toBe("What we ship. Another paragraph.");
  });

  it("is empty for an empty page or a prefix cut off inside its frontmatter", () => {
    expect(buildDocumentExcerpt({ content: "" })).toBe("");
    expect(buildDocumentExcerpt({ content: "<empty-block/>" })).toBe("");
    for (const content of [
      "---\ntitle: Draft\nstatus: open",
      "---\ntitle: Draft\nsta",
      "---\n# Metadata\ntags:\n  - ne",
      "---\n# Metadata\n# Owner and tags follow",
      '---\ntitle: Draft\n"og:ti',
    ]) {
      expect(buildDocumentExcerpt({ content, truncated: true })).toBe("");
    }
    // Until the prefix shows text that isn't YAML.
    expect(
      buildDocumentExcerpt({
        content: "---\nNote: this matters\n\nThe body goes on.\nAnd on",
        truncated: true,
      }),
    ).toBe("Note: this matters The body goes on. And...");
    // A cut line of prose doesn't count, even one that looks like a key.
    expect(
      buildDocumentExcerpt({
        content: "---\nNote: this matters\nThe body goes on and on",
        truncated: true,
      }),
    ).toBe("Note: this matters The body goes on and...");
    expect(
      buildDocumentExcerpt({
        content: `---\nNote: ${"this matters ".repeat(80)}`,
        truncated: true,
        maxLength: 40,
      }),
    ).toBe("Note: this matters this matters this...");
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
    // A link the cut leaves open keeps its text, whole once its address starts.
    for (const [content, expected] of [
      ["Read the [launch plan](https://exa", "Read the launch plan..."],
      ["Read the [launch pl", "Read the launch..."],
      ["Pick [A or B and go", "Pick A or B and..."],
      ["See ![Hero](https://exa", "See..."],
    ]) {
      expect(
        buildDocumentExcerpt({ content, truncated: true, nextCharacter: "m" }),
      ).toBe(expected);
    }
    // Markup or an opening bracket or quote right before the cut drops out.
    for (const content of ["One two **", "One two (", 'One two "']) {
      expect(buildDocumentExcerpt({ content, truncated: true })).toBe(
        "One two...",
      );
    }
    // The character after the prefix tells whether the last word goes on.
    for (const [nextCharacter, expected] of [
      [" ", "One two three..."],
      [",", "One two three..."],
      ["s", "One two..."],
      ["'", "One two..."],
      ["’", "One two..."],
    ]) {
      expect(
        buildDocumentExcerpt({
          content: "One two three",
          truncated: true,
          nextCharacter,
        }),
      ).toBe(expected);
    }
    // A split word goes with the markup or punctuation in front of it.
    for (const content of [
      "One two **three",
      "One two (three",
      "One two don'",
    ]) {
      expect(buildDocumentExcerpt({ content, truncated: true })).toBe(
        "One two...",
      );
    }
    // Markup the cut leaves open doesn't show.
    for (const [content, expected] of [
      ["One **two three", "One two..."],
      ["One _two three fou", "One two three..."],
    ]) {
      expect(buildDocumentExcerpt({ content, truncated: true })).toBe(expected);
    }
    // Closing markup ends a whole word.
    for (const content of [
      "One two `three`",
      "One two **three**",
      "One two [three](https://example.com)",
    ]) {
      expect(buildDocumentExcerpt({ content, truncated: true })).toBe(
        "One two three...",
      );
    }
  });

  it("keeps cut-off text in scripts written without spaces", () => {
    expect(
      buildDocumentExcerpt({
        content: `# Agenda\n\n${"正文".repeat(495)}`,
        truncated: true,
      }),
    ).toBe(`${"正文".repeat(148)}正...`);
    expect(
      buildDocumentExcerpt({ content: "First.\n\n正文正文", truncated: true }),
    ).toBe("First. 正文正文...");
  });

  it("drops a tag the cut leaves open but keeps a less-than sign in prose", () => {
    expect(
      buildDocumentExcerpt({
        content: "One two three <span cla",
        truncated: true,
      }),
    ).toBe("One two three...");
    expect(
      buildDocumentExcerpt({
        content: "Cost < budget. We can ship ",
        truncated: true,
      }),
    ).toBe("Cost < budget. We can ship...");
  });

  it("falls back to headings when a cut-off body has no other text", () => {
    expect(
      buildDocumentExcerpt({
        content: `# Agenda\n\n${" ".repeat(990)}`,
        truncated: true,
      }),
    ).toBe("Agenda...");
    expect(
      buildDocumentExcerpt({
        content: `# Agenda\n\n\`\`\`js\n${"x".repeat(980)}\n\`\`\``,
        truncated: true,
      }),
    ).toBe("Agenda...");
    expect(buildDocumentExcerpt({ content: "---", truncated: true })).toBe("");
    // Headings lose markup the cut leaves open too, but closed code keeps its
    // characters.
    for (const [content, expected] of [
      ["# Agenda\n## Next **steps for", "Agenda Next steps..."],
      [`# Use \`_id\`\n\n\`\`\`js\n${"x".repeat(990)}`, "Use _id..."],
      ["Use `_id` in queries and mor", "Use _id in queries and..."],
    ]) {
      expect(buildDocumentExcerpt({ content, truncated: true })).toBe(expected);
    }
  });

  it("keeps the ellipsis inside the length limit", () => {
    const excerpt = buildDocumentExcerpt({
      content: `${"界".repeat(300)}${" ".repeat(700)}`,
      truncated: true,
    });
    expect(excerpt).toBe(`${"界".repeat(297)}...`);
  });
});

describe("buildListRowExcerpt", () => {
  it("reads a whole body the way a list read reads its first characters", () => {
    // A code block pads the body so its first 1,000 characters end inside
    // "wordsmith". The sprout is one character but two UTF-16 units.
    const kept = "```\n\n```\n\n\u{1F331} Short ending words";
    const pad = "x".repeat(1000 - Array.from(kept).length);
    const cut = `\`\`\`\n${pad}\n\`\`\`\n\n\u{1F331} Short ending wordsmith here.`;
    const late = `\`\`\`\n${"x".repeat(1000)}\n\`\`\`\n\nText the read never sees.`;
    for (const [content, expected] of [
      [cut, "\u{1F331} Short ending..."],
      [late, ""],
    ]) {
      const prefix = Array.from(content).slice(0, 1001).join("");
      expect(buildListRowExcerpt({ content })).toBe(expected);
      expect(buildListRowExcerpt({ content: prefix })).toBe(expected);
    }
  });

  it("tells a long first frontmatter value from a long first paragraph", () => {
    const value = "word ".repeat(250);
    for (const key of [
      "description",
      "og_description",
      '"og:title"',
      "タイトル",
    ]) {
      expect(
        buildListRowExcerpt({ content: `---\n${key}: ${value}\n---\n\nBody.` }),
      ).toBe("");
    }
    // A capitalized label after a top divider starts prose.
    for (const label of ["Note", "Key takeaway"]) {
      expect(
        buildListRowExcerpt({ content: `---\n${label}: ${value}` }),
      ).toMatch(new RegExp(`^${label}: word word .*\\.\\.\\.$`));
    }
  });
});
