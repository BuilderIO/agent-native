import { describe, expect, it } from "vitest";

import {
  buildBuilderDesignSystemIndexFiles,
  createBuilderDesignSystemProxyFields,
  localBuilderDesignSystemId,
  mimeTypeForBuilderDesignSystemFilename,
  parseBuilderDesignSystemProxyReference,
} from "./builder-design-systems.js";

describe("Builder design-system helpers", () => {
  it("builds Builder DSI upload files from design.md and code inputs", () => {
    const files = buildBuilderDesignSystemIndexFiles({
      designMd: "# Brand\nUse confident layouts.",
      codeFiles: [
        {
          filename: "src/tokens.css",
          content: ":root { --brand: #123456; }",
        },
        {
          filename: "theme.json",
          content: '{"color":"#123456"}',
        },
      ],
    });

    expect(files.map((file) => file.name)).toEqual([
      "design.md",
      "src/tokens.css",
      "theme.json",
    ]);
    expect(files.map((file) => file.mimeType)).toEqual([
      "text/markdown",
      "text/css",
      "application/json",
    ]);
    expect(new TextDecoder().decode(files[0].data)).toContain(
      "Use confident layouts",
    );
  });

  it("skips empty and over-budget code files before indexing", () => {
    const files = buildBuilderDesignSystemIndexFiles({
      maxTotalCodeBytes: 8,
      codeFiles: [
        { filename: "empty.css", content: "" },
        { filename: "ok.css", content: "1234" },
        { filename: "too-large.css", content: "123456789" },
        { filename: "also-ok.css", content: "5678" },
      ],
    });

    expect(files.map((file) => file.name)).toEqual(["ok.css", "also-ok.css"]);
  });

  it("creates a local proxy that preserves the Builder DSI reference", () => {
    const fields = createBuilderDesignSystemProxyFields({
      result: {
        ok: true,
        source: "builder",
        projectId: "project-1",
        jobId: "job-1",
        designSystemId: "ds-1",
        suggestedTitle: "Acme",
        builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
        status: "in-progress",
      },
      projectName: "Acme",
      description: "Marketing system",
      surface: "slides",
    });

    expect(fields.title).toBe("Acme");
    expect(fields.customInstructions).toContain(
      "Builder Design System Intelligence",
    );
    expect(fields.customInstructions).toContain("slides");
    expect(parseBuilderDesignSystemProxyReference(fields.data)).toEqual({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderProjectId: "project-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      builderStatus: "in-progress",
    });
  });

  it("normalizes Builder filenames and local proxy ids", () => {
    expect(mimeTypeForBuilderDesignSystemFilename("design.mdx")).toBe(
      "text/markdown",
    );
    expect(mimeTypeForBuilderDesignSystemFilename("logo.svg")).toBe(
      "image/svg+xml",
    );
    expect(localBuilderDesignSystemId("ds:/Brand Kit 2026")).toBe(
      "builder-ds-Brand-Kit-2026",
    );
  });
});
