import { describe, expect, it } from "vitest";

import {
  canonicalizeNfm,
  collapseExactRepeatedNfm,
  docToNfm,
  nfmToDoc,
} from "./nfm";

/**
 * Every fixture below is a byte-exact sample of what Notion's
 * `/pages/{id}/markdown` API actually emits (captured from a live round-trip
 * probe). The whole contract of the converter is that these are FIXPOINTS:
 * canonicalizeNfm(x) === x and docToNfm(nfmToDoc(x)) === x. If a fixture is not
 * a fixpoint, a pull/edit/push cycle would mutate the document — the exact drift
 * bug this module exists to prevent.
 */
const L = (...lines: string[]) => lines.join("\n");

describe("collapseExactRepeatedNfm", () => {
  it("collapses an exact repeated document emitted by a transient collab duplicate", () => {
    const once = L(
      "Alpha",
      "Beta",
      '<page id="abc">Untitled</page>',
      "<empty-block/>",
      "Gamma",
    );

    expect(
      collapseExactRepeatedNfm(`${once}\n${once}`, {
        requiredText: 'id="abc"',
      }),
    ).toBe(once);
    expect(
      collapseExactRepeatedNfm(`${once}\n${once}`, {
        requiredText: 'id="missing"',
      }),
    ).toBe(`${once}\n${once}`);
    expect(
      collapseExactRepeatedNfm(`${once}\nDifferent`, {
        requiredText: 'id="abc"',
      }),
    ).toBe(`${once}\nDifferent`);
  });

  it("does not collapse ordinary repeated content without a caller marker", () => {
    expect(
      collapseExactRepeatedNfm(L("A", "B", "A", "B"), {
        requiredText: 'id="new-page"',
      }),
    ).toBe(L("A", "B", "A", "B"));
  });
});

const FIXTURES: Array<{ name: string; nfm: string }> = [
  { name: "plain paragraph", nfm: "Just a paragraph." },
  {
    name: "inline marks",
    nfm: 'Intro with **bold**, *italic*, ~~strike~~, `code`, <span underline="true">underline</span>, <span color="red">red text</span>, <span color="blue_bg">blue bg</span>, a [link](https://example.com), and inline math $`E = mc^2`$.',
  },
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
  { name: "quote with color", nfm: '> Quoted {color="gray"}' },
  {
    name: "nested bullets",
    nfm: L("- bullet one", "\t- nested bullet", "- bullet two"),
  },
  { name: "numbered list", nfm: L("1. first", "2. second", "3. third") },
  { name: "todo list", nfm: L("- [ ] unchecked todo", "- [x] checked todo") },
  {
    name: "callout with nested list",
    nfm: L(
      '<callout icon="💡" color="blue_bg">',
      "\tCallout with **bold** and a nested list:",
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
    name: "code block (literal, unescaped)",
    nfm: L("```python", "def f(x):", "    return x < 3 and x * 2", "```"),
  },
  {
    name: "block equation",
    nfm: L("$$", "\\int_0^1 x^2 dx = \\frac{1}{3}", "$$"),
  },
  {
    name: "literal special chars (escaped)",
    nfm: "Text with literal special chars: a \\< b, 2 \\* 3, x_y, price \\$5, \\[bracket\\], \\{brace\\}.",
  },
  { name: "divider", nfm: "---" },
  { name: "empty block", nfm: L("above", "<empty-block/>", "below") },
  {
    name: "consecutive empty blocks",
    nfm: L("first", "<empty-block/>", "<empty-block/>", "last"),
  },
  {
    name: "page atom",
    nfm: '<page url="https://www.notion.so/abc">Child Page</page>',
  },
  { name: "table of contents atom", nfm: "<table_of_contents/>" },
  { name: "image", nfm: "![A caption](https://cdn.example.com/x.png)" },
  {
    name: "mention inline",
    nfm: '<mention-page url="https://www.notion.so/abc">A Page</mention-page>',
  },
  {
    name: "mention date self-closing",
    nfm: '<mention-date start="2026-06-01"/>',
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
    name: "visual-indented paragraphs",
    nfm: L("root", "\tindented once", "\t\tindented twice"),
  },
  {
    name: "nested toggles",
    nfm: L(
      "<details>",
      "<summary>Outer</summary>",
      "\t<details>",
      "\t<summary>Inner</summary>",
      "\t\tinner child",
      "\t</details>",
      "</details>",
    ),
  },
];

describe("nfm converter — canonical fixpoints", () => {
  for (const { name, nfm } of FIXTURES) {
    it(`is a fixpoint: ${name}`, () => {
      expect(canonicalizeNfm(nfm)).toBe(nfm);
      expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
    });
  }

  it("the whole probe document round-trips byte-exact", () => {
    const doc = FIXTURES.map((f) => f.nfm).join("\n");
    expect(canonicalizeNfm(doc)).toBe(doc);
  });

  it("is idempotent under double canonicalization", () => {
    const doc = FIXTURES.map((f) => f.nfm).join("\n");
    expect(canonicalizeNfm(canonicalizeNfm(doc))).toBe(canonicalizeNfm(doc));
  });

  it("drops the terminal empty paragraph TipTap adds after non-paragraph blocks", () => {
    expect(
      docToNfm({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, color: null, indent: 0 },
            content: [{ type: "text", text: "Heading" }],
          },
          { type: "paragraph", attrs: { color: null, indent: 0 } },
        ],
      }),
    ).toBe("## Heading");
  });

  it("preserves interior empty paragraphs", () => {
    expect(
      docToNfm({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Top" }] },
          { type: "paragraph", attrs: { color: null, indent: 0 } },
          { type: "paragraph", content: [{ type: "text", text: "Bottom" }] },
        ],
      }),
    ).toBe("Top\n<empty-block/>\nBottom");
  });
});

