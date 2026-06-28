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
    if (block.kind !== "block" || block.source !== "fence") {
      throw new Error("expected fenced block");
    }
    expect(block.alias).toBe("an-diagram");
  });

  it("never hijacks ordinary non-diagram code fences (json/diff/ts/bash)", () => {
    for (const lang of ["json", "diff", "ts", "bash"]) {
      const md = ["```" + lang, "some code", "```"].join("\n");
      const segments = splitDocSegments(md);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe("markdown");
    }
  });

  it("treats standard mermaid fences as renderable diagram blocks", () => {
    const md = ["```mermaid", "flowchart LR", "A --> B", "```"].join("\n");
    const segments = splitDocSegments(md);
    expect(segments).toHaveLength(1);
    const block = segments[0];
    if (block.kind !== "block" || block.source !== "fence") {
      throw new Error("expected fenced block");
    }
    expect(block.alias).toBe("mermaid");
    expect(block.body).toContain("flowchart LR");
  });

  it("parses title/summary attributes from the fence info string", () => {
    const md = [
      '```an-callout title="Heads up" summary="read me"',
      '{ "tone": "info", "body": "hi" }',
      "```",
    ].join("\n");
    const segments = splitDocSegments(md);
    const block = segments[0];
    if (block.kind !== "block" || block.source !== "fence") {
      throw new Error("expected fenced block");
    }
    expect(block.attrs.title).toBe("Heads up");
    expect(block.attrs.summary).toBe("read me");
  });

  it("treats registered MDX block tags as blocks", () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      '<Callout id="heads-up" tone="info">',
      "",
      "Read this first.",
      "",
      "</Callout>",
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
    if (block.kind !== "block" || block.source !== "mdx") {
      throw new Error("expected MDX block");
    }
    expect(block.type).toBe("callout");
    expect(block.id).toBe("heads-up");
    expect(block.data).toEqual({
      tone: "info",
      body: "Read this first.",
    });
  });

  it("parses Diagram MDX child code fences through the block registry", () => {
    const md = [
      '<Diagram id="diagram" title="Flow" caption="Caption">',
      "",
      "```html",
      '<div class="flow">Flow</div>',
      "```",
      "",
      "```css",
      ".flow { display: grid; }",
      "```",
      "",
      "</Diagram>",
    ].join("\n");

    const segments = splitDocSegments(md);
    expect(segments).toHaveLength(1);
    const block = segments[0];
    if (block.kind !== "block" || block.source !== "mdx") {
      throw new Error("expected MDX block");
    }
    expect(block.type).toBe("diagram");
    expect(block.title).toBe("Flow");
    expect(block.data).toEqual({
      html: '<div class="flow">Flow</div>',
      css: ".flow { display: grid; }",
      caption: "Caption",
    });
  });

  it("keeps legacy Diagram data attributes parseable", () => {
    const md =
      '<Diagram id="diagram" data={{ html: "<div />", css: ".x {}", caption: "Legacy" }} />';

    const segments = splitDocSegments(md);
    expect(segments).toHaveLength(1);
    const block = segments[0];
    if (block.kind !== "block" || block.source !== "mdx") {
      throw new Error("expected MDX block");
    }
    expect(block.type).toBe("diagram");
    expect(block.data).toEqual({
      html: "<div />",
      css: ".x {}",
      caption: "Legacy",
    });
  });

  it("parses MDX blocks in docs that use explicit markdown heading ids", () => {
    const md = [
      "## What and why {#what-why}",
      "",
      '<Callout id="heads-up" tone="info">',
      "",
      "Read this first.",
      "",
      "</Callout>",
    ].join("\n");

    const segments = splitDocSegments(md);
    expect(segments.map((s) => s.kind)).toEqual(["markdown", "block"]);
    expect(segments[0]).toEqual({
      kind: "markdown",
      text: "## What and why {#what-why}",
    });
    const block = segments[1];
    if (block.kind !== "block" || block.source !== "mdx") {
      throw new Error("expected MDX block");
    }
    expect(block.type).toBe("callout");
  });

  it("parses self-closing registered MDX tags through the block registry", () => {
    const md = [
      '<FileTree id="files" title="Files" entries={[{ path: "app/root.tsx", note: "shell" }]} />',
    ].join("\n");

    const segments = splitDocSegments(md);
    expect(segments).toHaveLength(1);
    const block = segments[0];
    if (block.kind !== "block" || block.source !== "mdx") {
      throw new Error("expected MDX block");
    }
    expect(block.type).toBe("file-tree");
    expect(block.data).toEqual({
      title: "Files",
      entries: [{ path: "app/root.tsx", note: "shell" }],
    });
  });

  it("does not hijack unknown JSX examples", () => {
    const md = [
      "<ExampleThing>",
      "",
      "Still prose.",
      "",
      "</ExampleThing>",
    ].join("\n");

    const segments = splitDocSegments(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("markdown");
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
    expect(resolveDocBlockType("mermaid")).toBe("mermaid");
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
