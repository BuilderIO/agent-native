---
title: "Evals (CI Gate)"
description: "Write *.eval.ts test cases that run the real agent against fixed inputs, score the output with composable scorers, and gate CI/deploys on a threshold."
---

# Evals (CI Gate)

Evals are a first-class testing primitive: you declare a prompt plus the behavior you expect, the runner **actually runs the agent loop** against that input, scores the output with composable scorers, and exits non-zero if any case scores below its threshold. That non-zero exit makes `agent-native eval` a drop-in CI deploy gate.

This is complementary to the post-hoc scoring in [Observability](/docs/observability):

- **Observability evals** (`observability/evals.ts`) — _"how did this real run do?"_ Passive, sampled, lives next to traces.
- **`*.eval.ts` (this primitive)** — _"does the agent do the right thing on this fixed input?"_ Active, deterministic, a CI gate run via the CLI.

The runner resolves a provider-agnostic engine/model from the existing registry — no model is hardcoded — so the same suite runs against whatever engine the app is configured for.

## Writing an eval {#writing}

Drop a `*.eval.ts` file anywhere in the app (or an `evals/*.ts` file). Each file `export default defineEval(...)` (or exports an array of them):

```ts
// evals/greeting.eval.ts
import { defineEval, contains, llmJudge } from "@agent-native/core/eval";

export default defineEval({
  name: "greets the user by name",
  input: { prompt: "Say hi to Ada." },
  threshold: 0.7, // per-scorer pass bar; default 0.5
  scorers: [
    contains("Ada"),
    llmJudge({ criteria: "friendliness", rubric: "1.0 = warm greeting" }),
  ],
});
```

An eval passes only when **every** scorer meets the threshold. Key `defineEval` fields:

| Field       | Type                  | Notes                                                         |
| ----------- | --------------------- | ------------------------------------------------------------- |
| `name`      | string                | Required. Shown in the report.                                |
| `input`     | `{ prompt, history }` | Required `prompt`; optional prior `{ role, text }` turns.     |
| `scorers`   | `Scorer[]`            | Required, at least one.                                       |
| `threshold` | number `0..1`         | Per-scorer pass bar. Default `0.5`; overridable from the CLI. |
| `run`       | function              | Optional override for custom setup (seed data, multi-turn).   |

The agent run handed to scorers is small and transport-agnostic:

```ts
interface AgentRunOutput {
  text: string; // concatenated assistant text
  toolCalls: readonly string[]; // tool/action names, in call order
  ok: boolean; // completed without a terminal error
  error?: string;
  runId: string;
  durationMs: number;
}
```

## Built-in scorers {#built-in}

Imported from `@agent-native/core/eval`:

| Scorer                   | Score                                                             | Model? |
| ------------------------ | ----------------------------------------------------------------- | ------ |
| `exactMatch(expected)`   | `1.0` if text equals `expected` (trimmed, case-insensitive)       | No     |
| `contains(needles)`      | Fraction of required substrings present (so partial hits surface) | No     |
| `usesTool(toolName)`     | `1.0` if the agent invoked that tool/action at least once         | No     |
| `llmJudge({ criteria })` | LLM-as-judge scored against a natural-language rubric, → `0..1`   | Yes    |

`exactMatch` and `contains` take an optional `{ caseSensitive }`. `llmJudge` takes `{ criteria, rubric?, name?, scoreRange? }` — its output is normalized to `[0, 1]`, and the judge model is whatever the runner resolved (never a hardcoded provider).

## Custom scorers: the 4-step pipeline {#custom}

`createScorer` builds a scorer from a Mastra-style 4-step pipeline. Only `generateScore` is required:

```txt
preprocess(run)     → x          transform the run/output (optional)
analyze(x, ctx)     → analysis   plain JS OR an LLM judge (optional)
generateScore(a)    → 0..1       REQUIRED, normalized
generateReason(...) → string     human-readable why (optional)
```

`preprocess` and `analyze` default to identity (the scorer sees the raw `AgentRunOutput`). The `analyze` step receives a `ctx` with a provider-agnostic `judge()` helper for LLM-backed scoring:

```ts
import { createScorer, clamp01 } from "@agent-native/core/eval";

// A scorer that rewards short, tool-using answers.
const concise = createScorer({
  name: "concise_with_tool",
  analyze(run) {
    return {
      words: run.text.trim().split(/\s+/).length,
      usedTool: run.toolCalls.length > 0,
    };
  },
  generateScore({ words, usedTool }) {
    if (!usedTool) return 0;
    return clamp01(1 - Math.max(0, words - 40) / 200);
  },
  generateReason({ analysis }) {
    return `${analysis.words} words, tool used: ${analysis.usedTool}`;
  },
});
```

## Running the gate {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # only files whose path contains "billing"
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

The command discovers `**/*.eval.ts` and `evals/*.ts` under the current app, runs the agent for each input, scores it, prints a readable table (or JSON), and **exits non-zero if any eval scores below its threshold**.

Exit codes:

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | All evals passed — _or_ no eval files were found (CI-friendly). |
| `1`  | At least one eval scored below threshold, or the suite errored. |
| `2`  | Bad arguments (e.g. `--threshold` outside `[0, 1]`).            |

### As a CI deploy gate {#ci}

Add it to the pipeline that runs before a deploy:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

A regression that drops any scorer below threshold fails the step and blocks the deploy. An app with no eval files exits `0`, so adopting evals is opt-in per app.

## What's next

- [**Observability**](/docs/observability) — post-hoc scoring of real production runs (the complementary layer)
- [**Actions**](/docs/actions) — the tools/actions that show up in `toolCalls`
- [**Agent Teams**](/docs/agent-teams) — sub-agents an eval might exercise
