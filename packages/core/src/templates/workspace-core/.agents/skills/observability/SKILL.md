---
name: observability
description: >-
  Agent observability, evals, feedback, and experiments. Use when adding
  observability dashboards, configuring trace capture, setting up evals,
  creating A/B experiments, or collecting user feedback on agent responses.
---

# Agent Observability

## Rule

The observability system auto-instruments every agent run with zero configuration. Traces, automated evals, and feedback collection work out of the box. All data lives in the app's own SQL database — no external services required. Templates can optionally export to Langfuse, Datadog, or any OTel-compatible platform.

## Five Pillars

### 1. Traces

Every `runAgentLoop()` call is automatically instrumented via `instrumentAgentLoop()` in `packages/core/src/observability/traces.ts`. It captures:

- **agent_run** span — top-level parent with total duration and cost
- **llm_call** span — model name, token counts (input, output, cache read/write), cost
- **tool_call** spans — one per action invocation, with duration and success/error

Content (prompts, tool args, tool results) is **redacted by default**. Opt in via the `observability-config` settings key:

```ts
await putSetting("observability-config", {
  enabled: true,
  capturePrompts: false,
  captureToolArgs: true,    // capture action input args
  captureToolResults: false,
  evalSampleRate: 0.05,     // 5% of runs get LLM-as-judge eval
});
```

### 2. Feedback

**Explicit** — `ThumbsFeedback` component renders inline thumbs up/down on every agent message in the chat UI. Thumbs down opens a category popover (Inaccurate, Not helpful, Wrong tool, Too slow). Already wired into `AssistantChat.tsx` via `React.lazy`.

**Implicit** — `computeSatisfactionScore(threadId)` computes a Frustration Index (0-100) from conversation signals:
- Rephrasing detection (weight 30): consecutive similar user messages
- Abandonment (weight 20): session ends shortly after agent response
- Sentiment (weight 15): negative language patterns
- Length trend (weight 15): declining message lengths
- Retry patterns (weight 20): "try again", "no that's wrong"

Score interpretation: 0-20 healthy, 20-40 friction, 40-60 dissatisfied, 60+ broken.

Satisfaction scoring fires automatically after each feedback POST with a threadId.

### 3. Evals

Three layers, configured via `evalSampleRate` in the observability config:

**Automated (every run):** Deterministic scorers that run after every traced run:
- `tool_success_rate` — % of tool calls without errors
- `step_efficiency` — 1.0 for no-tool runs; penalizes excessive LLM iterations for tool-using runs
- `latency_score` — normalized against 10s/tool baseline
- `cost_efficiency` — normalized against 50 centicents/tool baseline
- `error_recovery` — 1.0 if the run recovered from tool errors or had none

**LLM-as-judge (sampled):** Runs on `evalSampleRate` fraction of runs. Calls the configured engine with a judge prompt that scores against custom criteria.

**Dataset evaluation:** `runDatasetEval(datasetId)` runs a golden dataset through the agent and scores each case.

Custom criteria use natural language rubrics:
```ts
const criteria: EvalCriteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = completely unhelpful, 0.5 = partially helpful, 1.0 = fully resolved the user's need",
};
```

### 4. Experiments

A/B testing with sticky user-level assignment:

```ts
import { createExperiment, startExperiment } from "@agent-native/core/observability";

const exp = await createExperiment({
  name: "sonnet-vs-haiku",
  variants: [
    { id: "control", weight: 50, config: { model: "claude-sonnet-4-6" } },
    { id: "treatment", weight: 50, config: { model: "claude-haiku-4-5-20251001" } },
  ],
  metrics: ["cost", "latency", "satisfaction"],
});
await startExperiment(exp.id);
```

The agent loop reads active experiments via `resolveActiveExperimentConfig()` and applies the variant's `model` override automatically. Assignment uses consistent hashing — same user always gets the same variant.

Compute results with `POST /_agent-native/observability/experiments/:id/results`.

### 5. Dashboard

`ObservabilityDashboard` is a React component with 5 tabs:
- **Overview** — metric cards (runs, cost, latency, tool success, thumbs up rate, eval score)
- **Conversations** — trace list with drill-down to span detail
- **Evals** — eval stats and criteria breakdown bars
- **Experiments** — experiment list with status badges, drill-down to results
- **Feedback** — feedback stream, thumbs ratio, category badges

Add a dashboard route to any template:
```tsx
// app/routes/observability.tsx
import { ObservabilityDashboard } from "@agent-native/core/client";

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
```

## API Endpoints

All auto-mounted at `/_agent-native/observability/*`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Overview stats |
| GET | `/traces` | List trace summaries |
| GET | `/traces/:runId` | Trace detail (summary + spans) |
| GET | `/traces/:runId/evals` | Evals for a run |
| POST | `/feedback` | Submit feedback |
| GET | `/feedback` | List feedback entries |
| GET | `/feedback/stats` | Feedback aggregation |
| GET | `/satisfaction` | Satisfaction scores |
| GET | `/evals/stats` | Eval statistics |
| POST | `/experiments` | Create experiment |
| GET | `/experiments` | List experiments |
| GET | `/experiments/:id` | Experiment detail |
| PUT | `/experiments/:id` | Update experiment status |
| POST | `/experiments/:id/results` | Compute experiment results |
| GET | `/experiments/:id/results` | Get experiment results |

All endpoints support `?since=N` (ms timestamp) and `?limit=N` query params.

## SQL Tables

9 tables created automatically via `ensureObservabilityTables()`:
- `agent_trace_spans` — individual trace spans
- `agent_trace_summaries` — aggregated run summaries
- `agent_feedback` — explicit user feedback
- `agent_satisfaction_scores` — computed frustration index
- `agent_evals` — evaluation results
- `agent_eval_datasets` — golden test datasets
- `agent_experiments` — experiment definitions
- `agent_experiment_assignments` — user → variant assignments
- `agent_experiment_results` — computed metric results

All tables are dialect-agnostic (SQLite + Postgres) and strictly additive.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/observability/types.ts` | Shared type definitions |
| `packages/core/src/observability/store.ts` | SQL tables + CRUD |
| `packages/core/src/observability/traces.ts` | Auto-instrumentation |
| `packages/core/src/observability/feedback.ts` | Feedback + Frustration Index |
| `packages/core/src/observability/evals.ts` | Eval engine (3 layers) |
| `packages/core/src/observability/experiments.ts` | A/B testing system |
| `packages/core/src/observability/routes.ts` | HTTP API handlers |
| `packages/core/src/client/observability/ObservabilityDashboard.tsx` | Admin dashboard |
| `packages/core/src/client/observability/ThumbsFeedback.tsx` | Inline feedback buttons |
| `packages/core/src/client/observability/useObservability.ts` | React Query hooks |

## Export to External Platforms

Configure OTLP export in the observability settings:

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer ..." },
    },
  ],
});
```

The framework emits `gen_ai.*` semantic convention spans compatible with Langfuse, Datadog, Grafana, New Relic, and any OTel-compatible backend.
