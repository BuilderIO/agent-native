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
      "##### Heading Five",
      "###### Heading Six",
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

describe("bug fixes — reliability sweep", () => {
  // n1: raw containers (e.g. <meeting-notes>) must survive canonicalization
  // verbatim instead of being replaced by their tag name.
  describe("n1: raw container verbatim preservation", () => {
    const meetingNotes = L(
      "<meeting-notes>",
      "Attendees: Steve, Alex",
      "Notes: discussed the roadmap",
      "Decisions: ship it",
      "</meeting-notes>",
    );

    it("preserves the full body through one canonicalization pass", () => {
      const canon = canonicalizeNfm(meetingNotes);
      expect(canon).toBe(meetingNotes);
      expect(canon).toContain("Attendees: Steve, Alex");
      expect(canon).toContain("Decisions: ship it");
    });

    it("is a stable fixpoint under double canonicalization", () => {
      const once = canonicalizeNfm(meetingNotes);
      expect(canonicalizeNfm(once)).toBe(once);
    });

    it("does not collapse to the bare tag name", () => {
      expect(canonicalizeNfm(meetingNotes)).not.toBe(
        "<meeting-notes>meeting-notes</meeting-notes>",
      );
    });
  });

  // n5: inline mention labels must unescape on parse to mirror the escape on
  // serialize, or every cycle grows an extra "amp;" layer.
  describe("n5: mention label escaping symmetry", () => {
    it("does not double-escape an entity already in the label", () => {
      const nfm =
        '<mention-page url="https://www.notion.so/abc">R&amp;D Roadmap</mention-page>';
      expect(canonicalizeNfm(nfm)).toBe(nfm);
      expect(canonicalizeNfm(canonicalizeNfm(nfm))).toBe(nfm);
    });

    it("parses the label back to the unescaped form", () => {
      const doc = nfmToDoc(
        '<mention-page url="https://www.notion.so/abc">R&amp;D Roadmap</mention-page>',
      );
      const atom = doc.content[0].content?.[0];
      expect(atom?.attrs?.label).toBe("R&D Roadmap");
    });

    it("escapes a raw ampersand in a mention label on first canonicalization and then stays stable", () => {
      const raw =
        '<mention-page url="https://www.notion.so/abc">R&D</mention-page>';
      const canon = canonicalizeNfm(raw);
      expect(canon).toBe(
        '<mention-page url="https://www.notion.so/abc">R&amp;D</mention-page>',
      );
      expect(canonicalizeNfm(canon)).toBe(canon);
    });
  });

  // n6: backslash-escaped literal braces at the end of a line must not be
  // read as a block-attribute list.
  describe("n6: escape-aware splitBlockAttrs", () => {
    it("keeps a literal escaped brace in a paragraph as text, not a color attr", () => {
      const nfm = 'Set \\{color="red"\\}';
      const doc = nfmToDoc(nfm);
      const para = doc.content[0];
      expect(para.type).toBe("paragraph");
      expect(para.attrs?.color).toBeFalsy();
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("keeps a literal escaped toggle brace in a heading as text, not a toggle", () => {
      const nfm = 'T \\{toggle="true"\\}';
      const doc = nfmToDoc(nfm);
      expect(doc.content[0].type).toBe("paragraph");
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("keeps a literal escaped brace in a list item as text, not a color attr", () => {
      const nfm = '- x \\{color="blue"\\}';
      const doc = nfmToDoc(nfm);
      const item = doc.content[0].content?.[0];
      const para = item?.content?.[0];
      expect(para?.attrs?.color).toBeFalsy();
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("still parses real (unescaped) block attrs", () => {
      const nfm = 'Hello {color="red"}';
      const doc = nfmToDoc(nfm);
      expect(doc.content[0].attrs?.color).toBe("red");
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });
  });

  // n7: a code block whose body contains a bare ``` line must not be split
  // apart; fences must use CommonMark-style variable length.
  describe("n7: variable-length code fences", () => {
    it("keeps a ``` line inside the code body intact", () => {
      const nfm = L("````markdown", "example:", "```", "inner", "````");
      const doc = nfmToDoc(nfm);
      expect(doc.content.length).toBe(1);
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[0].attrs?.language).toBe("markdown");
      const text = doc.content[0].content?.[0]?.text;
      expect(text).toBe("example:\n```\ninner");
    });

    it("parses a 4-backtick fence without swallowing following blocks", () => {
      const nfm = L("````js", "code", "````", "After");
      const doc = nfmToDoc(nfm);
      expect(doc.content.length).toBe(2);
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[0].attrs?.language).toBe("js");
      expect(doc.content[1].type).toBe("paragraph");
    });

    it("round-trips a code block whose body contains a bare fence line", () => {
      const doc = nfmToDoc(
        L("````markdown", "example:", "```", "inner", "````"),
      );
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("codeBlock");
      expect(doc2.content[0].content?.[0]?.text).toBe(
        doc.content[0].content?.[0]?.text,
      );
    });

    it("canonicalization is idempotent for fence-containing bodies", () => {
      const nfm = L("````markdown", "example:", "```", "inner", "````");
      const once = canonicalizeNfm(nfm);
      expect(canonicalizeNfm(once)).toBe(once);
    });
  });

  // n8: table cells must preserve every child block, not just the first
  // paragraph.
  describe("n8: multi-block table cells", () => {
    it("serializes both paragraphs in a cell joined by <br>", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: {
              headerRow: false,
              headerColumn: false,
              fitPageWidth: false,
            },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "first" }],
                      },
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "second" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as any;
      const nfm = docToNfm(doc);
      expect(nfm).toContain("<td>first<br>second</td>");
    });

    it("round-trips the multi-paragraph cell back to two paragraphs", () => {
      const nfm = L(
        "<table>",
        "<tr>",
        "<td>first<br>second</td>",
        "</tr>",
        "</table>",
      );
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("does not drop a cell whose only child is a bullet list", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: {
              headerRow: false,
              headerColumn: false,
              fitPageWidth: false,
            },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "bulletList",
                        content: [
                          {
                            type: "listItem",
                            content: [
                              {
                                type: "paragraph",
                                content: [{ type: "text", text: "one" }],
                              },
                            ],
                          },
                          {
                            type: "listItem",
                            content: [
                              {
                                type: "paragraph",
                                content: [{ type: "text", text: "two" }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as any;
      const nfm = docToNfm(doc);
      expect(nfm).not.toContain("<td></td>");
      expect(nfm).toContain("one");
      expect(nfm).toContain("two");
    });
  });

  // n9: a plain "underline" mark (StarterKit Cmd+U) must serialize to the
  // same <span underline="true"> form notionSpan already round-trips.
  describe("n9: plain underline mark serialization", () => {
    it('serializes a bare underline mark to <span underline="true">', () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x", marks: [{ type: "underline" }] },
            ],
          },
        ],
      } as any;
      expect(docToNfm(doc)).toBe('<span underline="true">x</span>');
    });

    it("merges a bare underline mark with an existing notionSpan color", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [
                  { type: "underline" },
                  {
                    type: "notionSpan",
                    attrs: { color: "red", bgColor: null, underline: null },
                  },
                ],
              },
            ],
          },
        ],
      } as any;
      expect(docToNfm(doc)).toBe('<span color="red" underline="true">x</span>');
    });

    it("keeps the underlined fixpoint stable under canonicalization", () => {
      const nfm = '<span underline="true">u</span>';
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });
  });

  // n17: link/image parsing must balance parens and respect escapes so URLs
  // with literal parens and alts with escaped brackets survive.
  describe("n17: paren- and escape-aware link/image parsing", () => {
    it("keeps the full href for a link URL containing parens", () => {
      const nfm = "[wiki](https://en.wikipedia.org/wiki/Foo_(bar))";
      const doc = nfmToDoc(nfm);
      const para = doc.content[0];
      const linkNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "link"),
      );
      const link = linkNode?.marks?.find((m) => m.type === "link");
      expect(link?.attrs?.href).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
      expect(para.content?.length).toBe(1);
    });

    it("parses an image whose src contains parens", () => {
      const nfm = "![cap](https://x.com/a_(1).png)";
      const doc = nfmToDoc(nfm);
      expect(doc.content[0].type).toBe("image");
      expect(doc.content[0].attrs?.src).toBe("https://x.com/a_(1).png");
      expect(doc.content[0].attrs?.alt).toBe("cap");
    });

    it("round-trips an image whose alt contains an escaped bracket", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://x.com/x.png", alt: "diagram [v2]" },
          },
        ],
      } as any;
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("image");
      expect(doc2.content[0].attrs?.alt).toBe("diagram [v2]");
    });

    it("keeps a link with a parenthesized URL a byte-stable fixpoint", () => {
      const nfm = "[wiki](https://en.wikipedia.org/wiki/Foo_(bar))";
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });
  });

  // n18: toggle/details summaries must round-trip verbatim (as raw NFM
  // source), not be escaped on write after being stored unescaped.
  describe("n18: toggle summary verbatim round-trip", () => {
    it("keeps inline formatting inside a <details><summary> intact", () => {
      const nfm = L(
        "<details>",
        "<summary>**bold** [link](https://x) `code`</summary>",
        "\tBody",
        "</details>",
      );
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("keeps inline formatting inside a toggle heading summary intact", () => {
      const nfm = L('# **bold** title {toggle="true"}', "\tChild");
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("leaves an already-escaped literal summary unchanged", () => {
      const nfm = L(
        "<details>",
        "<summary>\\*not bold\\*</summary>",
        "\tBody",
        "</details>",
      );
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });
  });

  // n26: a toggle heading's summary shares one serialized line with the real
  // trailing `{toggle="true" ...}` attrs. Notion-emitted summaries (raw NFM,
  // round-tripped verbatim) never end in an odd backslash run — but the
  // editor's plain summary <input> writes untouched plain text into the same
  // `summary` attr, and a plain-text summary ending in an odd number of
  // backslashes (e.g. a Windows path) made the parser treat the whole
  // `{toggle="true"}` suffix as escaped literal text, degrading the toggle
  // into a heading containing that literal attrs string.
  describe("n26: toggle-heading summary corruption resistance", () => {
    const headingToggleDoc = (summary: string, headingLevel = 2): any => ({
      type: "doc",
      content: [
        {
          type: "notionToggle",
          attrs: { summary, headingLevel, open: true, color: null },
          content: [{ type: "paragraph" }],
        },
      ],
    });

    it("round-trips a heading-toggle summary ending in a single backslash", () => {
      const doc = headingToggleDoc("b\\");
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("notionToggle");
      expect(doc2.content[0].attrs?.summary).toBe("b\\");
      expect(doc2.content[0].attrs?.headingLevel).toBe(2);
      // The real toggle attrs must not have degraded into literal text.
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("round-trips an editor-typed Windows path summary (trailing backslash)", () => {
      const doc = headingToggleDoc("C:\\path\\", 3);
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("notionToggle");
      expect(doc2.content[0].attrs?.summary).toBe("C:\\path\\");
      expect(doc2.content[0].attrs?.headingLevel).toBe(3);
    });

    it("round-trips a summary containing an attr-lookalike sequence", () => {
      const doc = headingToggleDoc('hello {color="red"}', 2);
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("notionToggle");
      expect(doc2.content[0].attrs?.summary).toBe('hello {color="red"}');
    });

    it("round-trips a summary containing backticks", () => {
      const doc = headingToggleDoc("some `code` here", 2);
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].attrs?.summary).toBe("some `code` here");
    });

    it("is stable under a second round trip", () => {
      const doc = headingToggleDoc("b\\", 2);
      const nfm1 = docToNfm(doc);
      const nfm2 = docToNfm(nfmToDoc(nfm1));
      expect(nfm2).toBe(nfm1);
    });

    it("still keeps a Notion-emitted heading-toggle summary a byte-stable fixpoint", () => {
      const nfm = L('# **bold** title {toggle="true"}', "\tChild");
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("still keeps a plain (no-backslash) heading-toggle summary a byte-stable fixpoint", () => {
      const nfm = L(
        '## Toggle Heading Two {toggle="true"}',
        "\tChild under toggle heading",
      );
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("does not affect the unrelated <details><summary> form with a trailing backslash", () => {
      const doc = headingToggleDoc("C:\\path\\", 0);
      const nfm = docToNfm(doc);
      expect(nfm).toContain("<summary>C:\\path\\</summary>");
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].attrs?.summary).toBe("C:\\path\\");
    });
  });

  // n19: an unclosed container tag must not silently swallow every
  // following same-indent line to EOF.
  describe("n19: unterminated container fallback", () => {
    it("preserves content after an unclosed <callout>", () => {
      const nfm = L('<callout icon="x">', "Hello after", "World after");
      const canon = canonicalizeNfm(nfm);
      expect(canon).toContain("Hello after");
      expect(canon).toContain("World after");
    });

    it("preserves content after an unclosed <details>", () => {
      const nfm = L("<details>", "<summary>S</summary>", "Body", "After");
      const canon = canonicalizeNfm(nfm);
      expect(canon).toContain("After");
    });

    it("preserves content after an unclosed <table>", () => {
      const nfm = L(
        '<table header-row="true">',
        "<tr>",
        "<td>a</td>",
        "</tr>",
        "After",
      );
      const canon = canonicalizeNfm(nfm);
      expect(canon).toContain("After");
    });

    it("preserves content after an unclosed <meeting-notes>", () => {
      const nfm = L("<meeting-notes>", "Notes here", "After");
      const canon = canonicalizeNfm(nfm);
      expect(canon).toContain("After");
    });

    it("is a stable fixpoint after the paragraph-degrade fallback", () => {
      const nfm = L('<callout icon="x">', "Hello after", "World after");
      const once = canonicalizeNfm(nfm);
      expect(canonicalizeNfm(once)).toBe(once);
    });
  });

  // n20: canonicalization must never apply the editor-only
  // terminal-filler-paragraph trim, or intentional Notion empty blocks are
  // deleted (and nesting must not apply the trim at all).
  describe("n20: canonicalization never trims intentional empty blocks", () => {
    it("keeps a trailing <empty-block/> after a heading", () => {
      const nfm = L("# H", "<empty-block/>");
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("keeps a trailing <empty-block/> after a list", () => {
      const nfm = L("- item", "<empty-block/>");
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("keeps a trailing <empty-block/> nested inside a callout", () => {
      const nfm = L(
        '<callout icon="x">',
        "\tSome text",
        "\t<empty-block/>",
        "</callout>",
      );
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it("docToNfm (direct editor call) still drops its own terminal filler paragraph", () => {
      // This is the editor-only heuristic docToNfm's direct callers rely on;
      // canonicalizeNfm must not apply it (see tests above), but docToNfm on
      // its own must keep doing so.
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
  });

  // n21: a paragraph whose TEXT (not raw NFM source) starts with a
  // block-marker pattern must round-trip as a paragraph, not be reparsed as
  // that block type. This is what the editor produces from a plain-text
  // paste — a real `paragraph` PM node whose text happens to start with
  // "- ", "# ", "1. ", or "---".
  describe("n21: leading block-marker escaping in paragraphs", () => {
    const cases = [
      "- not a list",
      "# not heading",
      "---",
      "1. not list",
      "1) not list",
    ];
    for (const text of cases) {
      it(`round-trips a plain-text paragraph starting with "${text}"`, () => {
        const doc: any = {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        };
        const nfm = docToNfm(doc);
        // Re-parsing the serialized NFM must come back as a paragraph with
        // the exact original text, not as list/heading/divider structure.
        const doc2 = nfmToDoc(nfm);
        expect(doc2.content[0].type).toBe("paragraph");
        const rendered = doc2.content[0].content
          ?.map((n: any) => n.text)
          .join("");
        expect(rendered).toBe(text);
        // And the round trip is itself stable.
        expect(docToNfm(doc2)).toBe(nfm);
      });

      it(`is a stable canonicalization fixpoint once escaped for "${text}"`, () => {
        const doc: any = {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        };
        const nfm = docToNfm(doc);
        expect(canonicalizeNfm(nfm)).toBe(nfm);
      });
    }
  });

  // n22: inline code spans containing backticks must use a CommonMark-style
  // variable-length delimiter instead of corrupting/splitting on write.
  describe("n22: backtick-safe inline code spans", () => {
    it("serializes code text containing a single backtick without truncation", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "a`b", marks: [{ type: "code" }] }],
          },
        ],
      } as any;
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      const textNode = doc2.content[0].content?.[0];
      expect(textNode?.marks?.[0]?.type).toBe("code");
      expect(textNode?.text).toBe("a`b");
    });

    it("is stable under a second round trip (no growing backslashes/backticks)", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "a`b", marks: [{ type: "code" }] }],
          },
        ],
      } as any;
      const nfm1 = docToNfm(doc);
      const nfm2 = docToNfm(nfmToDoc(nfm1));
      expect(nfm2).toBe(nfm1);
    });

    it("parses a raw double-backtick-delimited code span", () => {
      const doc = nfmToDoc("``a`b``");
      const textNode = doc.content[0].content?.[0];
      expect(textNode?.marks?.[0]?.type).toBe("code");
      expect(textNode?.text).toBe("a`b");
    });

    it("round-trips code text starting and ending with a backtick", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "`x`", marks: [{ type: "code" }] }],
          },
        ],
      } as any;
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      const textNode = doc2.content[0].content?.[0];
      expect(textNode?.text).toBe("`x`");
    });
  });

  // n23: the divider parser trims the line before testing
  // (`dedent.trim()` against `/^(---+|\*\*\*+|___+)$/`), so a paragraph whose
  // text is only a divider-lookalike PLUS leading/trailing whitespace must be
  // escape-checked against that same trimmed form, or it silently reparses as
  // a horizontalRule and the whitespace-padded text is lost.
  describe("n23: divider-lookalike paragraphs with padding whitespace", () => {
    const paragraphOnly = (text: string) => {
      const doc: any = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      };
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("paragraph");
      const rendered = doc2.content[0].content
        ?.map((n: any) => n.text)
        .join("");
      expect(rendered).toBe(text);
      expect(docToNfm(doc2)).toBe(nfm);
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    };

    it('round-trips "--- " (trailing space) as a paragraph', () => {
      paragraphOnly("--- ");
    });

    it('round-trips "  ---" (leading spaces) as a paragraph', () => {
      paragraphOnly("  ---");
    });

    it('round-trips "*** " (trailing space) as a paragraph', () => {
      paragraphOnly("*** ");
    });

    it("still round-trips a real divider as horizontalRule", () => {
      const nfm = "---";
      expect(canonicalizeNfm(nfm)).toBe(nfm);
      const doc = nfmToDoc(nfm);
      expect(doc.content[0].type).toBe("horizontalRule");
      expect(docToNfm(doc)).toBe(nfm);
    });
  });

  // n24: link/image URLs with UNBALANCED parens must be escaped on write so
  // findMatchingParenClose (paren-balance-aware) doesn't truncate the
  // destination on the next parse; URLs with BALANCED parens stay verbatim
  // to preserve Notion's byte-exact fixpoint (e.g. Wikipedia disambiguation
  // links, which Notion never escapes).
  describe("n24: unbalanced-paren URL escaping in links and images", () => {
    it("round-trips a link href containing an unbalanced closing paren", () => {
      const doc: any = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "t",
                marks: [{ type: "link", attrs: { href: "https://x.com/a)b" } }],
              },
            ],
          },
        ],
      };
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      const linkNode = doc2.content[0].content?.[0];
      expect(linkNode?.marks?.[0]?.type).toBe("link");
      expect(linkNode?.marks?.[0]?.attrs?.href).toBe("https://x.com/a)b");
      expect(linkNode?.text).toBe("t");
      // No trailing/extra text node absorbing the truncated remainder.
      expect(doc2.content[0].content?.length).toBe(1);
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("round-trips a link href containing an unbalanced opening paren", () => {
      const doc: any = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "t",
                marks: [{ type: "link", attrs: { href: "https://x.com/a(b" } }],
              },
            ],
          },
        ],
      };
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("paragraph");
      const linkNode = doc2.content[0].content?.[0];
      expect(linkNode?.marks?.[0]?.type).toBe("link");
      expect(linkNode?.marks?.[0]?.attrs?.href).toBe("https://x.com/a(b");
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("keeps a balanced-paren link href a byte-stable fixpoint (unchanged)", () => {
      const nfm = "[wiki](https://en.wikipedia.org/wiki/Foo_(bar))";
      expect(canonicalizeNfm(nfm)).toBe(nfm);
      const doc = nfmToDoc(nfm);
      expect(docToNfm(doc)).toBe(nfm);
    });

    it("round-trips an image whose src contains an unbalanced closing paren", () => {
      const doc: any = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://x.com/a)b.png", alt: "hi" },
          },
        ],
      };
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("image");
      expect(doc2.content[0].attrs?.src).toBe("https://x.com/a)b.png");
      expect(doc2.content[0].attrs?.alt).toBe("hi");
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("round-trips an image whose alt contains a bracket alongside an unbalanced src", () => {
      const doc: any = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://x.com/a(b.png", alt: "diagram [v2]" },
          },
        ],
      };
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].type).toBe("image");
      expect(doc2.content[0].attrs?.src).toBe("https://x.com/a(b.png");
      expect(doc2.content[0].attrs?.alt).toBe("diagram [v2]");
      expect(docToNfm(doc2)).toBe(nfm);
    });
  });

  // n25: inline-code space padding must be symmetric between serialize and
  // parse. The serializer must pad with a space on each side whenever the
  // content starts OR ends with a backtick OR a space (not just backtick),
  // and the parser must strip exactly one pad space per side only when both
  // ends are padded and the content isn't entirely spaces — otherwise a
  // leading/trailing space in the actual content is indistinguishable from
  // serializer-added padding and gets silently deleted on round trip.
  describe("n25: inline-code space padding symmetry", () => {
    const codeDoc = (text: string): any => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text, marks: [{ type: "code" }] }],
        },
      ],
    });

    it("round-trips code text with a leading space and an interior backtick", () => {
      const doc = codeDoc(" `x ");
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      const textNode = doc2.content[0].content?.[0];
      expect(textNode?.marks?.[0]?.type).toBe("code");
      expect(textNode?.text).toBe(" `x ");
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("round-trips code text with only a leading space", () => {
      const doc = codeDoc(" x");
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      const textNode = doc2.content[0].content?.[0];
      expect(textNode?.text).toBe(" x");
    });

    it("round-trips code text with only a trailing space", () => {
      const doc = codeDoc("x ");
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      const textNode = doc2.content[0].content?.[0];
      expect(textNode?.text).toBe("x ");
    });

    it("still round-trips a plain code span with no padding needed", () => {
      const doc = codeDoc("x");
      const nfm = docToNfm(doc);
      expect(nfm).toBe("`x`");
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].content?.[0]?.text).toBe("x");
    });

    it("still round-trips code text starting and ending with a backtick", () => {
      const doc = codeDoc("`x`");
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].content?.[0]?.text).toBe("`x`");
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("still round-trips a code span containing its own backtick (no leading/trailing space)", () => {
      const doc = codeDoc("a`b");
      const nfm = docToNfm(doc);
      const doc2 = nfmToDoc(nfm);
      expect(doc2.content[0].content?.[0]?.text).toBe("a`b");
      expect(docToNfm(doc2)).toBe(nfm);
    });

    it("is stable under a second round trip", () => {
      const doc = codeDoc(" `x ");
      const nfm1 = docToNfm(doc);
      const nfm2 = docToNfm(nfmToDoc(nfm1));
      expect(nfm2).toBe(nfm1);
    });
  });
});
