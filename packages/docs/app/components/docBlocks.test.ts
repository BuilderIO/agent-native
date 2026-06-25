import { describe, expect, it } from "vitest";

import {
  resolveDocBlockType,
  splitDocSegments,
  validateDocBlock,
} from "./docBlocks";

describe("splitDocSegments", () => {
  it("treats an-* fences as blocks and leaves prose intact", () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "```an-diagram",
      '{ "nodes": [{ "id": "a", "label": "A" }] }',
      "```",
      "",
      "After.",
    ].join("\n");
    const segments = splitDocSegments(md);
    expect(segments.map((s) => s.kind)).toEqual([
      "markdown",
      "block",
      "markdown",
    ]);
    const block = segments[1];
    expect(block.kind === "block" && block.alias).toBe("an-diagram");
  });

  it("never hijacks ordinary code fences (json/diff/ts/mermaid)", () => {
    for (const lang of ["json", "diff", "ts", "mermaid", "bash"]) {
      const md = ["```" + lang, "some code", "```"].join("\n");
      const segments = splitDocSegments(md);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe("markdown");
    }
  });

  it("parses title/summary attributes from the fence info string", () => {
    const md = [
      '```an-callout title="Heads up" summary="read me"',
      '{ "tone": "info", "body": "hi" }',
      "```",
    ].join("\n");
    const segments = splitDocSegments(md);
    const block = segments[0];
    if (block.kind !== "block") throw new Error("expected block");
    expect(block.attrs.title).toBe("Heads up");
    expect(block.attrs.summary).toBe("read me");
  });

  it("keeps an unterminated fence as prose so nothing is dropped", () => {
    const md = ["```an-diagram", "{ no close"].join("\n");
    const segments = splitDocSegments(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("markdown");
  });
});

describe("resolveDocBlockType", () => {
  it("maps friendly aliases to canonical block types", () => {
    expect(resolveDocBlockType("an-api")).toBe("api-endpoint");
    expect(resolveDocBlockType("an-schema")).toBe("data-model");
    expect(resolveDocBlockType("an-files")).toBe("file-tree");
    expect(resolveDocBlockType("an-unknown")).toBeUndefined();
    expect(resolveDocBlockType("json")).toBeUndefined();
  });
});

describe("validateDocBlock", () => {
  it("accepts a well-formed block", () => {
    expect(
      validateDocBlock("an-callout", '{ "tone": "info", "body": "hi" }'),
    ).toEqual({ ok: true });
  });

  it("reports invalid JSON", () => {
    const result = validateDocBlock("an-diagram", "{ not json }");
    expect(result.ok).toBe(false);
  });

  it("reports a schema mismatch", () => {
    const result = validateDocBlock("an-callout", '{ "tone": "nope" }');
    expect(result.ok).toBe(false);
  });
});
