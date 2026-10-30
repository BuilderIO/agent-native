import { describe, expect, it } from "vitest";

import { canonicalizeNfm } from "./nfm.js";
import {
  markdownSuggestionOperations,
  markdownSuggestionOperationsForEditorRevision,
  markdownSuggestionOperationsForFindReplace,
  markdownSuggestionOperationsForFindReplaceEdits,
  markdownSuggestionOperationsForReplacements,
  suggestionDiffParts,
} from "./suggestion-diff.js";
import {
  suggestionMarkedSourceRanges,
  SuggestionFormattingMappingError,
} from "./suggestion-formatting.js";
import { resolveMarkdownSuggestionRange } from "./suggestion-rebase.js";

function proposedFrom(
  before: string,
  operations: ReturnType<typeof markdownSuggestionOperationsForFindReplace>,
) {
  return [...operations]
    .reverse()
    .reduce(
      (text, operation) =>
        text.slice(0, operation.anchor.from) +
        operation.after.changedText +
        text.slice(operation.anchor.to),
      before,
    );
}

function expectIntactOperations(
  before: string,
  after: string,
  operations: ReturnType<typeof markdownSuggestionOperations>,
) {
  expect(proposedFrom(before, operations)).toBe(after);
  const beforeRanges = suggestionMarkedSourceRanges(before) ?? [];
  const afterRanges = suggestionMarkedSourceRanges(after) ?? [];
  let delta = 0;
  for (const operation of operations) {
    const { from, to } = operation.anchor;
    expect(operation.before.markdown).toBe(before);
    expect(operation.after.markdown).toBe(
      before.slice(0, from) + operation.after.changedText + before.slice(to),
    );
    expect(resolveMarkdownSuggestionRange(before, operation)).toMatchObject({
      from,
      to,
    });
    const afterFrom = from + delta;
    const afterTo = afterFrom + operation.after.changedText.length;
    for (const [ranges, boundaries] of [
      [beforeRanges, [from, to]],
      [afterRanges, [afterFrom, afterTo]],
    ] as const) {
      for (const range of ranges) {
        for (const boundary of boundaries) {
          expect(boundary > range.from && boundary < range.to).toBe(false);
        }
      }
    }
    delta += operation.after.changedText.length - (to - from);
  }
}

