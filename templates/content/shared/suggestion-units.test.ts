import { describe, expect, it } from "vitest";

import {
  findReplaceEditPieces,
  markdownSuggestionOperations,
  type MarkdownSuggestionOperation,
} from "./suggestion-diff.js";
import {
  sentenceUnits,
  unitGaps,
  unitPairInstructions,
  unitPairRequest,
  unitPairs,
  unitsFromAnswers,
} from "./suggestion-units.js";

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

const piecesOfRewrite = (before: string, after: string) =>
  markdownSuggestionOperations(before, after);

describe("unitGaps", () => {
  it("leaves a model the gaps only the sentence rule decides", () => {
    expect(
      unitGaps(
        piecesOfRewrite(
          "Teh team will recieve the files on Tuesday.",
          "The team will receive the files on Tuesday.",
        ),
      ),
    ).toEqual([{ apart: false, settled: false }]);
    expect(
      unitGaps(
        piecesOfRewrite(
          "The meeting moved to Thursday. Bring the draft on Thursday.",
          "The meeting moved to Friday. Bring the draft on Friday.",
        ),
      ),
    ).toEqual([{ apart: true, settled: false }]);
  });

  it("settles pieces with no unchanged word between them", () => {
    expect(
      unitGaps(piecesAt("The cat sat. Dogs run fast.", ["sat", "Dogs"])),
    ).toEqual([{ apart: false, settled: true }]);
  });

  it("settles a line break, which always ends a unit", () => {
    expect(
      unitGaps(piecesAt("First note\n\nSecond note", ["First", "Second"])),
    ).toEqual([{ apart: true, settled: true }]);
  });

  it("settles an agent's separate edits, which never join", () => {
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
    expect(unitGaps(operations, editOfPiece)).toEqual([
      { apart: true, settled: true },
    ]);
  });

  it("settles every gap of a sentence that a change crosses", () => {
    expect(
      unitGaps(
        piecesAt("Alpha is here. Beta is there.", [
          "Alpha",
          "here. Beta",
          "there",
        ]),
      ),
    ).toEqual([
      { apart: false, settled: true },
      { apart: false, settled: true },
    ]);
  });

  it("doesn't count a boundary only the new text has as crossing", () => {
    const gaps = unitGaps(
      piecesOfRewrite(
        "Our launch plan is ready, but the vendor still has to confirm which plan includes the retry hooks we would use.",
        "The launch plan is ready. We still need the vendor to confirm that its standard plan includes retries.",
      ),
    );
    expect(gaps.some(({ settled }) => !settled)).toBe(true);
  });
});

describe("unitPairs", () => {
  const typos = piecesOfRewrite(
    "We recieved three invoices and payed two of them yesterday.",
    "We received three invoices and paid two of them yesterday.",
  );

  it("shows a pair's paragraph with each change taken alone", () => {
    expect(unitPairs(typos, unitGaps(typos))).toEqual([
      {
        gap: 0,
        oldText: "We recieved three invoices and payed two of them yesterday.",
        newText: "We received three invoices and paid two of them yesterday.",
        first: { old: "recieved", new: "received" },
        second: { old: "payed", new: "paid" },
        onlyFirst:
          "We received three invoices and payed two of them yesterday.",
        onlySecond:
          "We recieved three invoices and paid two of them yesterday.",
        both: "We received three invoices and paid two of them yesterday.",
      },
    ]);
  });

  it("treats pieces the rules hold together as one change", () => {
    const operations = piecesOfRewrite(
      "The API returns a 404 when the user is'nt found and a 500 when the databse is down.",
      "The API returns a 404 when the user isn't found and a 500 when the database is down.",
    );
    const gaps = unitGaps(operations);
    expect(operations.length).toBeGreaterThan(1);
    const pairs = unitPairs(operations, gaps);
    expect(pairs.map(({ gap }) => gap)).toEqual(
      gaps.flatMap(({ settled }, index) => (settled ? [] : [index])),
    );
    for (const { both, onlyFirst, onlySecond } of pairs) {
      expect(new Set([both, onlyFirst, onlySecond]).size).toBe(3);
    }
  });

  it("reads only the paragraph around a pair", () => {
    const operations = piecesOfRewrite(
      "Keep this private note.\n\nWe recieved it and payed it.\n\nKeep this one too.",
      "Keep this private note.\n\nWe received it and paid it.\n\nKeep this one too.",
    );
    const [pair = null] = unitPairs(operations, unitGaps(operations));
    expect(pair?.oldText).toBe("We recieved it and payed it.");
    expect(JSON.stringify(pair)).not.toContain("private");
  });

  it("asks one named question per pair, without its bookkeeping", () => {
    const pairs = unitPairs(typos, unitGaps(typos));
    const { input, questions } = unitPairRequest(pairs);
    expect(questions).toEqual([
      {
        type: "predicate",
        name: "pair_0",
        instructions: unitPairInstructions(0),
      },
    ]);
    expect(unitPairInstructions(3)).toContain("pairs[3]");
    expect(JSON.stringify(input)).not.toContain('"gap"');
  });
});

describe("unitsFromAnswers", () => {
  const free = (apart: boolean) => ({ apart, settled: false });

  it("splits a sentence only at 85% sure the pieces stand alone", () => {
    const gaps = [free(false)];
    expect(unitsFromAnswers(gaps, new Map([[0, 0.15]]))).toEqual([0, 1]);
    expect(unitsFromAnswers(gaps, new Map([[0, 0.16]]))).toEqual([0, 0]);
  });

  it("joins sentences only at 85% sure they depend on each other", () => {
    const gaps = [free(true)];
    expect(unitsFromAnswers(gaps, new Map([[0, 0.85]]))).toEqual([0, 0]);
    expect(unitsFromAnswers(gaps, new Map([[0, 0.84]]))).toEqual([0, 1]);
  });

  it("gives a model no say in a settled gap", () => {
    const gaps = [
      { apart: true, settled: true },
      { apart: false, settled: true },
    ];
    expect(unitsFromAnswers(gaps, new Map())).toEqual([0, 1, 1]);
    expect(
      unitsFromAnswers(
        gaps,
        new Map([
          [0, 0.99],
          [1, 0.01],
        ]),
      ),
    ).toEqual([0, 1, 1]);
  });

  it("gives nothing when a gap has no answer", () => {
    expect(
      unitsFromAnswers([free(false), free(true)], new Map([[0, 0.5]])),
    ).toBe(null);
  });
});