describe("nfm converter — structural parsing", () => {
  it("parses a toggle heading into notionToggle with headingLevel", () => {
    const doc = nfmToDoc('## H {toggle="true"}\n\tchild');
    expect(doc.content[0].type).toBe("notionToggle");
    expect(doc.content[0].attrs?.headingLevel).toBe(2);
    expect(doc.content[0].attrs?.summary).toBe("H");
    expect(doc.content[0].content?.[0].type).toBe("paragraph");
  });

  it("keeps a real quote distinct from indentation", () => {
    const quote = nfmToDoc("> quote");
    expect(quote.content[0].type).toBe("blockquote");
    const indent = nfmToDoc("root\n\tchild");
    expect(indent.content[1].type).toBe("paragraph");
    expect(indent.content[1].attrs?.indent).toBe(1);
  });

  it("models a synced block as a container (children preserved)", () => {
    const doc = nfmToDoc('<synced_block url="u">\n\tkid\n</synced_block>');
    expect(doc.content[0].type).toBe("notionSyncedBlock");
    expect(doc.content[0].content?.[0].type).toBe("paragraph");
  });

  it("models local MDX components as source-preserving atoms", () => {
    const source = L(
      '<FrameworkTabs framework="react" tone="success">',
      "Rendered child content from MDX.",
      "</FrameworkTabs>",
    );
    const doc = nfmToDoc(source);
    expect(doc.content[0].type).toBe("localMdxComponent");
    expect(doc.content[0].attrs?.name).toBe("FrameworkTabs");
    expect(JSON.parse(String(doc.content[0].attrs?.propsJson))).toEqual({
      framework: "react",
      tone: "success",
    });
    expect(doc.content[0].attrs?.children).toBe(
      "Rendered child content from MDX.",
    );
    expect(docToNfm(doc)).toBe(source);
  });

  it("models content references as source-preserving atoms", () => {
    const source =
      '<ContentReference sourcePath="../symbols/docs-tip.builder.mdx" title="Docs Tip" />';
    const doc = nfmToDoc(source);
    expect(doc.content[0].type).toBe("contentReference");
    expect(doc.content[0].attrs?.sourcePath).toBe(
      "../symbols/docs-tip.builder.mdx",
    );
    expect(doc.content[0].attrs?.title).toBe("Docs Tip");
    expect(docToNfm(doc)).toBe(source);
  });

  it("marks local MDX components with JSX props as unsupported previews", () => {
    const source = "<Chart compact columns={3} items={[1, 2, 3]} />";
    const doc = nfmToDoc(source);
    expect(doc.content[0].type).toBe("localMdxComponent");
    expect(doc.content[0].attrs?.name).toBe("Chart");
    expect(doc.content[0].attrs?.unsupportedProps).toBe(true);
    expect(docToNfm(doc)).toBe(source);
  });

  it("parses table header cells and cell colors", () => {
    const doc = nfmToDoc(
      '<table header-row="true">\n<tr>\n<td>A</td>\n</tr>\n<tr>\n<td color="red">b</td>\n</tr>\n</table>',
    );
    const table = doc.content[0];
    expect(table.type).toBe("table");
    expect(table.content?.[0].content?.[0].type).toBe("tableHeader");
    expect(table.content?.[1].content?.[0].type).toBe("tableCell");
    expect(table.content?.[1].content?.[0].attrs?.color).toBe("red");
  });
});

