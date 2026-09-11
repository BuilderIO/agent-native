import { describe, expect, it } from "vitest";

import {
  suggestionFormattingChanges,
  suggestionFormattingSourceSlice,
  suggestionFormattingSourceRange,
} from "./suggestion-formatting";

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
