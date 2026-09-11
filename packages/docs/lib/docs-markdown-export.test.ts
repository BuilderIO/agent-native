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
    expect(mirror).not.toContain("### Wrapping <AgentSidebar>\n");
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

  it("lowers Notice/Banner/Badge/Accordion MDX to readable markdown instead of a JSON fence", () => {
    const markdown = [
      '<Notice id="n1" tone="risk" title="Heads up">',
      "",
      "Read this.",
      "",
      "</Notice>",
      "",
      '<Banner id="b1" tone="warning" body="This page covers v9." />',
      "",
      '<Badge id="bd1" label="Beta" color="orange" />',
      "",
      "<Accordion>",
      "",
      "### Question one",
      "",
      "Answer one.",
      "",
      "</Accordion>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("Heads up");
    expect(mirror).toContain("Read this.");
    expect(mirror).toContain("This page covers v9.");
    expect(mirror).toContain("Beta");
    expect(mirror).toContain("Question one");
    expect(mirror).toContain("Answer one.");
    expect(mirror).not.toContain('"tone"');
    expect(mirror).not.toContain('"items"');
    expect(mirror).not.toContain("<Notice");
    expect(mirror).not.toContain("<Banner");
    expect(mirror).not.toContain("<Badge");
    expect(mirror).not.toContain("<Accordion");
  });

  it("lowers Cards/Steps/Comparison MDX to readable markdown instead of a JSON fence", () => {
    const markdown = [
      "<Cards>",
      "",
      "### [Actions](/docs/actions)",
      "",
      "Typed operations.",
      "",
      "</Cards>",
      "",
      "<Steps>",
      "",
      "### Install",
      "",
      "Run `pnpm install`.",
      "",
      "</Steps>",
      "",
      "<Comparison>",
      "",
      "### Before",
      "",
      "Old way.",
      "",
      "### After",
      "",
      "New way.",
      "",
      "</Comparison>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("[Actions](/docs/actions)");
    expect(mirror).toContain("Typed operations.");
    expect(mirror).toContain("Install");
    expect(mirror).toContain("Run `pnpm install`.");
    expect(mirror).toContain("Before");
    expect(mirror).toContain("Old way.");
    expect(mirror).toContain("After");
    expect(mirror).toContain("New way.");
    expect(mirror).not.toContain('"cards"');
    expect(mirror).not.toContain('"steps"');
    expect(mirror).not.toContain('"sides"');
    expect(mirror).not.toContain("<Cards");
    expect(mirror).not.toContain("<Steps");
    expect(mirror).not.toContain("<Comparison");
  });

  it("protects JSX-looking titles in Cards/Steps/Comparison/Accordion headings", () => {
    const markdown = [
      "<Cards>",
      "",
      "### Wrapping <AgentSidebar />",
      "",
      "Body.",
      "",
      "</Cards>",
      "",
      "<Steps>",
      "",
      "### Wrapping <AgentSidebar />",
      "",
      "Body.",
      "",
      "</Steps>",
      "",
      "<Comparison>",
      "",
      "### Wrapping <AgentSidebar />",
      "",
      "Old way.",
      "",
      "### After",
      "",
      "New way.",
      "",
      "</Comparison>",
      "",
      "<Accordion>",
      "",
      "### Wrapping <AgentSidebar />",
      "",
      "Body.",
      "",
      "</Accordion>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    // Every occurrence must be backtick-wrapped so a Markdown renderer shows
    // it as text and an MDX consumer never treats it as a real component.
    // A negative lookbehind for the opening backtick catches any occurrence
    // that slipped through unescaped.
    const unescaped = mirror.match(/(?<!`)<AgentSidebar \/>/g) ?? [];
    expect(unescaped).toEqual([]);
    expect(mirror.match(/Wrapping `<AgentSidebar \/>`/g)?.length).toBe(4);
  });

  it("protects JSX-looking titles that carry attributes, including linked Cards headings", () => {
    const markdown = [
      "<Cards>",
      "",
      '### [Wrapping <AgentSidebar mode="compact" />](/docs/agent-sidebar)',
      "",
      "Body.",
      "",
      "</Cards>",
      "",
      "<Accordion>",
      "",
      '### Wrapping <AgentSidebar mode="compact" />',
      "",
      "Body.",
      "",
      "</Accordion>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    const unescaped =
      mirror.match(/(?<!`)<AgentSidebar mode="compact" \/>/g) ?? [];
    expect(unescaped).toEqual([]);
    expect(mirror).toContain(
      '[Wrapping `<AgentSidebar mode="compact" />`](/docs/agent-sidebar)',
    );
    expect(
      mirror.match(/Wrapping `<AgentSidebar mode="compact" \/>`/g)?.length,
    ).toBe(2);
  });

  it("protects JSX titles whose attribute values have nested braces or a spread", () => {
    const markdown = [
      "<Accordion>",
      "",
      "### Wrapping <AgentSidebar mode={{ compact: true }} />",
      "",
      "Body one.",
      "",
      "### Wrapping <AgentSidebar {...props} />",
      "",
      "Body two.",
      "",
      "</Accordion>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain(
      "Wrapping `<AgentSidebar mode={{ compact: true }} />`",
    );
    expect(mirror).toContain("Wrapping `<AgentSidebar {...props} />`");
  });

  it("protects JSX-looking text even when a backslash-escaped attribute quote makes the block invalid MDX", () => {
    // `\"` inside a double-quoted JSX attribute isn't valid JSX either — real
    // MDX parsing rejects the whole block and falls back to the raw source
    // (see the `invalid-block` branch of docsBodyToMarkdownMirror). The raw
    // fallback must still get JSX-protected, since it still contains
    // JSX-looking text that would otherwise ship unescaped into the mirror.
    const markdown = [
      "<Accordion>",
      "",
      '### Wrapping <AgentSidebar body="a \\"quoted\\" value" />',
      "",
      "Body one.",
      "",
      "</Accordion>",
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    const unescaped =
      mirror.match(/(?<!`)<AgentSidebar body="a \\"quoted\\" value" \/>/g) ??
      [];
    expect(unescaped).toEqual([]);
    expect(mirror).toContain(
      'Wrapping `<AgentSidebar body="a \\"quoted\\" value" />`',
    );
  });

  it("carries a nested Notice's title through Tabs/Columns exports", () => {
    const markdown =
      '<TabsBlock tabs={[{ id: "setup", label: "Setup", blocks: [{ type: "notice", data: { tone: "risk", title: "Heads up", body: "Read this." } }] }]} />';

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("Heads up");
    expect(mirror).toContain("Read this.");
  });

  it("protects JSX-looking tags inside Notice and Banner bodies", () => {
    const markdown = [
      '<Notice id="n1" tone="risk" title="Heads up">',
      "",
      "Wrapping <AgentSidebar /> changes behavior.",
      "",
      "</Notice>",
      "",
      '<Banner id="b1" tone="warning" body="Wrapping <AgentSidebar /> here." />',
    ].join("\n");

    const mirror = docsBodyToMarkdownMirror(markdown);

    expect(mirror).toContain("Wrapping `<AgentSidebar />` changes behavior.");
    expect(mirror).toContain("Wrapping `<AgentSidebar />` here.");
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
