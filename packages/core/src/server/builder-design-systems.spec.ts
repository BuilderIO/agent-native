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

  it("can fail loudly instead of silently dropping an over-budget binary file", () => {
    expect(() =>
      buildBuilderDesignSystemIndexFiles({
        maxTotalCodeBytes: 8,
        overflowBehavior: "throw",
        codeFiles: [
          {
            filename: "brand.fig",
            content: Buffer.from("larger than eight bytes").toString("base64"),
            encoding: "base64",
          },
        ],
      }),
    ).toThrow(/brand\.fig.*inline upload budget/i);
  });

  it("fails loudly when a strict caller exceeds the file-count cap", () => {
    expect(() =>
      buildBuilderDesignSystemIndexFiles({
        maxCodeFiles: 1,
        overflowBehavior: "throw",
        codeFiles: [
          { filename: "one.css", content: "a" },
          { filename: "two.css", content: "b" },
        ],
      }),
    ).toThrow(/too many design-system files/i);
  });

  it("base64-decodes a binary .fig file instead of UTF-8-mangling it (regression: .fig upload silently corrupted binary bytes)", () => {
    // A real .fig is a zip container -- PK\x03\x04 magic, per the fig-writer
    // spike's own README -- and its bytes are NOT valid UTF-8 (many bytes
    // are >= 0x80 with no valid continuation sequence). Round-tripping
    // arbitrary binary through TextEncoder().encode() (the old
    // default-and-only path) corrupts it; through base64 + Buffer.from it
    // must come back byte-identical.
    const binaryBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x81, 0xfe, 0x7f, 0x10, 0x20,
    ]);
    const base64Content = Buffer.from(binaryBytes).toString("base64");

    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles: [
        {
          filename: "spike-output.fig",
          content: base64Content,
          encoding: "base64",
        },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("spike-output.fig");
    expect(files[0].mimeType).toBe("application/octet-stream");
    expect(Array.from(files[0].data)).toEqual(Array.from(binaryBytes));
  });

  it("still treats codeFiles as UTF-8 text by default when encoding is omitted (no behavior change for existing text callers)", () => {
    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles: [{ filename: "tokens.css", content: ":root{--x:1}" }],
    });
    expect(new TextDecoder().decode(files[0].data)).toBe(":root{--x:1}");
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
