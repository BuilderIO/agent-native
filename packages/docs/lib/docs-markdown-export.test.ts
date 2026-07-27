import { describe, expect, it } from "vitest";

import { docsBodyToMarkdownMirror } from "./docs-markdown-export";

describe("docsBodyToMarkdownMirror", () => {
  it("keeps prose while lowering MDX callouts to plain markdown", () => {
    const markdown = [
      "Intro text.",
      "",
      '<Callout id="heads-up" title="Heads up" tone="info">',
      "",
      "Read **this** first.",
      "",
      "</Callout>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("Intro text.");
    expect(mirror).toContain("### Heads up");
    expect(mirror).toContain("Read **this** first.");
    expect(mirror).not.toContain("<Callout");
  });

  it("lowers endpoint MDX to crawlable markdown", () => {
    const markdown = [
      '<Endpoint id="create" method="POST" path="/api/items" summary="Create an item" params={[{ name: "id", in: "path", type: "string", required: true }]} responses={[{ status: "201", description: "Created" }]}>',
      "",
      "Creates a new item.",
      "",
      "</Endpoint>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("#### POST /api/items");
    expect(mirror).toContain("Creates a new item.");
    expect(mirror).toContain("| id | path | string | yes |");
    expect(mirror).toContain("- 201: Created");
    expect(mirror).not.toContain("<Endpoint");
  });

  it("protects JSX-looking names in generated headings", () => {
    const markdown =
      '<AnnotatedCode id="root" title={"Wrapping <AgentSidebar>"} filename="app/root.tsx" language="tsx" code={"export default function Root() {}"} annotations={[]} />';

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("### Wrapping `<AgentSidebar>`");
    expect(mirror).not.toContain("### Wrapping <AgentSidebar>");
  });

  it("preserves filename-labeled fences as-is (G3 filename attribute)", () => {
    const markdown = [
      '```ts filename="actions/foo.ts"',
      "export const foo = 1;",
      "```",
    ].join("\n");

    expect(docsBodyToMarkdownMirror(markdown)).toBe(`${markdown}\n`);
  });

  it("preserves portable mermaid fences", () => {
    const markdown = ["```mermaid", "flowchart LR", "A --> B", "```"].join(
      "\n",
    );

    expect(docsBodyToMarkdownMirror(markdown)).toBe(`${markdown}\n`);
  });

  it("lowers Diagram MDX child fences to crawlable markdown", () => {
    const markdown = [
      '<Diagram title="Lifecycle" caption="Runtime lifecycle">',
      "",
      "```html",
      "<div />",
      "```",
      "",
      "```css",
      ".diagram {}",
      "```",
      "",
      "</Diagram>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("### Lifecycle");
    expect(mirror).toContain("#### Runtime lifecycle");
    expect(mirror).toContain("```html\n<div />\n```");
    expect(mirror).toContain("```css\n.diagram {}\n```");
    expect(mirror).not.toContain("<Diagram");
    expect(mirror).not.toContain("```an-diagram");
  });
});
