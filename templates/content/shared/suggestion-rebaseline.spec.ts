import { describe, expect, it } from "vitest";

import { canonicalizeNfm } from "./nfm.js";
import {
  applyMarkdownSuggestionOperation,
  markdownPayload,
  operationAnchor,
} from "./suggestion-apply.js";
import { markdownSuggestionOperationsForFindReplace } from "./suggestion-diff.js";
import { resolveMarkdownSuggestionRange } from "./suggestion-rebase.js";
import { rebaselineSuggestions } from "./suggestion-rebaseline.js";

function suggestion(before: string, find: string, replace: string) {
  const start = before.indexOf(find);
  if (start < 0) throw new Error(`"${find}" is not in the page`);
  const [operation] = markdownSuggestionOperationsForFindReplace({
    before,
    find,
    replace,
    start,
  });
  return operation!;
}

function rebased(
  stored: string,
  operation: ReturnType<typeof suggestion>,
  id = "s1",
) {
  const canonical = canonicalizeNfm(stored);
  const outcome = rebaselineSuggestions(
    [{ id, group: id, operation }],
    stored,
    canonical,
  ).get(id);
  if (outcome?.kind !== "rebased")
    throw new Error(`expected a rebase, got ${JSON.stringify(outcome)}`);
  return { canonical, operation: outcome.operation };
}

// Pages as an agent sends them. Each one's canonical form differs from it.
const fixtures = [
  {
    name: "escaped underscores",
    page: String.raw`Run snake\_case\_name first.` + "\n\nThen the rest.",
    find: "first",
    replace: "last",
  },
  {
    name: "underscore bold",
    page: "Keep __bold words__ here.\n\nThen the rest.",
    find: "here",
    replace: "there",
  },
  {
    name: "a dollar amount",
    page: "It costs $60 today.\n\nThen the rest.",
    find: "$60",
    replace: "$75",
  },
  {
    name: "table cells with edge spaces",
    page: "Intro.\n\n|  Name  | Cost |\n| --- | --- |\n|  Tea  | $60 |\n\nThen the rest.",
    find: "Tea",
    replace: "Coffee",
  },
  {
    name: "blank lines",
    page: "First.\n\n\n\nSecond.\n\n\nThird.",
    find: "Second",
    replace: "Middle",
  },
];

