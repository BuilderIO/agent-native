import { createHash } from "node:crypto";

import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";
import {
  sentenceUnits,
  unitGaps,
  unitPairRequest,
  unitPairs,
  unitsFromAnswers,
  type UnitPair,
} from "../../shared/suggestion-units.js";

export type EvalCase = {
  name: string;
  /** Used while writing the model's question, so reported apart from the rest. */
  dev?: boolean;
  before: string;
  after: string;
  /** Marked by hand: the pieces that only make sense together, by position. */
  groups: number[][];
};

export type EvalScore = {
  /** Edits where a group marked by hand is split across units. */
  brokenEdits: string[];
  /** Pairs of independent groups a reviewer can still decide separately. */
  fixesApart: number;
  /** Independent groups forced into one unit, so a reviewer loses that choice. */
  fixesJoined: number;
};

export const piecesOf = ({ before, after }: EvalCase) =>
  markdownSuggestionOperationsForFindReplace({
    before,
    find: before,
    replace: after,
    start: 0,
  });

/** Identifies what the model reads for an edit, to tie its answers to that text. */
export const pairsDigest = (pairs: readonly UnitPair[]) =>
  createHash("sha256")
    .update(JSON.stringify(unitPairRequest(pairs).input))
    .digest("hex")
    .slice(0, 16);

function scoreUnits(
  name: string,
  groups: readonly number[][],
  units: readonly number[],
  score: EvalScore,
) {
  const unitsOf = groups.map(
    (group) => new Set(group.map((piece) => units[piece])),
  );
  if (unitsOf.some((inGroup) => inGroup.size > 1)) score.brokenEdits.push(name);
  for (const [index, left] of unitsOf.entries()) {
    for (const right of unitsOf.slice(index + 1)) {
      if ([...left].some((unit) => right.has(unit))) score.fixesJoined += 1;
      else score.fixesApart += 1;
    }
  }
}

/** The same edits scored by sentence units and by the model's answers. */
export function scoreEvalSet(
  cases: readonly EvalCase[],
  answers: Readonly<Record<string, readonly number[]>>,
  pairDigests: Readonly<Record<string, string>>,
) {
  const sentences: EvalScore = {
    brokenEdits: [],
    fixesApart: 0,
    fixesJoined: 0,
  };
  const model: EvalScore = { brokenEdits: [], fixesApart: 0, fixesJoined: 0 };
  const rows = cases.map((item) => {
    const operations = piecesOf(item);
    const gaps = unitGaps(operations);
    const baseline = sentenceUnits(operations);
    const pairs = unitPairs(operations, gaps);
    const probabilities = answers[item.name] ?? [];
    // Answers go with pairs by position, so if the pairs changed they answer
    // other questions, and a score from them would mean nothing.
    if (
      (pairs.length ? pairsDigest(pairs) : undefined) !== pairDigests[item.name]
    ) {
      throw new Error(`${item.name}: answers were recorded for other pairs`);
    }
    if (probabilities.length !== pairs.length) {
      throw new Error(
        `${item.name}: ${probabilities.length} answers for ${pairs.length} pairs`,
      );
    }
    const units = unitsFromAnswers(
      gaps,
      new Map(
        pairs.flatMap(({ gap }, index) => {
          const [probability = null] = probabilities.slice(index, index + 1);
          return probability === null ? [] : [[gap, probability] as const];
        }),
      ),
    );
    if (!units) throw new Error(`${item.name}: a pair has no answer`);
    scoreUnits(item.name, item.groups, baseline, sentences);
    scoreUnits(item.name, item.groups, units, model);
    return {
      name: item.name,
      groups: item.groups,
      baseline,
      units,
      probabilities,
    };
  });
  return { sentences, model, rows };
}
