import { describe, expect, it } from "vitest";

import {
  markdownSuggestionOperations,
  markdownSuggestionOperationsForEditorRevision,
  markdownSuggestionOperationsForFindReplace,
  markdownSuggestionOperationsForReplacements,
} from "./suggestion-diff.js";
import { suggestionMarkedSourceRanges } from "./suggestion-formatting.js";
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
