import { describe, expect, it } from "vitest";

import {
  findReplaceEditPieces,
  markdownSuggestionOperations,
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
    ["Meet at 5 p.m. Friday to sign it.", ["Meet", "sign"]],
    ["See e.g. Alice for the plan.", ["See", "plan"]],
    ["Ask Gov. Smith to sign it.", ["Ask", "sign"]],
    ["Ask Mr. Lee to sign it.", ["Mr", "sign"]],
  ])("doesn't end a sentence at the abbreviation in %s", (source, phrases) => {
    expect(sentenceUnits(piecesAt(source, phrases))).toEqual([0, 0]);
  });

  it("keeps a sentence whole when its abbreviation is what changes", () => {
    expect(
      unitsOfRewrite("Ask Dr. Lee to sign it.", "Ask Prof. Lee to approve it."),
    ).toEqual({ pieces: 2, units: [0, 0] });
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
    const { operations, editOfPiece } = findReplaceEditPieces({
      before,
      edits,
    });
    expect(operations).toHaveLength(2);
    expect(sentenceUnits(operations)).toEqual([0, 0]);
    expect(sentenceUnits(operations, editOfPiece)).toEqual([0, 1]);
  });

  // Long enough that these edits leave most of the line as it was.
  const line =
    "We parked the bad blue car behind the old station near the market.";
  const bad = line.indexOf("bad ");

  it("keeps separate edits apart when one starts where the other ends", () => {
    const { operations, editOfPiece } = findReplaceEditPieces({
      before: line,
      edits: [
        { find: "bad ", replace: "good ", start: bad },
        { find: "blue ", replace: "very blue ", start: bad + 4 },
      ],
    });
    expect(
      operations.map(({ anchor }) => [anchor.from - bad, anchor.to - bad]),
    ).toEqual([
      [0, 3],
      [4, 4],
    ]);
    expect(sentenceUnits(operations, editOfPiece)).toEqual([0, 1]);
  });

  it("keeps separate edits apart when both insert at one point", () => {
    const { operations, editOfPiece } = findReplaceEditPieces({
      before: line,
      edits: [
        { find: "bad ", replace: "bad old ", start: bad },
        { find: "blue ", replace: "dark blue ", start: bad + 4 },
      ],
    });
    expect(operations.map(({ anchor }) => anchor.from - bad)).toEqual([4, 4]);
    expect(editOfPiece).toEqual([0, 1]);
    expect(sentenceUnits(operations, editOfPiece)).toEqual([0, 1]);
  });

  it("counts edits that mostly rewrite a line between them as one piece", () => {
    const { operations, editOfPiece } = findReplaceEditPieces({
      before: "bad blue.",
      edits: [
        { find: "bad ", replace: "good ", start: 0 },
        { find: "blue.", replace: "very blue.", start: 4 },
      ],
    });
    expect(operations).toHaveLength(1);
    expect(editOfPiece).toEqual([0]);
  });

  it("gives the edit after a joined line its own piece", () => {
    const before = "bad blue.\n\nKeep this line just as it stands today.";
    const keep = before.indexOf("Keep");
    const { operations, editOfPiece } = findReplaceEditPieces({
      before,
      edits: [
        { find: "bad ", replace: "good ", start: 0 },
        { find: "blue.", replace: "very blue.", start: 4 },
        { find: "Keep", replace: "Hold", start: keep },
      ],
    });
    expect(operations).toHaveLength(2);
    expect(editOfPiece).toEqual([0, 2]);
    expect(sentenceUnits(operations, editOfPiece)).toEqual([0, 1]);
  });

  it("still joins the pieces within one of an agent's edits", () => {
    const before =
      "Teh team will recieve the files from the vendor on Friday morning. Keep this sentence as it is.";
    const edits = [
      {
        find: "Teh team will recieve",
        replace: "The team will receive",
        start: 0,
      },
      { find: "Keep", replace: "Hold", start: before.indexOf("Keep") },
    ];
    const { operations, editOfPiece } = findReplaceEditPieces({
      before,
      edits,
    });
    expect(sentenceUnits(operations, editOfPiece)).toEqual([0, 0, 1]);
  });
});
