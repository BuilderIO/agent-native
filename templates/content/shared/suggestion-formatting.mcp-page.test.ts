import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { resolveDocumentTextEdits } from "./document-text-edits";
import { docToNfm, nfmToDoc } from "./nfm";
import {
  markdownSuggestionOperation,
  markdownSuggestionOperations,
  markdownSuggestionOperationsForFindReplace,
} from "./suggestion-diff";
import {
  suggestionFormattingChanges,
  suggestionFormattingSourceRange,
  suggestionFormattingSourceSlice,
  suggestionMarkedSourceRanges,
  SuggestionFormattingMappingError,
} from "./suggestion-formatting";

// Byte-exact body from page zX4TjUz60f47, revision body:0:sha256:a3aea9bdfef2b84fe3b4ce6b8538259ab1f3b8b20696e3fcad10ee718759a3f7.
const source =
  "We are very excited to finally be able to share with all of you something that we have been quietly working on for quite a long time here at Lantern Type, which is a brand new typeface family that we have decided to call Wrenfield, and which we really think you are going to love.\n\nWrenfield is a variable serif with two axes, weight and optical size. At display sizes it tightens up, with sharp wedge serifs and a tall, narrow f. At text sizes it opens up, with sturdier hairlines and looser spacing, so one file can set a magazine cover and the story underneath it.\n\nWe drew it over three winters, starting from the captions in a 1920s bird guide we found in a secondhand shop. The wren on the cover gave it its name.\n\n## Details\n\n- **Release:** Wrenfield goes on sale Thursday, October 3.\n- **Styles:** Light to Black, with matching italics.\n- **Licensing:** Desktop, web, and app licenses, starting at $60.";

const attemptedEdits = [
  { find: "in a secondhand shop", replace: "in a second-hand shop" },
  { find: "for quite a long time", replace: "for a long time" },
];

function suggestDocumentEdit(
  before: string,
  edit: (typeof attemptedEdits)[number],
) {
  const resolved = resolveDocumentTextEdits(before, [edit]);
  if (!resolved.ok)
    throw new Error(`Unexpected target error: ${resolved.error.kind}`);
  const operations = markdownSuggestionOperationsForFindReplace({
    before,
    ...edit,
    start: resolved.ranges[0]!.start,
  });
  let reconstructed = before;
  for (const operation of [...operations].reverse()) {
    expect(operation.before.markdown).toBe(before);
    expect(operation.before.changedText).toBe(
      before.slice(operation.anchor.from, operation.anchor.to),
    );
    reconstructed =
      reconstructed.slice(0, operation.anchor.from) +
      operation.after.changedText +
      reconstructed.slice(operation.anchor.to);
  }
  expect(operations.length).toBeGreaterThan(0);
  expect(reconstructed).toBe(resolved.content);
  return operations;
}

describe("suggestions on an MCP-created Markdown page", () => {
  it("preserves the captured revision's exact source bytes", () => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "a3aea9bdfef2b84fe3b4ce6b8538259ab1f3b8b20696e3fcad10ee718759a3f7",
    );
  });

  it("normalizes four blank separators and the literal currency dollar", () => {
    expect(docToNfm(nfmToDoc(source))).toBe(
      source.replace(/\n\n/g, "\n").replace("$60", "\\$60"),
    );
  });
  it.each(attemptedEdits)(
    "suggest-document-edit can replace '$find' in the stored MCP body",
    (edit) => {
      suggestDocumentEdit(source, edit);
    },
  );

  it.each(attemptedEdits)(
    "suggest-document-edit can replace '$find' in the editor's canonical body",
    (edit) => {
      suggestDocumentEdit(docToNfm(nfmToDoc(source)), edit);
    },
  );

  it.each(attemptedEdits)(
    "comment AI can build its single suggestion for '$find' in the stored MCP body",
    (edit) => {
      const resolved = resolveDocumentTextEdits(source, [edit]);
      if (!resolved.ok)
        throw new Error(`Unexpected target error: ${resolved.error.kind}`);
      const operation = markdownSuggestionOperation(source, resolved.content);
      expect(operation).not.toBeNull();
      expect(operation!.before.markdown).toBe(source);
      expect(operation!.after.markdown).toBe(resolved.content);
    },
  );
});

