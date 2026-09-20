/**
 * Public surface for the first-class evals primitive.
 *
 * Authors write `*.eval.ts` (or `evals/*.ts`) files that `export default
 * defineEval(...)`, compose scorers with `createScorer` / the built-ins, and
 * run them with `agent-native eval` (which gates CI on the thresholds).
 *
 * This is complementary to `@agent-native/core`'s observability run-scoring:
 * that scores real production runs after the fact; this actively runs the
 * agent against fixed inputs as a deterministic gate. See `types.ts`.
 */

export { defineEval, DEFAULT_EVAL_THRESHOLD } from "./define-eval.js";
export {
  createScorer,
  clamp01,
  exactMatch,
  contains,
  usesTool,
  llmJudge,
  type LlmJudgeOptions,
} from "./scorer.js";
export {
  createAgentRunner,
  type AgentRunner,
  type AgentRunnerConfig,
  type RunAgentLoopFn,
} from "./agent-runner.js";
export {
  runEvalSuite,
  runEvals,
  scoreEval,
  loadEvals,
  discoverEvalFiles,
  type RunEvalSuiteOptions,
} from "./runner.js";
export { formatReport } from "./report.js";
export type {
  Eval,
  EvalInput,
  EvalRunContext,
  AgentRunOutput,
  Scorer,
  ScorerDefinition,
  ScorerAnalyzeContext,
  ScorerResult,
  EvalResultRow,
  EvalRunReport,
} from "./types.js";
