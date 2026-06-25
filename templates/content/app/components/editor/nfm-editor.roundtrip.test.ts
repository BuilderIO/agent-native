// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createVisualEditorExtensions } from "./VisualEditor";

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

const HARD_CASES: Array<{ name: string; nfm: string }> = [
  { name: "colored bullet item", nfm: '- colored item {color="green"}' },
  { name: "colored heading", nfm: '# Big red {color="red"}' },
  { name: "colored quote", nfm: '> Quoted in gray {color="gray"}' },
  {
    name: "toggle inside callout",
    nfm: L(
      '<callout icon="📌">',
      "\tCallout intro",
      "\t<details>",
      "\t<summary>Nested toggle</summary>",
      "\t\tdeep content",
      "\t</details>",
      "</callout>",
    ),
  },
  {
    name: "quote with child blocks",
    nfm: L(
      "> Quote lead",
      "\tChild paragraph of the quote",
      "\t- child bullet",
    ),
  },
  {
    name: "table with column colors (colgroup)",
    nfm: L(
      '<table header-row="true">',
      "<colgroup>",
      '<col color="gray"/>',
      "<col/>",
      "</colgroup>",
      "<tr>",
      "<td>A</td>",
      "<td>B</td>",
      "</tr>",
      "<tr>",
      '<td color="red_bg">1</td>',
      "<td>2</td>",
      "</tr>",
      "</table>",
    ),
  },
  {
    name: "row color",
    nfm: L(
      "<table>",
      '<tr color="blue_bg">',
      "<td>x</td>",
      "</tr>",
      "</table>",
    ),
  },
  { name: "combined marks", nfm: "[**important**](https://x.com)" },
  {
    name: "synced block reference",
    nfm: L(
      '<synced_block_reference url="https://www.notion.so/r">',
      "\tref content",
      "</synced_block_reference>",
    ),
  },
];

/**
 * Registry-block cases (T6): a registered structured block lives inline in the
 * NFM string as an MDX element. The live editor schema must include core's
 * `registryBlock` atom node so it parses to a `registryBlock`, preserves the
 * verbatim source in `__raw`, and serializes back byte-exact with no edit —
 * exactly like every other block above. An untouched block never needs the
 * side-map: `docToNfm` emits `__raw` verbatim.
 */
const REGISTRY_CASES: Array<{ name: string; nfm: string }> = [
  {
    name: "self-closing endpoint",
    nfm: '<Endpoint id="e1" method="GET" path="/api/widgets" />',
  },
  {
    name: "checklist with items expr",
    nfm: '<Checklist id="c1" items={[{"id":"a","label":"First"}]} />',
  },
  {
    name: "endpoint with prose children",
    nfm: L(
      '<Endpoint id="e2" method="POST" path="/api/widgets">',
      "",
      "Creates a widget.",
      "",
      "</Endpoint>",
    ),
  },
  {
    name: "registry block nested inside a callout (indented __raw)",
    nfm: L(
      '<callout icon="💡">',
      "\tIntro inside the callout.",
      '\t<Endpoint id="e3" method="GET" path="/nested" />',
      "</callout>",
    ),
  },
  {
    name: "registry block between paragraphs",
    nfm: L(
      "Above the block.",
      '<DataModel id="d1" entities={[{"id":"e","name":"User","fields":[]}]} />',
      "Below the block.",
    ),
  },
  // The remaining dev-doc blocks from the unification, seeded byte-exact from
  // each spec's `empty()` via `seedRegistryBlockRaw` (the slash-insert path).
  // These exercise multi-line JSON-expression `__raw` attributes (embedded
  // newlines in mermaid `source`, pretty-printed `entities`/`spec`) through the
  // FULL live TipTap schema — the strongest round-trip guarantee.
  {
    name: "mermaid block (multi-line source expr)",
    nfm: '<Mermaid id="mermaid-seed" source={"flowchart TD\\n  A[Start] --> B{Decision}\\n  B -->|Yes| C[Do it]\\n  B -->|No| D[Skip]"} />',
  },
  {
    name: "data-model block (pretty-printed entities expr)",
    nfm: L(
      '<DataModel id="data-model-seed" entities={[',
      "  {",
      '    "id": "e_user",',
      '    "name": "User",',
      '    "fields": [',
      "      {",
      '        "name": "id",',
      '        "type": "uuid",',
      '        "pk": true',
      "      },",
      "      {",
      '        "name": "email",',
      '        "type": "text"',
      "      }",
      "    ]",
      "  }",
      "]} />",
    ),
  },
  {
    name: "diff block (multi-line before/after exprs)",
    nfm: '<Diff id="diff-seed" language="ts" before={"function add(a, b) {\\n  return a + b;\\n}"} after={"function add(a: number, b: number): number {\\n  return a + b;\\n}"} />',
  },
  {
    name: "file-tree block (pretty-printed entries expr)",
    nfm: L(
      '<FileTree id="file-tree-seed" entries={[',
      "  {",
      '    "path": "src/index.ts",',
      '    "change": "modified",',
      '    "note": "Wire the new route here."',
      "  },",
      "  {",
      '    "path": "src/routes/git.ts",',
      '    "change": "added"',
      "  }",
      "]} />",
    ),
  },
  {
    name: "json-explorer block (escaped JSON string expr)",
    nfm: '<Json id="json-explorer-seed" json={"{\\n  \\"id\\": \\"abc123\\",\\n  \\"active\\": true,\\n  \\"tags\\": [\\n    \\"alpha\\",\\n    \\"beta\\"\\n  ],\\n  \\"meta\\": {\\n    \\"count\\": 2,\\n    \\"owner\\": null\\n  }\\n}"} />',
  },
  {
    name: "annotated-code block (code expr + annotations array)",
    nfm: L(
      '<AnnotatedCode id="annotated-code-seed" language="ts" code={"export function resolveAuth(provider: string) {\\n  const cfg = providers[provider];\\n  return cfg.token;\\n}"} annotations={[',
      "  {",
      '    "lines": "2",',
      '    "label": "Lookup",',
      '    "note": "Resolves the provider config by key."',
      "  }",
      "]} />",
    ),
  },
  {
    name: "openapi-spec block (escaped whole-spec string expr)",
    nfm: '<OpenApi id="openapi-spec-seed" spec={"{\\n  \\"openapi\\": \\"3.0.0\\",\\n  \\"info\\": {\\n    \\"title\\": \\"Example API\\",\\n    \\"version\\": \\"1.0.0\\"\\n  },\\n  \\"tags\\": [\\n    {\\n      \\"name\\": \\"widgets\\",\\n      \\"description\\": \\"Manage widgets\\"\\n    }\\n  ],\\n  \\"paths\\": {\\n    \\"/widgets\\": {\\n      \\"get\\": {\\n        \\"tags\\": [\\n          \\"widgets\\"\\n        ],\\n        \\"summary\\": \\"List widgets\\",\\n        \\"responses\\": {\\n          \\"200\\": {\\n            \\"description\\": \\"OK\\"\\n          }\\n        }\\n      }\\n    }\\n  }\\n}"} />',
  },
];

describe("NFM ⇄ real TipTap editor round-trip", () => {
  for (const { name, nfm } of [...CASES, ...HARD_CASES, ...REGISTRY_CASES]) {
    it(`round-trips through the live schema: ${name}`, () => {
      expect(editorRoundTrip(nfm)).toBe(nfm);
    });
  }
});
