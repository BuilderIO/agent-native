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

  it("injects resolved tweak tokens into the :root and a tokens block", () => {
    const payload = buildDesignHandoffPayload({
      exportedAt: "2026-05-06T12:00:00.000Z",
      design: {
        id: "design_123",
        title: "Tuned Page",
        projectType: "prototype",
        data: JSON.stringify({ lastPrompt: "Make it" }),
      },
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content:
            "<head><style>:root { --color-accent: #0EA5E9; }</style></head><main>Hi</main>",
        },
      ],
      resolvedCssVars: { "--color-accent": "#F97316", "--radius": "16px" },
    });

    const idx = payload.files[0].content;
    // Original :root gets the override declarations appended before its `}`.
    expect(idx).toContain(
      "--color-accent: #F97316; /* applied-design-tokens */",
    );
    expect(idx).toContain("--radius: 16px; /* applied-design-tokens */");
    expect(payload.appliedDesignTokens).toEqual({
      "--color-accent": "#F97316",
      "--radius": "16px",
    });

    const markdown = buildDesignHandoffMarkdown(payload);
    expect(markdown).toContain("## Applied Design Tokens");
    expect(markdown).toContain("--color-accent: #F97316;");
  });

  it("leaves files untouched when no resolved tokens are passed", () => {
    const payload = buildDesignHandoffPayload({
      design: { id: "d", title: "Plain", projectType: "prototype" },
      files: [
        { filename: "index.html", fileType: "html", content: "<main>x</main>" },
      ],
    });
    expect(payload.files[0].content).toBe("<main>x</main>");
    expect(payload.appliedDesignTokens).toBeUndefined();
    expect(buildDesignHandoffMarkdown(payload)).not.toContain(
      "## Applied Design Tokens",
    );
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
