import type { Eval } from "./types.js";

export const DEFAULT_EVAL_THRESHOLD = 0.5;

export function defineEval(spec: Eval): Eval {
  if (!spec.name || typeof spec.name !== "string") {
    throw new Error("defineEval: `name` is required");
  }
  if (!spec.input || typeof spec.input.prompt !== "string") {
    throw new Error(`defineEval("${spec.name}"): \`input.prompt\` is required`);
  }
  if (
    (!Array.isArray(spec.scorers) || spec.scorers.length === 0) &&
    !spec.skipReason
  ) {
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
