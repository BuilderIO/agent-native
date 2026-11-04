import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { unitPairInstructions } from "../../shared/suggestion-units.js";
import { piecesOf, scoreEvalSet, type EvalCase } from "./score.js";

const read = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as T;

const cases = read<EvalCase[]>("./cases.json");
const recorded = read<{
  instructionsAtIndexZero: string;
  answers: Record<string, number[]>;
  repeats: Record<string, number[]>[];
}>("./answers.json");
const heldOut = cases.filter(({ dev }) => !dev);

describe("the review unit eval", () => {
  it("marks every piece of every edit exactly once", () => {
    for (const item of cases) {
      const pieces = piecesOf(item).map((_piece, index) => index);
      expect(item.groups.flat().sort((a, b) => a - b)).toEqual(pieces);
    }
  });

  it("recorded its answers with the question the code asks", () => {
    expect(recorded.instructionsAtIndexZero).toBe(unitPairInstructions(0));
  });

  it("breaks text less than sentence units and keeps more fixes apart", () => {
    const { sentences, model } = scoreEvalSet(heldOut, recorded.answers);
    expect(model.brokenEdits.length).toBeLessThanOrEqual(
      sentences.brokenEdits.length,
    );
    expect(model.fixesApart).toBeGreaterThan(sentences.fixesApart);
  });

  it("holds on every repeated run, since a model's answers vary", () => {
    for (const repeat of recorded.repeats) {
      const { sentences, model } = scoreEvalSet(heldOut, {
        ...recorded.answers,
        ...repeat,
      });
      expect(model.brokenEdits.length).toBeLessThanOrEqual(
        sentences.brokenEdits.length,
      );
      expect(model.fixesApart).toBeGreaterThan(sentences.fixesApart);
    }
  });
});
