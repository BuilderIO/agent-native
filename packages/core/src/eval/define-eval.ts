/**
 * `defineEval` — declare a named eval test case.
 *
 * An eval pairs an input (prompt + optional history/setup) with a list of
 * scorers and a pass threshold. The runner (see `runner.ts`) actually runs the
 * agent for the input, scores the output with each scorer, and gates on the
 * threshold. Authors write `*.eval.ts` files that `export default defineEval(...)`
 * or export an array of them.
 *
 * Example (`evals/greeting.eval.ts`):
 * ```ts
 * import { defineEval, contains, llmJudge } from "@agent-native/core/eval";
 *
 * export default defineEval({
 *   name: "greets the user by name",
 *   input: { prompt: "Say hi to Ada." },
 *   threshold: 0.7,
 *   scorers: [
 *     contains("Ada"),
 *     llmJudge({ criteria: "friendliness", rubric: "1.0 = warm greeting" }),
 *   ],
 * });
 * ```
 */

import type { Eval } from "./types.js";

/** Default per-scorer pass threshold when an eval doesn't specify one. */
export const DEFAULT_EVAL_THRESHOLD = 0.5;

export function defineEval(spec: Eval): Eval {
  if (!spec.name || typeof spec.name !== "string") {
    throw new Error("defineEval: `name` is required");
  }
  if (!spec.input || typeof spec.input.prompt !== "string") {
    throw new Error(`defineEval("${spec.name}"): \`input.prompt\` is required`);
  }
  if (!Array.isArray(spec.scorers) || spec.scorers.length === 0) {
    throw new Error(
      `defineEval("${spec.name}"): at least one scorer is required`,
    );
  }
  if (
    spec.threshold !== undefined &&
    (spec.threshold < 0 || spec.threshold > 1)
  ) {
    throw new Error(
      `defineEval("${spec.name}"): \`threshold\` must be in [0, 1]`,
    );
  }
  return spec;
}
