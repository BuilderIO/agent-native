import { describe, expect, it } from "vitest";

import { canonicalizeNfm, docToNfm, nfmToDoc } from "./nfm";
import {
  suggestionFormattingChanges,
  suggestionFormattingSourceSlice,
  suggestionFormattingSourceRange,
  suggestionMarkedSourceRanges,
} from "./suggestion-formatting";

const L = (...lines: string[]) => lines.join("\n");

describe("formatting source ranges", () => {
  it.each([
    ["**Echo**", "bold"],
    ["*Echo*", "italic"],
    ["~~Echo~~", "strike"],
    ["`Echo`", "code"],
    ['<span underline="true">Echo</span>', "notionSpan"],
    ["[Echo](https://example.test)", "link"],
  ])("recovers the mark values for a slice inside %s", (source, mark) => {
    const from = source.indexOf("ch");
    expect(suggestionFormattingSourceSlice(source, from, from + 2)).toEqual([
      {
        type: "text",
        text: "ch",
        marks: [expect.objectContaining({ type: mark })],
      },
    ]);
  });

  it("recovers sibling marked runs across a hard break", () => {
    const source = "**Prefix Upper**<br>**Lower suffix.**";
    const from = source.indexOf("Upper");
    const to = source.indexOf("Lower") + "Lower".length;
    expect(suggestionFormattingSourceSlice(source, from, to)).toEqual([
      {
        type: "text",
        text: "Upper",
        marks: [{ type: "bold" }],
      },
      { type: "break", text: "↵" },
      {
        type: "text",
        text: "Lower",
        marks: [{ type: "bold" }],
      },
    ]);
  });

  it("preserves paragraph boundaries and rejects markup or invalid ranges", () => {
    expect(suggestionFormattingSourceSlice("One\nTwo", 2, 5)).toEqual([
      { type: "text", text: "e", marks: [] },
      { type: "break", text: "↵" },
      { type: "text", text: "T", marks: [] },
    ]);
    expect(suggestionFormattingSourceSlice("**Echo**", 0, 1)).toBeNull();
    expect(suggestionFormattingSourceSlice("Echo", -1, 2)).toBeNull();
  });

  it("represents line-leading NFM indentation without admitting inline tabs", () => {
    expect(suggestionFormattingSourceSlice("\t**Echo**", 0, 9)).toEqual([
      { type: "indent", text: "⇥" },
      { type: "text", text: "Echo", marks: [{ type: "bold" }] },
    ]);
    expect(suggestionFormattingSourceSlice("\t\tEcho", 0, 2)).toEqual([
      { type: "indent", text: "⇥⇥" },
    ]);
    expect(suggestionFormattingSourceSlice("\t\tEcho", 1, 2)).toEqual([
      { type: "indent", text: "⇥" },
    ]);
    expect(suggestionFormattingSourceSlice("\t# **Echo**", 0, 11)).toEqual([
      { type: "indent", text: "⇥" },
      { type: "text", text: "Echo", marks: [{ type: "bold" }] },
    ]);
    expect(suggestionFormattingSourceSlice("One\n\tTwo", 3, 8)).toEqual([
      { type: "break", text: "↵" },
      { type: "indent", text: "⇥" },
      { type: "text", text: "Two", marks: [] },
    ]);
    expect(suggestionFormattingSourceSlice("A\tB", 1, 2)).toEqual([
      { type: "text", text: "\t", marks: [] },
    ]);
  });

  it("maps structural indentation to an explicit zero-width text boundary", () => {
    expect(suggestionFormattingSourceRange("\t**Echo**", 0, 1)).toMatchObject({
      from: 0,
      to: 0,
      fromAffinity: "left",
      toAffinity: "right",
    });
    expect(suggestionFormattingSourceRange("A\tB", 1, 2)).toMatchObject({
      from: 1,
      to: 2,
    });
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "maps a zero-width boundary before a parsed level-%s heading",
    (level) => {
      const source = `${"#".repeat(level)} Heading`;
      expect(suggestionFormattingSourceRange(source, 0, 0)).toMatchObject({
        from: 0,
        to: 0,
      });
    },
  );

  it("does not admit heading syntax as a nonempty slice or map other markup gaps", () => {
    expect(suggestionFormattingSourceSlice("# Heading", 0, 2)).toBeNull();
    expect(suggestionFormattingSourceRange("**Bold**", 1, 1)).toBeNull();
    expect(suggestionFormattingSourceRange("> Quote", 0, 0)).toBeNull();
    expect(suggestionFormattingSourceRange("- Item", 0, 0)).toBeNull();
  });

  it("keeps malformed and inline heading-like text in ordinary text runs", () => {
    expect(suggestionFormattingSourceSlice("#No heading", 0, 1)).toEqual([
      { type: "text", text: "#", marks: [] },
    ]);
    expect(
      suggestionFormattingSourceSlice("####### Not a heading", 0, 7),
    ).toEqual([{ type: "text", text: "#######", marks: [] }]);
    expect(suggestionFormattingSourceSlice("Text # Heading", 5, 7)).toEqual([
      { type: "text", text: "# ", marks: [] },
    ]);
  });

  it("maps a zero-width boundary before a parsed heading on a later line", () => {
    expect(
      suggestionFormattingSourceRange("Paragraph\n## Heading", 10, 10),
    ).toMatchObject({ from: 9, to: 9 });
  });

  it.each([
    "**Echo**",
    "*Echo*",
    "~~Echo~~",
    "`Echo`",
    '<span underline="true">Echo</span>',
    "[Echo](https://example.test)",
  ])("scopes %s to the selected text", (formatted) => {
    const before = "Echo\nNext paragraph.\nLast line.";
    const after = formatted + before.slice(4);
    expect(suggestionFormattingChanges(before, after)).toEqual([
      { before: { from: 0, to: 4 }, after: { from: 0, to: formatted.length } },
    ]);
    expect(suggestionFormattingChanges(after, before)).toEqual([
      { before: { from: 0, to: formatted.length }, after: { from: 0, to: 4 } },
    ]);
  });
  it("keeps independent mark changes separate", () => {
    expect(
      suggestionFormattingChanges(
        "One middle Two\nLast",
        "**One** middle *Two*\nLast",
      ),
    ).toEqual([
      { before: { from: 0, to: 3 }, after: { from: 0, to: 7 } },
      { before: { from: 11, to: 14 }, after: { from: 15, to: 20 } },
    ]);
  });
  it("includes an existing marked envelope when splitting it is required", () => {
    expect(
      suggestionFormattingChanges("**One Two** tail", "***One*** **Two** tail"),
    ).toEqual([{ before: { from: 0, to: 11 }, after: { from: 0, to: 17 } }]);
  });
  it("keeps a link destination edit inside the link", () => {
    const before = "See [Echo](https://old.test) later";
    const after = "See [Echo](https://new.test) later";
    expect(suggestionFormattingChanges(before, after)).toEqual([
      { before: { from: 4, to: 28 }, after: { from: 4, to: 28 } },
    ]);
  });
  it("does not classify text or paragraph changes as formatting", () => {
    expect(suggestionFormattingChanges("Echo", "Other")).toBeNull();
    expect(suggestionFormattingChanges("Echo\n", "Echo")).toBeNull();
  });

  it.each([
    { source: "Ec<br>ho", from: 2, to: 6 },
    { source: "Ec\nho", from: 2, to: 3 },
  ])(
    "maps supported structural source range $source",
    ({ source, from, to }) => {
      expect(suggestionFormattingSourceRange(source, from, to)).toMatchObject({
        from: 2,
        to: 2,
        fromAffinity: "left",
        toAffinity: "right",
      });
    },
  );

  it("preserves which side of a structural gap owns a zero-width boundary", () => {
    expect(suggestionFormattingSourceRange("One\nTwo", 3, 3)).toMatchObject({
      from: 3,
      fromAffinity: "left",
    });
    expect(suggestionFormattingSourceRange("One\nTwo", 4, 4)).toMatchObject({
      from: 3,
      fromAffinity: "right",
    });
    expect(suggestionFormattingSourceRange("Ec<br>ho", 2, 2)).toMatchObject({
      from: 2,
      fromAffinity: "left",
    });
    expect(suggestionFormattingSourceRange("Ec<br>ho", 6, 6)).toMatchObject({
      from: 2,
      fromAffinity: "right",
    });
  });

  it("maps only visible text payload positions inside marks", () => {
    expect(suggestionFormattingSourceRange("**Bold**", 3, 5)).toMatchObject({
      from: 1,
      to: 3,
    });
    expect(suggestionFormattingSourceRange("**A\\*B**", 3, 5)).toMatchObject({
      from: 1,
      to: 2,
    });
    expect(suggestionFormattingSourceRange("``a`b``", 3, 4)).toMatchObject({
      from: 1,
      to: 2,
    });
    const repeatedFence = "See ```a``b``` end";
    const repeatedFenceFrom = repeatedFence.indexOf("``", 7);
    expect(
      suggestionFormattingSourceRange(
        repeatedFence,
        repeatedFenceFrom,
        repeatedFenceFrom + 2,
      ),
    ).toMatchObject({ from: 5, to: 7 });
    expect(suggestionFormattingSourceRange("`` `edge` ``", 3, 9)).toMatchObject(
      { from: 0, to: 6 },
    );
    expect(suggestionFormattingSourceRange("`  edge  `", 2, 8)).toMatchObject({
      from: 0,
      to: 6,
    });
    expect(suggestionFormattingSourceRange(repeatedFence, 5, 6)).toBeNull();
    const link = "[same](https://same.test)";
    expect(suggestionFormattingSourceRange(link, 2, 4)).toMatchObject({
      from: 1,
      to: 3,
    });
    const hrefText = link.indexOf("same", 6);
    expect(
      suggestionFormattingSourceRange(link, hrefText, hrefText + 2),
    ).toBeNull();
    expect(suggestionFormattingSourceRange("**Bold**", 1, 2)).toBeNull();
  });
});

// A code fence emits its body unescaped and sizes its own delimiter from the
// body's longest backtick run, so the inline escaping every other run restores
// from silently made any page holding real code non-suggestable.
describe("code fences stay mappable", () => {
  const bold = "Intro **bold** text";
  const mappable = (source: string) => {
    // Only a fixpoint can be compared byte-for-byte against its own mapping.
    expect(canonicalizeNfm(source)).toBe(source);
    expect(docToNfm(nfmToDoc(source))).toBe(source);
    return suggestionMarkedSourceRanges(source);
  };

  it.each([
    ["angle brackets and braces", "<Foo bar={1} />"],
    ["a pipe", "ls | grep x"],
    ["an asterisk", "return x * 2"],
    ["brackets", "items[0]"],
    ["a dollar sign", "export A=$B"],
    ["a tilde", "cd ~/src"],
    ["a backslash", 'const path = "C:\\\\tmp";'],
    ["a caret", "2 ^ 8"],
    ["every escapable character", "\\ * ~ $ [ ] < > { } | ^"],
  ])("maps a code body containing %s", (_name, body) => {
    expect(mappable(L("```ts", body, "```"))).toEqual([]);
    expect(mappable(L(bold, "```ts", body, "```"))).toEqual([
      { from: 6, to: 14 },
    ]);
  });

  it("keeps the fence length a body backtick run forces", () => {
    const source = L("````", "a ```b``` c", "````");
    expect(mappable(source)).toEqual([]);
    expect(mappable(L(bold, "````", "a ```b``` c", "````"))).toEqual([
      { from: 6, to: 14 },
    ]);
  });

  it.each([
    [
      "a toggle",
      L(
        "<details>",
        "<summary>S</summary>",
        "\t```ts",
        "\tone",
        "\ttwo",
        "\t```",
        "</details>",
      ),
    ],
    [
      "a toggle heading",
      L('## S {toggle="true"}', "\t```ts", "\tone", "\ttwo", "\t```"),
    ],
    [
      "a callout",
      L(
        '<callout icon="i">',
        "\t```ts",
        "\tone",
        "\ttwo",
        "\t```",
        "</callout>",
      ),
    ],
    [
      "a column",
      L(
        "<columns>",
        "\t<column>",
        "\t\t```ts",
        "\t\tone",
        "\t\ttwo",
        "\t\t```",
        "\t</column>",
        "\t<column>",
        "\t\tRight",
        "\t</column>",
        "</columns>",
      ),
    ],
  ])(
    "reapplies the indentation of a multiline code body inside %s",
    (_name, nested) => {
      expect(mappable(nested)).toEqual([]);
      expect(mappable(`${bold}\n${nested}`)).toEqual([{ from: 6, to: 14 }]);
    },
  );

  it("maps source offsets inside an indented multiline code body", () => {
    const source = L(
      "<details>",
      "<summary>S</summary>",
      "\t```ts",
      "\tone",
      "\ttwo",
      "\t```",
      "</details>",
    );
    const two = source.indexOf("two");
    // A toggle's summary is an attribute, so the code body alone is the text
    // the editor sees; the second line's own tab is structural.
    expect(suggestionFormattingSourceRange(source, two, two + 3)).toMatchObject(
      {
        from: "one\ntwo".indexOf("two"),
        to: "one\ntwo".length,
      },
    );
  });

  it("still proposes a mark change on a page that holds a code fence", () => {
    const before = L("Echo other", "```ts", "const a = {};", "```");
    const after = L("**Echo** other", "```ts", "const a = {};", "```");
    expect(suggestionFormattingChanges(before, after)).toEqual([
      { before: { from: 0, to: 4 }, after: { from: 0, to: 8 } },
    ]);
  });

  it("maps past an astral character in a code body by code unit", () => {
    const source = L(
      "<details>",
      "<summary>S</summary>",
      "\t```ts",
      '\tconst a = "\u{1F600}";',
      "\tconst b = 2;",
      "\t```",
      "</details>",
    );
    const target = source.indexOf("const b");
    const text = 'const a = "\u{1F600}";\nconst b = 2;';
    expect(mappable(source)).toEqual([]);
    expect(
      suggestionFormattingSourceRange(source, target, target + 7),
    ).toMatchObject({
      from: text.indexOf("const b"),
      to: text.indexOf("const b") + 7,
    });
  });

  it("accounts for each fence independently when a page holds several", () => {
    const source = L(
      "```ts",
      "a = {0};",
      "b = <c>;",
      "```",
      "<details>",
      "<summary>S</summary>",
      "\t```py",
      "\tp = [1]",
      "\tq = {2}",
      "\t```",
      "\tInner **bold**",
      "</details>",
      "```sh",
      "ls | wc",
      "```",
      "End [link](https://e.test)",
    );
    expect(
      mappable(source)?.map((range) => source.slice(range.from, range.to)),
    ).toEqual(["**bold**", "[link](https://e.test)"]);
  });

  it("keeps a body that reads like its own fence line verbatim", () => {
    const source = L(
      "````",
      "```",
      "not a fence",
      "```",
      "````",
      "After **bold**",
    );
    expect(
      mappable(source)?.map((range) => source.slice(range.from, range.to)),
    ).toEqual(["**bold**"]);
  });

  it("leaves an empty code fence mappable", () => {
    expect(mappable(L(bold, "```", "", "```"))).toEqual([{ from: 6, to: 14 }]);
  });
});
// Nothing pinned which page shapes are suggestable, so a whole-page refusal
// could regress silently. Every source here is a canonical NFM fixpoint.
describe("page shapes stay suggestable", () => {
  const bold = "Intro **bold** text";
  const mappable = (source: string) => {
    expect(canonicalizeNfm(source)).toBe(source);
    expect(docToNfm(nfmToDoc(source))).toBe(source);
    return suggestionMarkedSourceRanges(source);
  };

  it.each([
    ["an image", "![A caption](https://cdn.example.com/x.png)"],
    ["an uncaptioned image", "![](https://cdn.example.com/x.png)"],
    ["an image URL holding parens", "![cap](https://x.com/a_(1).png)"],
    [
      "a toggle",
      L(
        "<details>",
        "<summary>A toggle</summary>",
        "\tHidden child",
        "</details>",
      ),
    ],
    [
      "a toggle heading",
      L(
        '## Toggle Heading Two {toggle="true"}',
        "\tChild under toggle heading",
      ),
    ],
    [
      "a toggle holding an image",
      L(
        "<details>",
        "<summary>A toggle</summary>",
        "\t![diagram](https://example.com/d.png)",
        "</details>",
      ),
    ],
    [
      "nested toggles",
      L(
        "<details>",
        "<summary>Outer</summary>",
        "\t<details>",
        "\t<summary>Inner</summary>",
        "\t\tinner child",
        "\t</details>",
        "</details>",
      ),
    ],
    [
      "a table",
      L(
        '<table header-row="true">',
        "<tr>",
        "<td>H1</td>",
        "<td>H2</td>",
        "</tr>",
        "<tr>",
        "<td>r1c1</td>",
        "<td>r1c2</td>",
        "</tr>",
        "</table>",
      ),
    ],
    [
      "a callout",
      L(
        '<callout icon="i" color="blue_bg">',
        "\tCallout body",
        "\t- callout item",
        "</callout>",
      ),
    ],
    [
      "columns",
      L(
        "<columns>",
        "\t<column>",
        "\t\tLeft column text",
        "\t</column>",
        "\t<column>",
        "\t\tRight column text",
        "\t</column>",
        "</columns>",
      ),
    ],
    ["a block equation", L("$$", "\\int_0^1 x^2 dx = \\frac{1}{3}", "$$")],
    [
      "a synced block",
      L(
        '<synced_block url="https://www.notion.so/s">',
        "\tShared content",
        "</synced_block>",
      ),
    ],
    ["a quote", "> A single real quote block"],
    ["a divider", "---"],
    ["an empty block", L("above", "<empty-block/>", "below")],
    ["a page atom", '<page url="https://www.notion.so/abc">Child Page</page>'],
    [
      "a mention",
      '<mention-page url="https://www.notion.so/abc">A Page</mention-page>',
    ],
    ["a table of contents", "<table_of_contents/>"],
  ])("keeps a page holding %s suggestable", (_name, construct) => {
    expect(mappable(`${bold}\n${construct}`)).toEqual([{ from: 6, to: 14 }]);
  });

  it("maps the reported page shape: images and toggles beside real code", () => {
    const source = L(
      "# Release notes",
      "Shipped **three** things this week.",
      "![Screenshot of the dashboard](https://cdn.example.com/shot.png)",
      "<details>",
      "<summary>Implementation detail</summary>",
      "\tWe changed the [loader](https://example.test).",
      "\t```tsx",
      "\tconst el = <Foo bar={1} />;",
      "\treturn el;",
      "\t```",
      "</details>",
      '<callout icon="i">',
      "\tSee the ~~old~~ notes.",
      "</callout>",
    );
    // Each marked run must still resolve to its own delimited source span,
    // with the code fence between them contributing none.
    expect(
      mappable(source)?.map((range) => source.slice(range.from, range.to)),
    ).toEqual(["**three**", "[loader](https://example.test)", "~~old~~"]);
  });
});