describe("suggestion decomposition", () => {
  describe("localized edits on large synthetic pages", () => {
    const embed = `![Chart](data:image/svg+xml;base64,${"A".repeat(70_000)})`;
    const link = "[Reference](https://example.test)";
    const find =
      "First paragraph to shorten.\n\nSecond paragraph to shorten.\n\nThird paragraph to shorten.";
    const replace = "Short summary.\n\nSecond summary.\n\nThird summary.";

    it.each([
      ["leading embed, nearby link", [embed, link, "Opener."]],
      ["trailing embed, nearby link", ["Opener.", link, embed]],
      ["leading embed, remote link", [`${link}\n\n${embed}`, "Closing.", ""]],
      ["trailing embed before remote link", ["Opener.", embed, link]],
    ] as const)("shortens three paragraphs with %s", (_label, blocks) => {
      const before = [blocks[0], find, blocks[1], blocks[2]].join("\n\n");
      const after = before.replace(find, replace);
      const operations = markdownSuggestionOperationsForFindReplace({
        before,
        find,
        replace,
        start: before.indexOf(find),
      });
      expect(operations.length).toBeGreaterThanOrEqual(3);
      expectIntactOperations(before, after, operations);
      for (const operation of operations) {
        expect(operation.anchor.from).toBeGreaterThanOrEqual(
          before.indexOf(find),
        );
        expect(operation.anchor.to).toBeLessThanOrEqual(
          before.indexOf(find) + find.length,
        );
        expect(operation.after.markdown).toContain(embed);
        expect(operation.after.markdown).toContain(link);
      }
    });

    it.each([
      ["Use 𐐀x𐐀 and café here.", "Use 𐐨x𐐨 and cafés here."],
      [
        "Alpha<br>bravo and **marked text**.",
        "Alpha bravo and **revised text**.",
      ],
      [
        "[Old label](https://example.test) stays.",
        "[New label](https://example.test) stays.",
      ],
      ["Repeat.\n\nRepeat.\n\nKeep.", "Repeat.\n\nKeep."],
      [
        "First word.\n\nMiddle stays.\n\nLast word.",
        "First phrase.\n\nMiddle stays.\n\nLast phrase.",
      ],
    ])(
      "preserves small-page hunk alignment for %s",
      (beforeText, afterText) => {
        const prefix = `${embed}\n\n`;
        const suffix = `\n\n${link}\n\n${embed}`;
        const before = prefix + beforeText + suffix;
        const after = prefix + afterText + suffix;
        const operations = markdownSuggestionOperations(before, after);
        const small = markdownSuggestionOperations(beforeText, afterText);
        expect(
          operations.map(({ anchor, before, after }) => [
            anchor.from - prefix.length,
            anchor.to - prefix.length,
            before.changedText,
            after.changedText,
          ]),
        ).toEqual(
          small.map(({ anchor, before, after }) => [
            anchor.from,
            anchor.to,
            before.changedText,
            after.changedText,
          ]),
        );
        expectIntactOperations(before, after, operations);
      },
    );

    it("retains identical large sources as one equality", () => {
      expect(suggestionDiffParts(embed, embed)).toEqual([
        { type: "equal", text: embed },
      ]);
    });

    it("inserts a paragraph before an unchanged leading atom", () => {
      const before = `${embed}\n\n${link}`;
      const after = `New paragraph.\n\n${before}`;
      const operations = markdownSuggestionOperations(before, after);
      expect(operations).toHaveLength(1);
      expect(operations[0]?.anchor).toMatchObject({ from: 0, to: 0 });
      expect(operations[0]?.after.changedText).toBe("New paragraph.\n\n");
      expectIntactOperations(before, after, operations);
    });

    it("retains length and edit-distance refusals for the changed window", () => {
      for (const [beforeText, afterText] of [
        [
          `Start.\n${"x".repeat(33_000)}\nEnd.`,
          `Changed.\n${"x".repeat(33_000)}\nFinish.`,
        ],
        ["x".repeat(1_100), "y".repeat(1_100)],
      ]) {
        const before = `${embed}\n\n${beforeText}\n\n${link}`;
        const after = `${embed}\n\n${afterText}\n\n${link}`;
        expect(suggestionDiffParts(before, after)).toBeNull();
        expect(() => markdownSuggestionOperations(before, after)).toThrow(
          SuggestionFormattingMappingError,
        );
      }
    });
  });

  it("keeps a typed sentence whole when the author also edits elsewhere", () => {
    const before = [
      "It means I'd just learned three things about drawing.",
      "I've already promised Apoorva my next one for another critique.",
      "## Hand edits are gold",
      "I don't make much by hand anymore.",
    ].join("\n");
    const split = before.indexOf("things");
    const heading = before.indexOf("## Hand");
    const sentence = "\nEncoding our newfound knowledge is the whole point.";
    const paragraph = "Then I wrote the lesson into the skill.\n";
    const after =
      before.slice(0, split) +
      sentence +
      before.slice(split, heading) +
      paragraph +
      before.slice(heading);

    const operations = markdownSuggestionOperationsForEditorRevision({
      before,
      after,
      replacements: [],
    });

    expect(operations.map((operation) => operation.after.changedText)).toEqual([
      sentence,
      paragraph,
    ]);
    expectIntactOperations(before, after, operations);
  });

  it("keeps a middle edit reviewable after accepting both outer edits", () => {
    const before = "Alpha quick bravo, middle ready, omega slow.";
    const after = "Apex quick bravo, middle set, omega fast.";
    const operations = markdownSuggestionOperations(before, after);
    expect(operations).toHaveLength(3);

    let current = before;
    for (const operation of [
      operations[0]!,
      operations[2]!,
      operations[1]!,
    ].map((value) => JSON.parse(JSON.stringify(value)) as typeof value)) {
      const range = resolveMarkdownSuggestionRange(current, operation);
      expect(
        range,
        `operation ${operation.ordinal} against ${current}`,
      ).not.toBeNull();
      current =
        current.slice(0, range!.from) +
        operation.after.changedText +
        current.slice(range!.to);
    }
    expect(current).toBe(after);
  });

  it("rebases a middle edit despite repeated context elsewhere", () => {
    const before = "Intro cat a a dog. Another a a a dog.";
    const after = "Intro lion b a hound. Another a a a dog.";
    const operations = markdownSuggestionOperations(before, after);
    expect(operations).toHaveLength(3);

    let current = before;
    for (const operation of [
      operations[0]!,
      operations[2]!,
      operations[1]!,
    ].map((value) => JSON.parse(JSON.stringify(value)) as typeof value)) {
      const range = resolveMarkdownSuggestionRange(current, operation);
      expect(
        range,
        `operation ${operation.ordinal} against ${current}`,
      ).not.toBeNull();
      current =
        current.slice(0, range!.from) +
        operation.after.changedText +
        current.slice(range!.to);
    }
    expect(current).toBe(after);
  });

  it("keeps punctuation and a separate word independently reviewable", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const operations = markdownSuggestionOperationsForFindReplace({
      before,
      find: before,
      replace: after,
      start: 0,
    });

    expect(operations).toHaveLength(2);
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([
      [",", ""],
      ["good", "excellent"],
    ]);
    expect(proposedFrom(before, operations)).toBe(after);
    expect(proposedFrom(before, [operations[1]!])).toBe(
      "We shipped quickly, and the results were excellent.",
    );
  });

  it("keeps an explicit single-word replacement together", () => {
    const before = "The quick fox can run.";
    const start = before.indexOf("run");
    const operations = markdownSuggestionOperationsForFindReplace({
      before,
      find: "run",
      replace: "sprint",
      start,
    });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      before: { changedText: "run" },
      after: { changedText: "sprint" },
      anchor: { from: start, to: start + 3 },
    });
    expect(proposedFrom(before, operations)).toBe("The quick fox can sprint.");
  });

  const suggestsAnEdit = (before: string, find: string, replace: string) => {
    const operations = markdownSuggestionOperationsForFindReplace({
      before,
      find,
      replace,
      start: before.indexOf(find),
    });
    expect(operations).toHaveLength(1);
    expect(proposedFrom(before, operations)).toBe(
      before.replace(find, replace),
    );
  };

  it.each([
    ["Call __init__ then **b**.", "then", "and then"],
    ["Call snake\\_case then **b**.", "then", "and then"],
    ["Say **a****b** now.", "now", "again"],
    ["Say [a](u)[b](u) now.", "now", "again"],
  ])(
    "suggests an edit to %j, which spells formatting or an escape another way",
    suggestsAnEdit,
  );

  // The parse reads these stored spellings, which the writer never writes.
  // The L7 bridge in the source mapper maps them until L7 replaces it.
  it.each([
    ["Some _x_ text and **b**.", "text and", "words, and"],
    ["Some _x_ text.", "Some _x_", "Some **x**"],
  ])("suggests an edit to %j, which the L7 bridge maps", suggestsAnEdit);

  it("replaces text that follows delimiters the stored source reopens", () => {
    const before = "**b****b****b**";
    const middle = before.indexOf("b", 3);
    const operations = markdownSuggestionOperationsForEditorRevision({
      before,
      after: "**bXb**",
      replacements: [{ from: middle, to: middle + 1 }],
    });
    expect(operations).toHaveLength(1);
    expect(canonicalizeNfm(proposedFrom(before, operations))).toBe("**bXb**");
  });

  it("keeps adjacent finds apart when whole words would join them", () => {
    // Both finds split "two", so expanding either change to the whole word
    // would overlap the other. Each stays inside its own find instead.
    const before = "one two three";
    const operations = markdownSuggestionOperationsForFindReplaceEdits({
      before,
      edits: [
        { find: "one tw", replace: "one TW", start: 0 },
        { find: "o three", replace: "O three", start: 6 },
      ],
    });
    expect(operations.map(({ anchor }) => [anchor.from, anchor.to])).toEqual([
      [0, 6],
      [6, 13],
    ]);

    for (const order of [operations, [...operations].reverse()]) {
      let current = before;
      for (const operation of order.map(
        (value) => JSON.parse(JSON.stringify(value)) as typeof value,
      )) {
        const range = resolveMarkdownSuggestionRange(current, operation);
        expect(range, `operation ${operation.ordinal}`).not.toBeNull();
        current =
          current.slice(0, range!.from) +
          operation.after.changedText +
          current.slice(range!.to);
      }
      expect(current).toBe("one TWO three");
    }
  });

  it("keeps selected sentence replacements granular", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const operations = markdownSuggestionOperationsForReplacements({
      before,
      after,
      replacements: [{ from: 0, to: before.length }],
    });

    expect(operations).toHaveLength(2);
    expect(proposedFrom(before, operations)).toBe(after);
  });

  it("keeps a changed lexical word together despite shared letters", () => {
    const before = "A second note is ready.";
    const after = "A second note is approved.";
    const operations = markdownSuggestionOperationsForFindReplace({
      before,
      find: before,
      replace: after,
      start: 0,
    });
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([["ready", "approved"]]);
  });

  it.each([
    [
      "- **Release:** Wrenfield goes on sale Thursday, October 3.\n- **Styles:** Light to Black.",
      "Thursday, October 3",
      "Friday, October 2",
      [
        ["Thursday", "Friday"],
        ["3", "2"],
      ],
    ],
    [
      "We shipped quickly, and the results were good.\n\n**Review:** Draft.",
      "We shipped quickly, and the results were good.",
      "We shipped quickly and the results were excellent.",
      [
        [",", ""],
        ["good", "excellent"],
      ],
    ],
    [
      "A second note is ready.\n\n**Review:** Draft.",
      "A second note is ready.",
      "A second note is approved.",
      [["ready", "approved"]],
    ],
  ])(
    "CSD-12: matches plain-page word decisions on %s",
    (before, find, replace, expected) => {
      for (const source of [before.replace(/\*\*/g, ""), before]) {
        const start = source.indexOf(find);
        const after =
          source.slice(0, start) + replace + source.slice(start + find.length);
        const operations = markdownSuggestionOperationsForFindReplace({
          before: source,
          find,
          replace,
          start,
        });
        expect(
          operations.map((item) => [
            item.before.changedText,
            item.after.changedText,
          ]),
        ).toEqual(expected);
        expectIntactOperations(source, after, operations);
      }
    },
  );

  it("CSD-12: keeps whole words in a formatted Suggesting-mode revision", () => {
    const before = "**Release:** Thursday, October 3.";
    const after = "**Release:** Friday, October 2.";
    const from = before.indexOf("Thursday");
    const operations = markdownSuggestionOperationsForEditorRevision({
      before,
      after,
      replacements: [{ from, to: before.length }],
    });
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([
      ["Thursday", "Friday"],
      ["3", "2"],
    ]);
    expectIntactOperations(before, after, operations);
  });

  it.each([
    ["bold", "**Release:**", "**Launch:**"],
    ["italic", "*Release:*", "*Launch:*"],
    ["code", "`Release:`", "`Launch:`"],
    [
      "link",
      "[Release:](https://example.test)",
      "[Launch:](https://example.test)",
    ],
    [
      "span",
      '<span underline="true">Release:</span>',
      '<span underline="true">Launch:</span>',
    ],
  ])(
    "CSD-13: keeps the %s run whole and adjacent words independent",
    (_name, marked, revised) => {
      const cases = [
        [marked + " Thursday", revised + " Thursday", [[marked, revised]]],
        [marked + " Thursday", marked + " Friday", [["Thursday", "Friday"]]],
        ["Thursday" + marked, "Friday" + marked, [["Thursday", "Friday"]]],
        [marked + "Thursday", marked + "Friday", [["Thursday", "Friday"]]],
      ] as const;
      for (const [before, after, expected] of cases) {
        const operations = markdownSuggestionOperations(before, after);
        expect(
          operations.map((item) => [
            item.before.changedText,
            item.after.changedText,
          ]),
        ).toEqual(expected);
        expectIntactOperations(before, after, operations);
      }
    },
  );

  it("CSD-13: keeps a formatted run whole when the other side has no mappable formatting", () => {
    const cases = [
      [
        "**Note:** Thursday.",
        "Note: Friday.\n\n<https://example.test>",
        [
          ["**Note:**", "Note:"],
          ["Thursday", "Friday"],
          ["", "\n\n<https://example.test>"],
        ],
      ],
      [
        "Note: Thursday.\n\n<https://example.test>",
        "**Note:** Friday.",
        [
          ["Note:", "**Note:**"],
          ["Thursday", "Friday"],
          ["\n\n<https://example.test>", ""],
        ],
      ],
    ] as const;
    for (const [before, after, expected] of cases) {
      const operations = markdownSuggestionOperations(before, after);
      expect(
        operations.map((item) => [
          item.before.changedText,
          item.after.changedText,
        ]),
      ).toEqual(expected);
      expectIntactOperations(before, after, operations);
    }
  });

  it("preserves exact whitespace, Unicode, and formatting bytes", () => {
    for (const [before, after] of [
      ["word word", "word, word"],
      ["Line one\nLine two", "Line one\n\nLine two"],
      ["Cafe 🐈 was good.", "Café 🐈 was excellent."],
      ["Read **good** notes.", "Read *excellent* notes."],
      ["one  two", "one two"],
    ]) {
      const operations = markdownSuggestionOperationsForFindReplace({
        before,
        find: before,
        replace: after,
        start: 0,
      });
      expect(operations.length).toBeGreaterThan(0);
      expect(proposedFrom(before, operations)).toBe(after);
      expect(
        operations.every(
          (item) =>
            item.before.markdown === before &&
            item.anchor.from <= item.anchor.to &&
            item.anchor.to <= before.length,
        ),
      ).toBe(true);
    }
  });

  describe("a rewritten phrase that shares letters with the original", () => {
    const find = "So I save them:";
    const replace = "With your own edits, I recommend:";
    const sources = [
      "Each edit marks a decision the skill couldn't make yet. So I save them:",
      "Each edit marks a decision the skill couldn't make yet. So I save them:\n1. **Save the output before you touch it.**",
    ];
    const replaced = (source: string) => source.replace(find, replace);
    const changes = (
      operations: ReturnType<typeof markdownSuggestionOperations>,
    ) =>
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]);

    it.each(sources)("is one agent suggestion on %j", (before) => {
      const operations = markdownSuggestionOperationsForFindReplace({
        before,
        find,
        replace,
        start: before.indexOf(find),
      });
      expect(changes(operations)).toEqual([
        ["So I save them", "With your own edits, I recommend"],
      ]);
      expectIntactOperations(before, replaced(before), operations);
    });

    it.each(sources)("is one Suggesting-mode revision on %j", (before) => {
      const start = before.indexOf(find);
      expect(
        changes(
          markdownSuggestionOperationsForEditorRevision({
            before,
            after: replaced(before),
            replacements: [],
          }),
        ),
      ).toEqual([["So I save them", "With your own edits, I recommend"]]);
      expect(
        changes(
          markdownSuggestionOperationsForEditorRevision({
            before,
            after: replaced(before),
            replacements: [{ from: start, to: start + find.length }],
          }),
        ),
      ).toEqual([[find, replace]]);
    });

    it("is one deletion and one insertion in the review card", () => {
      expect(suggestionDiffParts(find, replace)).toEqual([
        { type: "delete", text: "So I save them" },
        { type: "insert", text: "With your own edits, I recommend" },
        { type: "equal", text: ":" },
      ]);
    });
  });

  it("keeps a word whole when it also gains a trailing letter", () => {
    const before = "Reorganise the files.";
    const after = "reorganised the files.";
    const operations = markdownSuggestionOperations(before, after);
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([["Reorganise", "reorganised"]]);
    expectIntactOperations(before, after, operations);
  });

  it("joins adjacent rewritten words into one edit", () => {
    const before = "A big dog barked.";
    const after = "A small cat barked.";
    const operations = markdownSuggestionOperations(before, after);
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([["big dog", "small cat"]]);
    expectIntactOperations(before, after, operations);
  });

  it("reads a letter outside the Basic Multilingual Plane as a letter", () => {
    const before = "Use 𐐀x𐐀 here.";
    const after = "Use 𐐨x𐐨 here.";
    const operations = markdownSuggestionOperations(before, after);
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([["𐐀x𐐀", "𐐨x𐐨"]]);
    expectIntactOperations(before, after, operations);
    expect(
      suggestionDiffParts(before, after)?.filter(
        (part) => part.type !== "equal",
      ),
    ).toEqual([
      { type: "delete", text: "𐐀x𐐀" },
      { type: "insert", text: "𐐨x𐐨" },
    ]);
  });

  it("never joins edits across a block boundary", () => {
    const before = "Draft\nReady";
    const after = "Final\nShip";
    const operations = markdownSuggestionOperations(before, after);
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([
      ["Draft", "Final"],
      ["Ready", "Ship"],
    ]);
    expectIntactOperations(before, after, operations);
  });

  it("keeps text and a new paragraph as one edit when another block also changes", () => {
    const before =
      "Alpha one has a few words.\nBravo two sits in the middle.\nCharlie three is next.\nDelta four closes it out.";
    const paragraphOnly = before.replace(
      "words.\n",
      "words. More alpha.\nAlpha follow-up paragraph.\n",
    );
    const after = paragraphOnly.replace("it out.", "it out. Delta extra.");
    const changes = (
      operations: ReturnType<typeof markdownSuggestionOperations>,
    ) =>
      operations.map((item) => [
        item.anchor.from,
        item.before.changedText,
        item.after.changedText,
      ]);

    expect(
      changes(markdownSuggestionOperations(before, paragraphOnly)),
    ).toEqual([[26, "", " More alpha.\nAlpha follow-up paragraph."]]);
    const operations = markdownSuggestionOperations(before, after);
    expect(changes(operations)).toEqual([
      [26, "", " More alpha.\nAlpha follow-up paragraph."],
      [105, "", " Delta extra."],
    ]);
    expectIntactOperations(before, after, operations);
  });

  it("keeps a deleted paragraph a deletion when another block also changes", () => {
    const before =
      "Alpha one has a few words.\nBravo two sits in the middle.\nCharlie three is next.\nDelta four closes it out.\nEcho five ends here.";
    const after = before
      .replace("Charlie three is next.\n", "")
      .replace("it out.\nEcho", "it out.Echo");
    const operations = markdownSuggestionOperations(before, after);
    expect(
      operations.map((item) => [
        item.anchor.from,
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([
      [57, "Charlie three is next.\n", ""],
      [105, "\n", ""],
    ]);
    expectIntactOperations(before, after, operations);
  });

  it("keeps edits at the end of one block and the start of the next separate", () => {
    const before = "Alpha ends here\nBravo starts here\nCharlie";
    const after = "Alpha ends here now\nSo Bravo starts here\nCharlie stays";
    const operations = markdownSuggestionOperations(before, after);
    expect(operations.map((item) => item.after.changedText)).toEqual([
      " now",
      "So ",
      " stays",
    ]);
    expectIntactOperations(before, after, operations);
  });

  it("keeps a replacement across a paragraph break as one edit", () => {
    const before = "Alpha one has a few words.\nBravo two sits in the middle.";
    const from = before.indexOf("has a few");
    const to = before.indexOf(" sits");
    const after = `${before.slice(0, from)}is now joined with${before.slice(to)}`;
    const operations = markdownSuggestionOperationsForReplacements({
      before,
      after,
      replacements: [{ from, to }],
    });

    expect(
      operations.map((item) => [
        item.anchor.from,
        item.anchor.to,
        item.after.changedText,
      ]),
    ).toEqual([[from, to, "is now joined with"]]);
    expect(proposedFrom(before, operations)).toBe(after);
  });

  it("returns no edit for an unchanged replacement", () => {
    expect(
      markdownSuggestionOperationsForFindReplace({
        before: "same text",
        find: "same text",
        replace: "same text",
        start: 0,
      }),
    ).toEqual([]);
  });
});
