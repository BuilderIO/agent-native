import { describe, expect, it } from "vitest";

import {
  buildCodingHandoffPrompt,
  buildDesignHandoffMarkdown,
  buildDesignHandoffPayload,
  buildDesignHandoffZip,
  buildHandoffZipFilename,
  buildHandoffZipUrl,
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

  it("builds a tokenized ZIP URL under the app origin", () => {
    const url = buildHandoffZipUrl({
      id: "design_123",
      token: "token.value",
      origin: "https://design.example.com/some/path",
    });

    expect(url).toBe(
      "https://design.example.com/api/design-handoff/design_123.zip?token=token.value",
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

  it("injects resolved tweak tokens after the full :root block", () => {
    const payload = buildDesignHandoffPayload({
      design: { id: "d", title: "Nested CSS", projectType: "prototype" },
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content:
            '<head><style>:root { --image: url("}"); --color: red; }</style></head>',
        },
      ],
      resolvedCssVars: { "--color": "blue" },
    });

    expect(payload.files[0].content).toContain('--image: url("}")');
    expect(payload.files[0].content).toContain(
      "--color: blue; /* applied-design-tokens */\n}</style>",
    );
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

  it("packages source files into a ZIP bundle", async () => {
    const payload = buildDesignHandoffPayload({
      exportedAt: "2026-05-06T12:00:00.000Z",
      design: {
        id: "design_123",
        title: "Launch Page!",
        projectType: "prototype",
      },
      files: [
        {
          filename: "../index.html",
          fileType: "html",
          content: "<main>Hello</main>",
        },
        {
          filename: "styles.css",
          fileType: "css",
          content: "body { color: red; }",
        },
      ],
    });

    const zipBytes = await buildDesignHandoffZip(payload);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBytes);

    expect(buildHandoffZipFilename("Launch Page!")).toBe(
      "Launch-Page-agent-handoff.zip",
    );
    expect(await zip.file("README.md")?.async("string")).toContain(
      "Launch Page!",
    );
    expect(await zip.file("index.html")?.async("string")).toContain(
      "<main>Hello</main>",
    );
    expect(await zip.file("styles.css")?.async("string")).toContain(
      "color: red",
    );
    expect(zip.file("../index.html")).toBeNull();
  });

  it("copies the raw and zip URLs into the agent prompt", () => {
    const prompt = buildCodingHandoffPrompt({
      rawUrl:
        "https://design.example.com/api/design-handoff/design_123?token=x",
      zipUrl:
        "https://design.example.com/api/design-handoff/design_123.zip?token=x",
      title: "Launch Page",
      fileCount: 2,
    });

    expect(prompt).toContain("Build this design as production code");
    expect(prompt).toContain(
      "https://design.example.com/api/design-handoff/design_123?token=x",
    );
    expect(prompt).toContain(
      "https://design.example.com/api/design-handoff/design_123.zip?token=x",
    );
    expect(prompt).toContain("2 files");
  });
});
