import { describe, expect, it } from "vitest";
import {
  buildCodingHandoffPrompt,
  buildDesignHandoffMarkdown,
  buildDesignHandoffPayload,
  buildRawHandoffUrl,
} from "./coding-handoff";

describe("coding handoff helpers", () => {
  it("builds a tokenized raw-code URL under the app origin", () => {
    const url = buildRawHandoffUrl({
      id: "design_123",
      token: "token.value",
      origin: "https://design.example.com/some/path",
      format: "markdown",
    });

    expect(url).toBe(
      "https://design.example.com/api/design-handoff/design_123?token=token.value&format=markdown",
    );
  });

  it("renders exact files in a markdown bundle", () => {
    const payload = buildDesignHandoffPayload({
      exportedAt: "2026-05-06T12:00:00.000Z",
      design: {
        id: "design_123",
        title: "Launch Page",
        description: "Homepage concept",
        projectType: "prototype",
        data: JSON.stringify({ lastPrompt: "Make a launch page" }),
      },
      files: [
        {
          filename: "styles.css",
          fileType: "css",
          content: "body { color: red; }",
        },
        {
          filename: "index.html",
          fileType: "html",
          content: "<main>Hello</main>",
        },
      ],
    });

    const markdown = buildDesignHandoffMarkdown(payload);

    expect(markdown).toContain("# Design Handoff: Launch Page");
    expect(markdown.indexOf("### index.html")).toBeLessThan(
      markdown.indexOf("### styles.css"),
    );
    expect(markdown).toContain("```html\n<main>Hello</main>\n```");
    expect(markdown).toContain("```css\nbody { color: red; }\n```");
  });

  it("copies the raw URL into the coding prompt", () => {
    const prompt = buildCodingHandoffPrompt({
      rawUrl:
        "https://design.example.com/api/design-handoff/design_123?token=x",
      title: "Launch Page",
      fileCount: 2,
    });

    expect(prompt).toContain("Build this design as production code");
    expect(prompt).toContain(
      "https://design.example.com/api/design-handoff/design_123?token=x",
    );
    expect(prompt).toContain("2 files");
  });
});