const HARD_FIXTURES: Array<{ name: string; nfm: string }> = [
  { name: "colored bullet item", nfm: '- colored item {color="green"}' },
  { name: "colored todo item", nfm: '- [x] done {color="blue_bg"}' },
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
    name: "deeply nested bullets",
    nfm: L("- a", "\t- b", "\t\t- c", "\t\t\t- d", "- e"),
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
  { name: "combined bold italic strike", nfm: "~~***everything***~~" },
  { name: "bold link", nfm: "[**important**](https://x.com)" },
  { name: "code with specials inside", nfm: "`a < b && c[0]`" },
  { name: "underline + color span", nfm: '<span color="purple">u</span>' },
  {
    name: "list with nested paragraph child",
    nfm: L("- item", "\tnested paragraph under the item"),
  },
  {
    name: "numbered list starting at 3",
    nfm: L("3. three", "4. four"),
  },
  {
    name: "audio and file blocks",
    nfm: L(
      '<audio src="https://x.com/a.mp3">My audio</audio>',
      '<file src="https://x.com/f.pdf">A file</file>',
    ),
  },
  {
    name: "synced block reference",
    nfm: L(
      '<synced_block_reference url="https://www.notion.so/r">',
      "\tref content",
      "</synced_block_reference>",
    ),
  },
];

describe("nfm converter — hardening fixpoints", () => {
  for (const { name, nfm } of HARD_FIXTURES) {
    it(`is a fixpoint: ${name}`, () => {
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });
  }

  it("a large mixed torture document is a stable fixpoint", () => {
    const doc = [...FIXTURES, ...HARD_FIXTURES].map((f) => f.nfm).join("\n");
    const once = canonicalizeNfm(doc);
    expect(canonicalizeNfm(once)).toBe(once);
  });
});

describe("nfm converter — inline round-trips", () => {
  const inlineCases = [
    "**bold**",
    "*italic*",
    "***bold italic***",
    "~~strike~~",
    "`code span`",
    "`multi<br>line code`",
    '<span underline="true">u</span>',
    '<span color="purple">colored</span>',
    '<span color="green_bg">bg</span>',
    "[text](https://x.com)",
    "[**bold link**](https://x.com)",
    "before $`a^2 + b^2`$ after",
    "line one<br>line two",
    "literal \\* not italic and a \\[ bracket",
  ];
  for (const text of inlineCases) {
    it(`inline fixpoint: ${text}`, () => {
      expect(canonicalizeNfm(text)).toBe(text);
    });
  }
});
