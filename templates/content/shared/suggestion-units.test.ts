import { describe, expect, it } from "vitest";

import {
  markdownSuggestionOperations,
  markdownSuggestionOperationsForFindReplaceEdits,
  type MarkdownSuggestionOperation,
} from "./suggestion-diff.js";
import { sentenceUnits } from "./suggestion-units.js";

const unitsOfRewrite = (before: string, after: string) => {
  const operations = markdownSuggestionOperations(before, after);
  return { pieces: operations.length, units: sentenceUnits(operations) };
};

/** Pieces of `source` at each phrase, in order, however the differ would split it. */
const piecesAt = (source: string, phrases: string[]) => {
  let cursor = 0;
  return phrases.map((phrase) => {
    const from = source.indexOf(phrase, cursor);
    if (from < 0) throw new Error(`"${phrase}" is not in the source`);
    cursor = from + phrase.length;
    return {
      before: { markdown: source },
      anchor: { from, to: cursor },
    } as unknown as MarkdownSuggestionOperation;
  });
};

describe("sentenceUnits", () => {
  it("keeps a rewritten sentence in one unit, so it can't be half taken", () => {
    expect(
      unitsOfRewrite(
        "Our launch plan is ready, but the vendor still has to confirm which plan includes the retry hooks we would use.",
        "The launch plan is ready. We still need the vendor to confirm that its standard plan includes retries.",
      ),
    ).toEqual({ pieces: 6, units: [0, 0, 0, 0, 0, 0] });
  });

  it("keeps two fixes in one sentence together", () => {
    expect(
      unitsOfRewrite(
        "Teh team will recieve the files on Tuesday.",
        "The team will receive the files on Tuesday.",
      ),
    ).toEqual({ pieces: 2, units: [0, 0] });
  });

  it("gives each changed sentence its own unit", () => {
    expect(
      unitsOfRewrite(
        "The meeting moved to Thursday. Bring the draft on Thursday.",
        "The meeting moved to Friday. Bring the draft on Friday.",
      ),
    ).toEqual({ pieces: 2, units: [0, 1] });
  });

  it("starts a new unit at each paragraph and list item", () => {
    const paragraphs = "First note\n\nSecond note\n\nThird note";
    expect(
      sentenceUnits(piecesAt(paragraphs, ["First", "Second", "Third"])),
    ).toEqual([0, 1, 2]);
    const bullets = "- First item\n- Second item";
    expect(sentenceUnits(piecesAt(bullets, ["First", "Second"]))).toEqual([
      0, 1,
    ]);
  });

  it("joins pieces with no unchanged word between them, wherever they fall", () => {
    const sentences = "The cat sat. Dogs run fast.";
    expect(sentenceUnits(piecesAt(sentences, ["sat", "Dogs"]))).toEqual([0, 0]);
    const blocks = "A first note\n\n- A second note";
    expect(sentenceUnits(piecesAt(blocks, ["note", "A second"]))).toEqual([
      0, 0,
    ]);
  });

  it("joins the sentences a piece crosses", () => {
    const source = "Alpha is here. Beta is there.";
    expect(
      sentenceUnits(piecesAt(source, ["Alpha", "here. Beta", "there"])),
    ).toEqual([0, 0, 0]);
    // Replacing the period joins them just the same.
    expect(sentenceUnits(piecesAt(source, ["here.", "there"]))).toEqual([0, 0]);
  });

  it("doesn't take an abbreviation's period for a sentence end", () => {
    expect(
      sentenceUnits(
        piecesAt("See e.g. the notes and the appendix.", ["See", "appendix"]),
      ),
    ).toEqual([0, 0]);
  });

  it.each([
    ["Ask Dr. Lee to sign it.", ["Ask", "sign"]],
    ["Mr. Smith and Mrs. Jones left today.", ["Smith", "left"]],
    ["Ask the U.S. Senate to sign it.", ["Ask", "sign"]],
    ["Call J. Smith at Acme Inc. Monday morning.", ["Call", "morning"]],
  ])("doesn't end a sentence at the abbreviation in %s", (source, phrases) => {
    expect(sentenceUnits(piecesAt(source, phrases))).toEqual([0, 0]);
  });

  it("keeps clauses of one bullet together", () => {
    const bullet =
      "- **Vendor:** whether to feature signing; which plan includes hooks; and who reviews";
    expect(
      sentenceUnits(piecesAt(bullet, ["whether", "which", "who"])),
    ).toEqual([0, 0, 0]);
  });

  it("gives a single piece one unit", () => {
    expect(sentenceUnits(piecesAt("One piece.", ["One"]))).toEqual([0]);
  });

  it("never joins an agent's separate edits, even in one sentence", () => {
    const before = "Open source and Open source again.";
    const edits = [
      { find: "Open source and", replace: "Open-source and", start: 0 },
      {
        find: "Open source again",
        replace: "Open-source again",
        start: before.indexOf("Open source again"),
      },
    ];
    const operations = markdownSuggestionOperationsForFindReplaceEdits({
      before,
      edits,
    });
    expect(operations).toHaveLength(2);
    expect(sentenceUnits(operations)).toEqual([0, 0]);
    expect(sentenceUnits(operations, edits)).toEqual([0, 1]);
  });

  it("still joins the pieces within one of an agent's edits", () => {
    const before = "Teh team will recieve the files. Keep this.";
    const edits = [
      {
        find: "Teh team will recieve",
        replace: "The team will receive",
        start: 0,
      },
      { find: "Keep", replace: "Hold", start: before.indexOf("Keep") },
    ];
    const operations = markdownSuggestionOperationsForFindReplaceEdits({
      before,
      edits,
    });
    expect(sentenceUnits(operations, edits)).toEqual([0, 0, 1]);
  });
});