describe("rebaselineSuggestions", () => {
  for (const fixture of fixtures) {
    it(`moves a suggestion on ${fixture.name} onto the canonical text`, () => {
      const original = suggestion(fixture.page, fixture.find, fixture.replace);
      const { canonical, operation } = rebased(fixture.page, original);
      expect(canonical).not.toBe(fixture.page);
      expect(operation.before.markdown).toBe(canonical);
      // It places directly on the canonical text, with no special case.
      expect(resolveMarkdownSuggestionRange(canonical, operation)).toEqual({
        from: operation.anchor.from,
        to: operation.anchor.to,
      });
      // And it makes the change accepting it on the stored body would have.
      expect(applyMarkdownSuggestionOperation(canonical, operation)).toBe(
        canonicalizeNfm(
          applyMarkdownSuggestionOperation(fixture.page, original)!,
        ),
      );
      expect(operation.after.markdown).toBe(
        canonicalizeNfm(operation.after.markdown),
      );
      expect(operation.kind).toBe(original.kind);
    });
  }

  it("keeps the range the suggestion covered and takes its context from the canonical text", () => {
    const page = "It costs $60 today.\n\nThen the rest.";
    const original = suggestion(page, "$60", "$75");
    const { operation } = rebased(page, original);
    expect(original.before.changedText).toBe("60");
    expect(operation.before.changedText).toBe("60");
    expect(operation.after.changedText).toBe("75");
    expect(operation.anchor.prefix).toBe(String.raw`It costs \$`);
    expect(operation.anchor.suffix).toBe(" today.\nThen the rest.");
  });

  it("widens the range to text canonicalization rewrites beside the change", () => {
    const page = "Prices: $60.\n\nThen the rest.";
    const original = suggestion(page, "Prices: ", "Prices: $5 and ");
    const { canonical, operation } = rebased(page, original);
    const added = operation.after.changedText;
    expect(added).toContain(String.raw`\$5`);
    expect(canonical.slice(operation.anchor.from, operation.anchor.to)).toBe(
      operation.before.changedText,
    );
  });

  it("leaves a suggestion already on the canonical text alone", () => {
    const canonical = canonicalizeNfm("First.\n\nSecond.");
    const operation = suggestion(canonical, "Second", "Last");
    expect(
      rebaselineSuggestions(
        [{ id: "s1", group: "s1", operation }],
        canonical,
        canonical,
      ).get("s1"),
    ).toEqual({ kind: "unchanged" });
  });

  it("rebases a suggestion saved on an older body that still places", () => {
    const older = "Run snake\\_case first.\n\nThen the rest.";
    const stored = "Run snake\\_case first.\n\nThen the rest, and more.";
    const original = suggestion(older, "first", "last");
    const { canonical, operation } = rebased(stored, original);
    expect(applyMarkdownSuggestionOperation(canonical, operation)).toBe(
      canonicalizeNfm(stored.replace("first", "last")),
    );
  });

  it("reports a suggestion that no longer places on the stored body as stale", () => {
    const older = "Run the job first.\n\nThen the rest.";
    const stored = "Rewritten.\n\n\nThen the rest.";
    const operation = suggestion(older, "first", "last");
    expect(
      rebaselineSuggestions(
        [{ id: "s1", group: "s1", operation }],
        stored,
        canonicalizeNfm(stored),
      ).get("s1"),
    ).toEqual({ kind: "stale" });
  });

  describe("a suggestion saved as the whole page before and after", () => {
    const stored = "It costs $60 today.\n\nThen the rest.";
    const wholePage = (before: string) => ({
      kind: "replace_text",
      before: { markdown: before },
      after: { markdown: before.replace("$60", "$75") },
      anchor: null,
    });

    it("rebases onto the canonical text with the change accepting it makes", () => {
      const canonical = canonicalizeNfm(stored);
      const outcome = rebaselineSuggestions(
        [{ id: "s1", group: "s1", operation: wholePage(stored) }],
        stored,
        canonical,
      ).get("s1");
      if (outcome?.kind !== "rebased")
        throw new Error(`expected a rebase, got ${JSON.stringify(outcome)}`);
      const { operation } = outcome;
      const anchor = operationAnchor(operation);
      expect(markdownPayload(operation.before, "before").markdown).toBe(
        canonical,
      );
      expect(resolveMarkdownSuggestionRange(canonical, operation)).toEqual({
        from: anchor.from,
        to: anchor.to,
      });
      expect(applyMarkdownSuggestionOperation(canonical, operation)).toBe(
        canonicalizeNfm(stored.replace("$60", "$75")),
      );
    });

    it("is stale on a page that no longer reads as its before-state", () => {
      expect(
        rebaselineSuggestions(
          [
            {
              id: "s1",
              group: "s1",
              operation: wholePage("It costs $60 now.\n\nThen the rest."),
            },
          ],
          stored,
          canonicalizeNfm(stored),
        ).get("s1"),
      ).toEqual({ kind: "stale" });
    });
  });

  it("blocks a suggestion whose change canonicalization would erase", () => {
    const stored = "Keep this.\n\nThen the rest.";
    const operation = suggestion(stored, "Keep this.\n\n", "Keep this.\n\n\n");
    expect(
      rebaselineSuggestions(
        [{ id: "s1", group: "s1", operation }],
        stored,
        canonicalizeNfm(stored),
      ).get("s1"),
    ).toEqual({ kind: "blocked", reason: "change_vanishes" });
  });

  it("keeps siblings saved together listing each other on the canonical text", () => {
    const stored = "It costs $60 today.\n\n\nIt costs $5 tomorrow.";
    const canonical = canonicalizeNfm(stored);
    const operations = markdownSuggestionOperationsForFindReplace({
      before: stored,
      find: stored,
      replace: "It costs $65 today.\n\n\nIt costs $6 tomorrow.",
      start: 0,
    });
    expect(operations.length).toBeGreaterThan(1);
    const outcomes = rebaselineSuggestions(
      operations.map((operation, index) => ({
        id: `s${index}`,
        group: "proposal",
        operation,
      })),
      stored,
      canonical,
    );
    const moved = operations.map((_, index) => {
      const outcome = outcomes.get(`s${index}`);
      if (outcome?.kind !== "rebased") throw new Error(JSON.stringify(outcome));
      return outcome.operation;
    });
    for (const [index, operation] of moved.entries()) {
      const others = moved
        .filter((_, other) => other !== index)
        .map(({ anchor }) => ({ from: anchor.from, to: anchor.to }));
      expect(operation.anchor.siblingRanges).toEqual(others);
    }
    // Accepting all of them in turn reaches the proposal's canonical result.
    let current = canonical;
    for (const operation of moved) {
      const next = applyMarkdownSuggestionOperation(current, {
        ...operation,
        anchor: { ...operation.anchor },
      });
      if (next === null)
        throw new Error(`could not place ${JSON.stringify(operation.anchor)}`);
      current = next;
    }
    expect(current).toBe(
      canonicalizeNfm("It costs $65 today.\n\n\nIt costs $6 tomorrow."),
    );
  });

  it("maps the sibling ranges a suggestion seen alone lists", () => {
    const stored = "It costs $60 today.\n\n\nIt costs $5 tomorrow.";
    const canonical = canonicalizeNfm(stored);
    const operations = markdownSuggestionOperationsForFindReplace({
      before: stored,
      find: stored,
      replace: "It costs $65 today.\n\n\nIt costs $6 tomorrow.",
      start: 0,
    });
    const together = rebaselineSuggestions(
      operations.map((operation, index) => ({
        id: `s${index}`,
        group: "proposal",
        operation,
      })),
      stored,
      canonical,
    );
    // Validation sees one proposal member at a time.
    for (const [index, operation] of operations.entries()) {
      const alone = rebaselineSuggestions(
        [{ id: "alone", group: "alone", operation }],
        stored,
        canonical,
      ).get("alone");
      const expected = together.get(`s${index}`);
      if (alone?.kind !== "rebased" || expected?.kind !== "rebased")
        throw new Error(JSON.stringify({ alone, expected }));
      expect(alone.operation.anchor.siblingRanges).toEqual(
        expected.operation.anchor.siblingRanges,
      );
    }
  });

  it("reports a suggestion seen alone whose listed sibling can't be placed as stale", () => {
    const stored = "Before.\n\n\nIt costs $60 today.";
    const canonical = canonicalizeNfm(stored);
    const [operation] = markdownSuggestionOperationsForFindReplace({
      before: stored,
      find: "today",
      replace: "now",
      start: stored.indexOf("today"),
    });
    const blank = stored.indexOf("\n\n\n");
    const outcome = rebaselineSuggestions(
      [
        {
          id: "alone",
          group: "alone",
          operation: {
            ...operation!,
            anchor: {
              ...operation!.anchor,
              siblingRanges: [{ from: blank, to: blank + 3 }],
            },
          },
        },
      ],
      stored,
      canonical,
    ).get("alone");
    expect(outcome).toEqual({ kind: "stale" });
  });
});
