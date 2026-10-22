import { describe, expect, it } from "vitest";

import { applyEditBatch } from "./batch-edit.js";

describe("replace-placeholder-with-image", () => {
  it("replaces the source-located ImagePlaceholder and keeps its label as alt text", () => {
    const source = [
      'import { ImagePlaceholder } from "@open-slide/core";',
      "export default function Slide() {",
      '  return <ImagePlaceholder label="team photo" />;',
      "}",
    ].join("\n");

    const result = applyEditBatch(source, [
      {
        line: 3,
        column: 9,
        ops: [{ kind: "replace-placeholder-with-image", assetId: "asset-1" }],
      },
    ]);

    expect(result.results).toEqual([{ ok: true }]);
    expect(result.source).toContain('src="asset://asset-1"');
    expect(result.source).toContain("alt='team photo'");
    expect(result.source).not.toContain("<ImagePlaceholder");
  });

  it("rejects a non-ImagePlaceholder even when it carries a placeholder data attribute", () => {
    const source = [
      "export default function Slide() {",
      "  return <div data-slide-placeholder />;",
      "}",
    ].join("\n");

    const result = applyEditBatch(source, [
      {
        line: 2,
        column: 9,
        ops: [{ kind: "replace-placeholder-with-image", assetId: "asset-1" }],
      },
    ]);

    expect(result.results).toEqual([{ ok: false, error: "not a placeholder" }]);
    expect(result.source).toBe(source);
  });
});

describe("insert-image-asset", () => {
  it("adds an asset-backed image as the slide background without changing derived HTML directly", () => {
    const source = [
      "export default function Slide() {",
      '  return <div style={{ width: "1920px", height: "1080px" }}><h1>Title</h1></div>;',
      "}",
    ].join("\n");

    const result = applyEditBatch(source, [
      {
        line: 2,
        column: 9,
        ops: [
          {
            kind: "insert-image-asset",
            assetId: "asset-1",
            alt: "A brand hero image",
          },
        ],
      },
    ]);

    expect(result.results).toEqual([{ ok: true }]);
    expect(result.source).toContain('src="asset://asset-1"');
    expect(result.source).toContain("position: 'relative'");
    expect(result.source).toContain("isolation: 'isolate'");
    expect(result.source.indexOf('src="asset://asset-1"')).toBeLessThan(
      result.source.indexOf("<h1>Title</h1>"),
    );
  });

  it("expands a self-closing slide root before inserting an image", () => {
    const source = [
      "export default function Slide() {",
      '  return <div style={{ width: "1920px", height: "1080px" }} />;',
      "}",
    ].join("\n");

    const result = applyEditBatch(source, [
      {
        line: 2,
        column: 9,
        ops: [{ kind: "insert-image-asset", assetId: "asset-2", alt: "Cover" }],
      },
    ]);

    expect(result.results).toEqual([{ ok: true }]);
    expect(result.source).toContain('src="asset://asset-2"');
    expect(result.source).toContain("</div>");
  });
});
