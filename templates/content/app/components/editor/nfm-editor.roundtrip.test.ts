// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createVisualEditorExtensions } from "./VisualEditor";
import { docToNfm, nfmToDoc } from "@shared/nfm";

/**
 * End-to-end fidelity: load canonical NFM into a REAL TipTap editor (full
 * extension set, the same schema the app runs) and serialize it back. If the
 * result differs from the input, opening a synced document and saving it with
 * no edits would mutate it — exactly the drift this rewrite eliminates.
 */
function editorRoundTrip(nfm: string): string {
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(nfm),
  });
  const out = docToNfm(editor.getJSON() as any);
  editor.destroy();
  return out;
}

const L = (...lines: string[]) => lines.join("\n");

const CASES: Array<{ name: string; nfm: string }> = [
  { name: "plain paragraph", nfm: "Just a paragraph." },
  {
    name: "inline marks",
    nfm: 'Intro with **bold**, *italic*, ~~strike~~, `code`, <span underline="true">underline</span>, <span color="red">red text</span>, a [link](https://example.com).',
  },
  { name: "inline math", nfm: "before $`a^2 + b^2`$ after" },
  { name: "block color paragraph", nfm: 'Colored paragraph {color="red"}' },
  {
    name: "headings",
    nfm: L(
      "# Heading One",
      "## Heading Two",
      "### Heading Three",
      "#### Heading Four",
    ),
  },
  { name: "colored heading", nfm: '## Blue heading {color="blue"}' },
  {
    name: "toggle heading",
    nfm: L(
      '## Toggle Heading Two {toggle="true"}',
      "\tChild under toggle heading",
    ),
  },
  { name: "single quote", nfm: "> A single real quote block" },
  {
    name: "multi-line quote",
    nfm: "> Multi-line quote line one<br>line two<br>line three",
  },
  {
    name: "nested bullets",
    nfm: L("- bullet one", "\t- nested bullet", "- bullet two"),
  },
  { name: "numbered list", nfm: L("1. first", "2. second") },
  { name: "todo list", nfm: L("- [ ] unchecked todo", "- [x] checked todo") },
  {
    name: "callout with nested list",
    nfm: L(
      '<callout icon="💡" color="blue_bg">',
      "\tCallout with **bold** text",
      "\t- callout item one",
      "\t- callout item two",
      "</callout>",
    ),
  },
  {
    name: "toggle with children",
    nfm: L(
      "<details>",
      "<summary>A toggle</summary>",
      "\tHidden child paragraph",
      "\t- hidden bullet",
      "</details>",
    ),
  },
  {
    name: "columns",
    nfm: L(
      "<columns>",
      "\t<column>",
      "\t\tLeft column text",
      "\t</column>",
      "\t<column>",
      "\t\tRight column text",
      "\t</column>",
      "</columns>",
    ),
  },
  {
    name: "table with header row + column + cell color",
    nfm: L(
      '<table header-row="true" header-column="true">',
      "<tr>",
      "<td>H1</td>",
      "<td>H2</td>",
      "</tr>",
      "<tr>",
      "<td>r1c1</td>",
      '<td color="green_bg">r1c2 green</td>',
      "</tr>",
      "</table>",
    ),
  },
  {
    name: "code block",
    nfm: L("```python", "def f(x):", "    return x < 3 and x * 2", "```"),
  },
  {
    name: "block equation",
    nfm: L("$$", "\\int_0^1 x^2 dx = \\frac{1}{3}", "$$"),
  },
  { name: "divider between text", nfm: L("above", "---", "below") },
  { name: "empty block", nfm: L("above", "<empty-block/>", "below") },
  {
    name: "visual indent",
    nfm: L("root", "\tindented once", "\t\tindented twice"),
  },
  { name: "image", nfm: "![A caption](https://cdn.example.com/x.png)" },
  {
    name: "page atom",
    nfm: '<page url="https://www.notion.so/abc">Child Page</page>',
  },
  {
    name: "mention inline",
    nfm: 'Hello <mention-page url="https://www.notion.so/abc">A Page</mention-page> there',
  },
  {
    name: "synced block with children",
    nfm: L(
      '<synced_block url="https://www.notion.so/s">',
      "\tShared content",
      "</synced_block>",
    ),
  },
  {
    name: "literal special chars",
    nfm: "Text with a \\< b, 2 \\* 3, price \\$5, \\[bracket\\].",
  },
];

describe("NFM ⇄ real TipTap editor round-trip", () => {
  for (const { name, nfm } of CASES) {
    it(`round-trips through the live schema: ${name}`, () => {
      expect(editorRoundTrip(nfm)).toBe(nfm);
    });
  }
});
