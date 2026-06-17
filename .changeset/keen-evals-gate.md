---
"@agent-native/core": minor
---

Add a first-class evals primitive and an `agent-native eval` CLI runner that
doubles as a CI deploy gate. Define test cases with `defineEval({ name, input,
scorers, threshold })` and compose scorers with the Mastra-style 4-step
pipeline `createScorer({ preprocess, analyze, generateScore, generateReason })`.
Built-in scorers ship for the common cases — `exactMatch`, `contains`,
`usesTool`, and a provider-agnostic `llmJudge` (the judge model is resolved
from the engine registry, never hardcoded). The runner discovers `**/*.eval.ts`
and `evals/*.ts`, actually runs the agent loop for each input, scores the
output, prints a readable scored table (or `--json` for CI), and exits
non-zero when any eval scores below its threshold. Results are written to the
observability eval store, with a documented seam for future live sampled
scoring of production traffic through the same scorers.
