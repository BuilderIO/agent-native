import { describe, expect, it } from "vitest";

import {
  convertDocsBlocksMarkdown,
  findDocsBlockFences,
} from "./codemod-doc-blocks";

describe("docs block codemod helpers", () => {
  it("converts an-diagram fences to Diagram MDX child fences", () => {
    const markdown = [
      '```an-diagram title="Flow"',
      '{ "html": "<div />", "css": ".flow {}", "caption": "Caption" }',
      "```",
    ].join("\n");

    const report = convertDocsBlocksMarkdown(markdown);

    expect(report.changed).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.output).toContain('<Diagram id="doc-block-');
    expect(report.output).toContain('title="Flow"');
    expect(report.output).toContain('caption="Caption"');
    expect(report.output).toContain("```html\n<div />\n```");
    expect(report.output).toContain("```css\n.flow {}\n```");
    expect(report.output).not.toContain("```an-diagram");
  });

  it("converts an-mermaid to a standard mermaid fence", () => {
    const markdown = ["```an-mermaid", "flowchart LR", "A --> B", "```"].join(
      "\n",
    );

    const report = convertDocsBlocksMarkdown(markdown);

    expect(report.changed).toBe(true);
    expect(report.output).toBe(
      ["```mermaid", "flowchart LR", "A --> B", "```"].join("\n"),
    );
  });

  it("serializes JSON-backed an-* fences through the shared block registry", () => {
    const markdown = [
      '```an-callout id="callout-1" title="Heads up" summary="Read me"',
      '{ "tone": "info", "body": "Use the shared serializer." }',
      "```",
    ].join("\n");

    const report = convertDocsBlocksMarkdown(markdown);

    expect(report.changed).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.output).toBe(
      [
        '<Callout id="callout-1" title="Heads up" summary="Read me" tone="info">',
        "",
        "Use the shared serializer.",
        "",
        "</Callout>",
      ].join("\n"),
    );
  });

  it("reports invalid JSON without changing that fence", () => {
    const markdown = ["```an-callout", "{ nope", "```"].join("\n");

    const report = convertDocsBlocksMarkdown(markdown);

    expect(report.changed).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.error).toContain("invalid JSON");
    expect(report.output).toBe(markdown);
  });
});
