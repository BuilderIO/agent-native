import { describe, expect, it } from "vitest";

import {
  VERIFICATION_EXCERPT_CHARS,
  summarizeVerification,
} from "./pull-request-evidence.js";

const SENTENCE = "Ran the sorting spec and it passed.";

describe("summarizeVerification", () => {
  it("reads a missing, empty or heading-less body as absent, never as an error", () => {
    const absent = { present: false, hasMedia: false, excerpt: "" };

    expect(summarizeVerification(null)).toEqual(absent);
    expect(summarizeVerification(undefined)).toEqual(absent);
    expect(summarizeVerification("")).toEqual(absent);
    expect(summarizeVerification(`### Summary\n${SENTENCE}`)).toEqual(absent);
  });

  it("finds the heading at levels two to four, in any case, with an optional colon", () => {
    for (const heading of [
      "## Verified",
      "### Verified",
      "#### Verified",
      "### verified",
      "### VERIFIED",
      "### Verified:",
      "### Verified ###",
      "   ### Verified",
    ]) {
      expect(
        summarizeVerification(`${heading}\n${SENTENCE}`),
        heading,
      ).toMatchObject({ present: true, excerpt: SENTENCE });
    }
  });

  it("does not take a look-alike for the heading", () => {
    for (const heading of [
      "# Verified",
      "##### Verified",
      "###Verified",
      "### Verified by hand",
      "### Unverified",
      "**Verified**",
      "Verified",
      "    ### Verified",
    ]) {
      expect(
        summarizeVerification(`${heading}\n${SENTENCE}`),
        heading,
      ).toMatchObject({ present: false, excerpt: "" });
    }
  });

  it("ends the section at the next heading of the same or a higher level, and keeps a lower one", () => {
    const body = [
      "### Verified",
      SENTENCE,
      "#### Before and after",
      "The error is now one line.",
      "### Notes",
      "Nothing here counts as evidence.",
    ].join("\n");

    const result = summarizeVerification(body);

    expect(result.excerpt).toBe(
      `${SENTENCE} #### Before and after The error is now one line.`,
    );
    expect(
      summarizeVerification(
        `#### Verified\n${SENTENCE}\n## Next\nOutside the section.`,
      ).excerpt,
    ).toBe(SENTENCE);
    expect(
      summarizeVerification(`## Verified\n${SENTENCE}\n# Top\nOutside.`)
        .excerpt,
    ).toBe(SENTENCE);
  });

  it("ends the section at Builder's screenshots end marker, even on the same line", () => {
    const body = [
      "<!-- FUSION_SCREENSHOTS_START -->",
      "### Verified",
      SENTENCE,
      "<!-- FUSION_SCREENSHOTS_END -->",
      "The footer is not evidence of anything at all.",
    ].join("\n");
    const sameLine = `### Verified\n${SENTENCE}<!--FUSION_SCREENSHOTS_END -->\nTrailing text that is long enough.`;

    expect(summarizeVerification(body).excerpt).toBe(SENTENCE);
    expect(summarizeVerification(sameLine).excerpt).toBe(SENTENCE);
  });

  it("ends the section at a horizontal rule, so a bare heading does not borrow the boilerplate below it", () => {
    const bare = [
      "### Verified",
      "",
      "---",
      "",
      "To clone this PR locally use the GitHub CLI with the command below.",
    ].join("\n");

    expect(summarizeVerification(bare)).toEqual({
      present: false,
      hasMedia: false,
      excerpt: "",
    });
    expect(
      summarizeVerification(
        `### Verified\n${SENTENCE}\n\n---\n\nTo clone this PR locally.`,
      ).excerpt,
    ).toBe(SENTENCE);
  });

  it("needs at least 20 characters of text, or media, under the heading", () => {
    const text = (length: number) => "x".repeat(length);

    expect(summarizeVerification(`### Verified\n${text(19)}`)).toMatchObject({
      present: false,
      excerpt: text(19),
    });
    expect(summarizeVerification(`### Verified\n${text(20)}`)).toMatchObject({
      present: true,
    });
    expect(summarizeVerification("### Verified\n\n\n")).toMatchObject({
      present: false,
    });
  });

  it("counts a screenshot or recording with no text as evidence", () => {
    for (const media of [
      '<img src="https://cdn.example.test/a.webp" alt="" />',
      "![](https://cdn.example.test/a.png)",
      '<video src="https://cdn.example.test/a"></video>',
      "https://cdn.example.test/run.mp4",
      "https://cdn.example.test/RUN.WEBM?token=1",
      "[play](https://www.builder.io/app/timelines/abc123)",
      "https://www.loom.com/share/abc123",
      "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000",
    ]) {
      const result = summarizeVerification(`### Verified\n\n${media}\n`);
      expect(result, media).toMatchObject({ present: true, hasMedia: true });
    }
  });

  it("does not call a plain link to a page a recording", () => {
    const result = summarizeVerification(
      `### Verified\n${SENTENCE} See https://example.test/docs for the setup.`,
    );

    expect(result).toMatchObject({ present: true, hasMedia: false });
  });

  it("reports text-only evidence without media", () => {
    expect(summarizeVerification(`### Verified\n${SENTENCE}`)).toEqual({
      present: true,
      hasMedia: false,
      excerpt: SENTENCE,
    });
  });

  it("strips HTML and URLs from the excerpt and keeps what a person would read", () => {
    const body = [
      "### Verified",
      "<!-- internal note -->",
      "[Watch the run](https://www.builder.io/app/timelines/abc123)",
      "**After: the error names the file**",
      '<img src="https://cdn.example.test/a.webp" alt="After: the chip shows" />',
      "![before the fix](https://cdn.example.test/b.png)",
      "| Before | After |",
      "| --- | --- |",
      "|  |  |",
      "Bare https://cdn.example.test/c.png link and it&#039;s &amp; done&nbsp;ok",
    ].join("\n");

    const { excerpt, hasMedia } = summarizeVerification(body);

    expect(hasMedia).toBe(true);
    expect(excerpt).toBe(
      "Watch the run **After: the error names the file** before the fix | Before | After | Bare link and it's & done ok",
    );
    expect(excerpt).not.toMatch(/https?:|<|internal note/);
  });

  it("decodes the entities Builder's tooling writes and drops control characters", () => {
    const { excerpt } = summarizeVerification(
      "### Verified\nIt&#39;s fine, it&#039;s done &amp; checked &quot;twice&quot;&#8217;s&#0;end&nbsp;ok",
    );

    expect(excerpt).toBe(
      "It's fine, it's done & checked \"twice\"\u2019s end ok",
    );
  });

  it("clips the excerpt to its bound, marks the cut, and never reaches outside the section", () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const body = `Intro that stays out.\n### Verified\n${long}\n### Next\nOutro that stays out.`;

    const { excerpt } = summarizeVerification(body);

    expect(excerpt.length).toBeLessThanOrEqual(VERIFICATION_EXCERPT_CHARS);
    expect(excerpt.length).toBeGreaterThan(VERIFICATION_EXCERPT_CHARS - 20);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.startsWith("word0 word1")).toBe(true);
    expect(excerpt).not.toContain("stays out");
  });

  it("does not take a heading inside a code fence for evidence", () => {
    for (const fence of ["```", "~~~", "````"]) {
      const body = [
        "### Summary",
        fence,
        "### Verified",
        SENTENCE,
        fence,
        "More text after the example.",
      ].join("\n");
      expect(summarizeVerification(body), fence).toEqual({
        present: false,
        hasMedia: false,
        excerpt: "",
      });
    }
  });

  it("keeps a fenced test run inside the section, headings in it included", () => {
    const body = [
      "### Verified",
      "```",
      "### not a heading",
      "pnpm vitest run: 12 passed",
      "```",
      "### Next",
      "Outside.",
    ].join("\n");

    const { present, excerpt } = summarizeVerification(body);

    expect(present).toBe(true);
    expect(excerpt).toContain("pnpm vitest run: 12 passed");
    expect(excerpt).not.toContain("Outside");
  });

  it("treats an unclosed fence before the heading as hiding it, which refuses rather than waves through", () => {
    expect(
      summarizeVerification(`\`\`\`\n### Verified\n${SENTENCE}`).present,
    ).toBe(false);
  });

  it("reads Windows line endings", () => {
    const body = `### Verified\r\n${SENTENCE}\r\n### Next\r\nOutside.\r\n`;

    expect(summarizeVerification(body)).toEqual({
      present: true,
      hasMedia: false,
      excerpt: SENTENCE,
    });
  });

  it("uses the first Verified section that holds evidence when an earlier one is empty", () => {
    const body = `### Verified\n\n### Verified\n${SENTENCE}`;

    expect(summarizeVerification(body)).toMatchObject({
      present: true,
      excerpt: SENTENCE,
    });
  });

  it("reads a body shaped like Builder's own block", () => {
    const body = [
      "### Summary",
      "Fixes the clipped error text.",
      "",
      '<a href="https://builder.example.test/edit"><img src="https://cdn.example.test/edit.png" alt="Edit in Builder"></a>',
      "",
      "<!-- FUSION_KEEP_START -->",
      "<!-- FUSION_SCREENSHOTS_START -->",
      "### Verified",
      "",
      "[▶ Watch the interaction](https://www.builder.io/app/timelines/abc123)",
      "",
      "**The long error is now short**",
      "",
      '<img src="https://storage.example.test/a.webp" alt="After: the error is short" />',
      "",
      "<!-- FUSION_SCREENSHOTS_END -->",
      "<!-- FUSION_KEEP_END -->",
      "",
      "---",
      "",
      "To clone this PR locally use the GitHub CLI.",
    ].join("\r\n");

    const result = summarizeVerification(body);

    expect(result).toMatchObject({ present: true, hasMedia: true });
    expect(result.excerpt).toBe(
      "▶ Watch the interaction **The long error is now short**",
    );
  });

  it("stays fast on text built to make a tag, link or comment pattern backtrack", () => {
    const body = `### Verified\n${"<a ".repeat(30_000)}${"[".repeat(30_000)}${"<!--".repeat(15_000)}`;

    expect(summarizeVerification(body).present).toBe(true);
  });
});
