import { decide } from "@agent-native/core/decisions";

import type { MarkdownSuggestionOperation } from "../../shared/suggestion-diff.js";
import {
  unitGaps,
  unitPairRequest,
  unitPairs,
  unitsFromAnswers,
  unitsFromGaps,
} from "../../shared/suggestion-units.js";

/** A decision model's answer can only delay the agent's edit by this long. */
const MODEL_UNITS_TIMEOUT_MS = 4_000;

/**
 * Review units from a decision model, on top of the rules in `unitGaps`. With no
 * model, a refusal or a late answer, the edit gets sentence units: this never
 * fails the agent's call.
 */
export async function modelUnits(input: {
  ownerEmail: string | null | undefined;
  operations: readonly MarkdownSuggestionOperation[];
  editOfPiece?: readonly number[];
}): Promise<number[]> {
  const { ownerEmail, operations, editOfPiece } = input;
  if (operations.length === 0) return [];
  const gaps = unitGaps(operations, editOfPiece);
  const sentenceUnits = unitsFromGaps(gaps.map(({ apart }) => apart));
  const pairs = unitPairs(operations, gaps);
  if (!ownerEmail || pairs.length === 0) return sentenceUnits;
  try {
    const result = await decide({
      ownerEmail,
      ...unitPairRequest(pairs),
      options: { timeoutMs: MODEL_UNITS_TIMEOUT_MS },
    });
    if (result.status !== "ok") {
      if (result.status === "failed") {
        console.warn("[suggestion-model-units] no decision", result.reason);
      }
      return sentenceUnits;
    }
    const dependence = new Map<number, number>();
    for (const [name, answer] of Object.entries(result.answers)) {
      if (answer.type === "predicate") {
        dependence.set(Number(name.replace("pair_", "")), answer.probability);
      }
    }
    return unitsFromAnswers(gaps, dependence) ?? sentenceUnits;
  } catch (error) {
    console.warn("[suggestion-model-units] decision threw", error);
    return sentenceUnits;
  }
}