describe("verified formatting coordinates in stored Markdown", () => {
  const find = "old phrase";
  const replace = "new wording";
  it("refuses the reviewer's invisible-emphasis repro", () => {
    const before = "x***\n**marked**";
    for (const from of [1, 3]) {
      expect(
        suggestionFormattingSourceRange(before, from, from + 1),
      ).toBeNull();
      expect(
        suggestionFormattingSourceSlice(before, from, from + 1),
      ).toBeNull();
    }
    expect(() => suggestionMarkedSourceRanges(before)).toThrow(
      SuggestionFormattingMappingError,
    );
  });
  const divergences = [
    { name: "blank block separators", body: "Above\n\nold phrase\n\nBelow" },
    { name: "literal dollars", body: "Cost $60 for old phrase" },
    { name: "CRLF", body: "Above\r\nold phrase\r\nBelow" },
    { name: "plus bullets", body: "+ old phrase\n+ Another item" },
    { name: "asterisk bullets", body: "* old phrase\n* Another item" },
    {
      name: "parenthesized ordered lists",
      body: "1) old phrase\n2) Another item",
    },
  ];

  it.each(divergences)(
    "keeps original anchors next to $name with a mark elsewhere",
    ({ body }) => {
      const before = `${body}\nElsewhere **marked** text`;
      expect(docToNfm(nfmToDoc(before))).not.toBe(before);
      suggestDocumentEdit(before, { find, replace });
      const markedStart = before.indexOf("**marked**");
      expect(suggestionMarkedSourceRanges(before)).toEqual([
        { from: markedStart, to: markedStart + "**marked**".length },
      ]);
      const from = before.indexOf(find);
      expect(
        suggestionFormattingSourceSlice(before, from, from + find.length),
      ).toEqual([{ type: "text", text: find, marks: [] }]);
      const mapped = suggestionFormattingSourceRange(
        before,
        from,
        from + find.length,
      );
      expect(mapped).not.toBeNull();
      expect(mapped!.text.slice(mapped!.from, mapped!.to)).toBe(find);
    },
  );

  it.each(divergences)(
    "maps $name combined with every other source divergence",
    ({ body }) => {
      const context = [
        "**Elsewhere** $60",
        "+ Plus item",
        "* Asterisk item",
        "1) Ordered item",
        "```ts\nconst value = 1;\n```",
      ].join("\n\n");
      const before = `${context}\n\n${body}`.replace(/\r?\n/g, "\r\n");
      suggestDocumentEdit(before, { find, replace });
      expect(suggestionMarkedSourceRanges(before)).toEqual([
        { from: 0, to: "**Elsewhere**".length },
      ]);
      const from = before.indexOf(find);
      expect(
        suggestionFormattingSourceSlice(before, from, from + find.length),
      ).toEqual([{ type: "text", text: find, marks: [] }]);
    },
  );

  it.each(["\n", "\n\n", "\r\n"])(
    "maps a page with %j before the first block and after the last",
    (edge) => {
      const before = `${edge}Cost $60 for old phrase\n\n**marked** text${edge}`;
      expect(docToNfm(nfmToDoc(before))).not.toBe(before);
      suggestDocumentEdit(before, { find, replace });
      const markedStart = before.indexOf("**marked**");
      expect(suggestionMarkedSourceRanges(before)).toEqual([
        { from: markedStart, to: markedStart + "**marked**".length },
      ]);
    },
  );

  it.each(["\n", "\r\n", "\r"])(
    "maps a range crossing blank structural lines with %j endings",
    (ending) => {
      const before = `Above${ending}${ending}**marked** lower costs $60`;
      const from = before.indexOf("ove");
      const to = before.indexOf("lower") + "lower".length;
      const mapped = suggestionFormattingSourceRange(before, from, to);
      expect(mapped).not.toBeNull();
      expect(mapped!.text.slice(mapped!.from, mapped!.to)).toBe(
        "ovemarked lower",
      );
      expect(suggestionFormattingSourceSlice(before, from, to)).toEqual([
        { type: "text", text: "ove", marks: [] },
        { type: "break", text: "↵" },
        { type: "break", text: "↵" },
        { type: "text", text: "marked", marks: [{ type: "bold" }] },
        { type: "text", text: " lower", marks: [] },
      ]);
    },
  );

  it("maps indentation after a bare CR like LF and CRLF", () => {
    const sliceAcross = (ending: string) => {
      const before = `Above${ending}\t**marked** lower costs $60`;
      return suggestionFormattingSourceSlice(
        before,
        2,
        before.indexOf("lower") + "lower".length,
      );
    };
    const expected = sliceAcross("\n");
    expect(expected).not.toBeNull();
    expect(sliceAcross("\r\n")).toEqual(expected);
    expect(sliceAcross("\r")).toEqual(expected);
  });

  it.each(attemptedEdits)(
    "keeps B4 anchors for '$find' with CRLF, blank lines, and alternate list markers",
    (edit) => {
      const before =
        `${source.replace("- **Release:**", "+ **Release:**").replace("- **Styles:**", "* **Styles:**")}\n\n7) First ordered item\n8) Second ordered item`.replace(
          /\n/g,
          "\r\n",
        );
      suggestDocumentEdit(before, edit);
    },
  );

  it("keeps inline math in its gap and a neighbouring literal dollar in its run", () => {
    const before = "Math $x+y$ costs $60 for old phrase **marked**";
    expect(nfmToDoc(before).content[0]!.content).toContainEqual(
      expect.objectContaining({
        type: "notionInlineAtom",
        attrs: expect.objectContaining({ tagName: "math", label: "x+y" }),
      }),
    );
    suggestDocumentEdit(before, { find, replace });
    const from = before.indexOf("$60");
    expect(suggestionFormattingSourceSlice(before, from, from + 3)).toEqual([
      { type: "text", text: "$60", marks: [] },
    ]);
    const mapped = suggestionFormattingSourceRange(before, from, from + 3);
    expect(mapped!.text.slice(mapped!.from, mapped!.to)).toBe("$60");
  });

  it("charges only compared characters while searching for a long mark prefix", () => {
    const before =
      '![](https://example.test/image-with-a-long-name.png)\n\n<span color="blue" underline="true">old phrase</span>';
    const from = before.indexOf("<span");
    expect(suggestionMarkedSourceRanges(before)).toEqual([
      { from, to: before.length },
    ]);
    suggestDocumentEdit(before, { find, replace });
  });

  it.each(["\r\n", "\r"])(
    "proves normalized newline offsets inside a code run with %j endings",
    (ending) => {
      const before =
        "Above\n\n```ts\nconst one = 1;\nconst two = 2;\n```\n**marked**".replace(
          /\n/g,
          ending,
        );
      const from = before.indexOf("1;");
      const to = before.indexOf("two") + 3;
      expect(suggestionFormattingSourceSlice(before, from, to)).toEqual([
        { type: "text", text: "1;\nconst two", marks: [] },
      ]);
    },
  );

  it.each([
    "x**\n**marked**",
    "**\nx\n**marked**",
    "x\n**marked**\n**",
    "Above<br/>old phrase<br/>Below\n**marked**",
    "| Heading | Other |\n| --- | --- |\n| old phrase | Value |\n**marked**",
    "``````ts\nconst label = 'old phrase';\n``````\n**marked**",
  ])("refuses unsupported or stray gap bytes in %s", (before) => {
    expect(() => suggestionMarkedSourceRanges(before)).toThrow(
      SuggestionFormattingMappingError,
    );
    expect(suggestionFormattingSourceRange(before, 0, 1)).toBeNull();
    expect(suggestionFormattingSourceSlice(before, 0, 1)).toBeNull();
  });

  it.each(["$60", "\\$60"])(
    "proves each inner character offset beside bold delimiters in %s",
    (amount) => {
      const before = `Above\n\nCost **${amount}** today`;
      expect(suggestionMarkedSourceRanges(before)).toEqual([
        { from: before.indexOf("**"), to: before.lastIndexOf("**") + 2 },
      ]);
      let from = before.indexOf(amount);
      for (const character of "$60") {
        const length = before[from] === "\\" ? 2 : 1;
        expect(
          suggestionFormattingSourceSlice(before, from, from + length),
        ).toEqual([
          { type: "text", text: character, marks: [{ type: "bold" }] },
        ]);
        const mapped = suggestionFormattingSourceRange(
          before,
          from,
          from + length,
        );
        expect(mapped!.text.slice(mapped!.from, mapped!.to)).toBe(character);
        if (length === 2)
          expect(
            suggestionFormattingSourceSlice(before, from + 1, from + length),
          ).toBeNull();
        from += length;
      }
      suggestDocumentEdit(before, {
        find: `**${amount}** today`,
        replace: `**${amount.replace("60", "65")}** tomorrow`,
      });
    },
  );

  it("preserves an overlapping marked run in a multi-word find", () => {
    const before = "Above\n\n**old phrase** costs $60";
    const after = "Above\n\n**new wording** costs $60";
    const operations = markdownSuggestionOperations(before, after);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.before.markdown).toBe(before);
    expect(operations[0]!.before.changedText).toBe("**old phrase**");
    expect(operations[0]!.after.changedText).toBe("**new wording**");
    const suggested = suggestDocumentEdit(before, { find, replace });
    expect(suggested[0]!.after.markdown).toBe(after);
    expect(
      suggestionFormattingSourceSlice(
        after,
        after.indexOf(replace),
        after.indexOf(replace) + replace.length,
      ),
    ).toEqual([{ type: "text", text: replace, marks: [{ type: "bold" }] }]);
  });

  it("maps a formatting-only change back to original bytes", () => {
    const before = "Above\n\nold phrase costs $60\nBelow";
    const after = before.replace(find, "**old phrase**");
    const from = before.indexOf(find);
    expect(suggestionFormattingChanges(before, after)).toEqual([
      {
        before: { from, to: from + find.length },
        after: { from, to: from + "**old phrase**".length },
      },
    ]);
  });

  it("maps a self-closing break within inline code without losing inner offsets", () => {
    const before = "Above\n\n`one<br/>two` and **marked**";
    const from = before.indexOf("two");
    expect(suggestionFormattingSourceSlice(before, from, from + 3)).toEqual([
      { type: "text", text: "two", marks: [{ type: "code" }] },
    ]);
  });

  it("keeps canonical operation coordinates and marked slices unchanged", () => {
    const before = "Intro **old phrase** costs \\$60";
    const after = "Intro **new wording** costs \\$60";
    expect(docToNfm(nfmToDoc(before))).toBe(before);
    expect(suggestionMarkedSourceRanges(before)).toEqual([{ from: 6, to: 20 }]);
    expect(markdownSuggestionOperations(before, after)).toEqual([
      {
        ordinal: 0,
        kind: "replace_text",
        targetId: "body",
        schemaVersion: 1,
        before: { markdown: before, changedText: "**old phrase**" },
        after: { markdown: after, changedText: "**new wording**" },
        anchor: { from: 6, to: 20, prefix: "Intro ", suffix: " costs \\$60" },
      },
    ]);
  });

  it.each([
    "![old phrase](https://example.test/image.png)\n\nold phrase\n**marked**",
    "``````ts\nts\n``````\n\nold phrase **marked**",
    '<span underline="true" extra="retained">marked</span>\n\nold phrase',
  ])("refuses an unprovable candidate in %s", (before) => {
    expect(() => suggestionMarkedSourceRanges(before)).toThrow(
      SuggestionFormattingMappingError,
    );
    expect(suggestionFormattingSourceSlice(before, 0, 1)).toBeNull();
    expect(suggestionFormattingSourceRange(before, 0, 1)).toBeNull();
    expect(() =>
      markdownSuggestionOperationsForFindReplace({
        before,
        find,
        replace,
        start: before.lastIndexOf(find),
      }),
    ).toThrow(SuggestionFormattingMappingError);
  });

  it("bounds the work of repetitive near-matches instead of returning guessed offsets", () => {
    const before = `![${"a".repeat(20_000)}](https://example.test/image.png)\n\n${"a".repeat(2_000)}b\n**marked**`;
    expect(() => suggestionMarkedSourceRanges(before)).toThrow(
      SuggestionFormattingMappingError,
    );
  });

  it("maps many noncanonical runs on a large page", () => {
    const before = `${Array.from({ length: 1_000 }, (_value, index) => `Paragraph ${index} costs $60`).join("\n\n")}\n\n**marked**`;
    const from = before.indexOf("**marked**");
    expect(suggestionMarkedSourceRanges(before)).toEqual([
      { from, to: from + 10 },
    ]);
  });
});
