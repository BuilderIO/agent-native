---
name: observability
description: >-
  Agent observability, evals, feedback, and experiments. Use when adding
  observability dashboards, configuring trace capture, setting up evals,
  creating A/B experiments, or collecting user feedback on agent responses.
scope: dev
metadata:
  internal: true
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

The run span is NAMED by what started it, because the trace list shows that name
and nothing else: a scheduled job is `background_automation_run:<job name>`, a
chat turn is `agent_run`, and a turn a feature sent on the user's behalf is
`agent_run:<usageLabel>` when the caller named it:

```ts
sendToAgentChat({
  message: "Enrich this record from the web",
  newTab: true,
  usageLabel: "crm:enrich-record", // → usage row label + `agent_run:crm:enrich-record`
});
```

Content (prompts, tool args, tool results) is **redacted by default**. Opt in through the declared `observability` config domain:

```ts
// server/plugins/config.ts
import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  observability: {
    aiTelemetryEnabled: true,
    capturePrompts: false,
    captureToolArgs: true, // capture action input args
    captureToolResults: false, // include tool results/error text on tool spans and $ai_generation entries
    evalSampleRate: 0.05, // 5% of runs get LLM-as-judge eval
    inferredSentimentEnabled: false,
    inferredSentimentSampleRate: 0,
    inferredSentimentModel: "gpt-5-6-luna",
  },
});
```

#### Optional inferred sentiment

Self-hosted apps default to no inferred sentiment. First-party apps hosted on
`agent-native.com` automatically classify 100% of eligible user replies with
`gpt-5-6-luna`; an explicit stored `inferredSentimentEnabled: false` remains an
opt-out. Deployment overrides are `AGENT_NATIVE_INFERRED_SENTIMENT=on|off`,
`AGENT_NATIVE_INFERRED_SENTIMENT_SAMPLE_RATE=0..1`, and
`AGENT_NATIVE_INFERRED_SENTIMENT_MODEL=<model>`; `off` is always the emergency
kill switch.

Classification uses only the original visible user text, capped at 2,000
characters, with no tools, temperature 0, an eight-token output, and a five
second timeout. It skips attachment-only turns, internal continuations, chained
background chunks, and first turns that have no preceding response to
attribute. The managed Builder engine runs the classifier after the main
response has streamed, so it does not contend with the user's response.

Successful classifications emit a content-free `$ai_sentiment` tracking event:

- `sentiment`: `positive`, `negative`, or `neutral`
- `method`: `llm`
- `model` / `$ai_model`: model that generated the preceding assistant response
- `run_id` / `$ai_trace_id`: preceding response run
- `thread_id` / `$ai_session_id`: conversation
- `classification_trigger_run_id`: run started by the classified user reply
- `classifier_model` and `classifier_engine`: classifier attribution

No raw message, prompt, or response text is persisted or tracked.

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

#### Evals (CI gate)

The three layers above score *real production runs* after the fact. For an active, deterministic gate, use the first-class `*.eval.ts` primitive from `@agent-native/core/eval` (source: `packages/core/src/eval/*`). It runs the actual agent loop against fixed inputs and exits non-zero below threshold, so it gates CI/deploys.

```ts
// evals/faq.eval.ts
import { defineEval, contains, llmJudge } from "@agent-native/core/eval";

export default defineEval({
  name: "answers the FAQ",
  input: { prompt: "What is your return policy?" },
  threshold: 0.7,
  scorers: [contains("30 days"), llmJudge({ criteria: "accuracy" })],
});
```

- Built-in scorers: `exactMatch` / `contains` / `usesTool` (pure JS) and `llmJudge` (provider-agnostic judge).
- Custom scorers: `createScorer` with the 4-step `preprocess → analyze → generateScore → generateReason` pipeline (only `generateScore` is required).
- Run as a gate: `agent-native eval [pattern] [--json] [--threshold N]` — discovers `**/*.eval.ts` and `evals/*.ts`, runs the agent, and exits non-zero if any eval is below its threshold. An app with no eval files exits `0`. Complements (does not replace) the post-hoc scoring in `evals.ts`. See the Evals doc.

### 4. Experiments

A/B testing with sticky user-level assignment:

```ts
import { insertExperiment, updateExperiment } from "@agent-native/core/observability";

const exp = {
  id: crypto.randomUUID(),
  name: "sonnet-vs-haiku",
  status: "draft" as const,
  variants: [
    { id: "control", weight: 50, config: { model: "claude-sonnet-4-6" } },
    { id: "treatment", weight: 50, config: { model: "claude-haiku-4-5-20251001" } },
  ],
  metrics: ["cost", "latency", "satisfaction"],
  assignmentLevel: "user" as const,
  startedAt: null,
  endedAt: null,
  createdAt: Date.now(),
};
await insertExperiment(exp);
// Move it to "running" when ready to start collecting assignments.
await updateExperiment(exp.id, { status: "running" });
```

The agent loop reads active experiments via `resolveActiveExperimentConfig()` and applies the variant's `model` override automatically. Assignment uses consistent hashing — same user always gets the same variant.

Compute results with `POST /_agent-native/observability/experiments/:id/results`.

In production, experiment management routes require the caller's email in the
comma-separated `AGENT_NATIVE_EXPERIMENT_ADMIN_EMAILS` allowlist. This gate is
separate from normal app/org admin roles because an experiment affects every
user in that deployment.

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
import { ObservabilityDashboard } from "@agent-native/core/client/observability";

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
| `packages/core/src/observability/posthog-ai.ts` | `$ai_trace` / `$ai_span` / `survey sent` emission, content bounding, `$ai_error` |
| `packages/core/src/observability/feedback.ts` | Feedback + Frustration Index |
| `packages/core/src/observability/evals.ts` | Eval engine (3 layers) |
| `packages/core/src/observability/experiments.ts` | A/B testing system |
| `packages/core/src/observability/routes.ts` | HTTP API handlers |
| `packages/core/src/client/observability/ObservabilityDashboard.tsx` | Admin dashboard |
| `packages/core/src/client/observability/ThumbsFeedback.tsx` | Inline feedback buttons |
| `packages/core/src/client/observability/useObservability.ts` | React Query hooks |

## Export to External Platforms

Core emits `gen_ai.*` semantic convention spans and deliberately registers no OpenTelemetry provider or exporter itself (`observability/tracing.ts`). To reach Langfuse, Datadog, Grafana, New Relic, or any OTel-compatible backend, the app registers its own `TracerProvider`.

There is no framework config field for an export endpoint or token, and there should not be: the backend credential belongs in the vault and in the app's own provider wiring, not in a config object or a settings row.

## Live OpenTelemetry Spans (Optional)

The agent loop emits **live OpenTelemetry spans** for every run, model call, and tool call, so a host that already runs an OTel collector sees agent activity alongside its other distributed traces.

This layer is optional and **no-op by default**:

- `@opentelemetry/api` is an **optional dependency**. If it isn't installed, the span helpers degrade to silent no-ops — they never throw into the agent loop.
- Even with the api package installed, it ships a default no-op tracer. Spans become real only once the **host registers a `TracerProvider`** (via `@opentelemetry/sdk-node` or similar). The framework deliberately does not depend on the heavy SDK/exporter packages and never registers a provider itself — instrumentation is opt-in by the embedding app.

The loop emits `agent.run` (with `agent.run_id`, `agent.thread_id`, `agent.user_id`, `agent.model`), `tool.call` (`tool.name` + status), and `llm.call` spans, each finished with OK/ERROR status. This is purely additive to the in-house `agent_trace_spans` / `agent_trace_summaries` tables. Source: `packages/core/src/observability/tracing.ts` + `traces.ts`. See the Observability doc for the full table.

## Tracking Bridge

Instrumented agent loops emit server-side tracking events for every run through
`track()` from `@agent-native/core/tracking`, so configured PostHog, Agent-Native
Analytics, Mixpanel, Amplitude, and webhook providers receive them through the
same best-effort fan-out as other tracking events.

- Events: `$ai_trace` per run, `$ai_span` per tool call, and `$ai_generation`
  per model call. Every node carries the run id as `$ai_trace_id` and links
  upward through `$ai_parent_id` so a backend can rebuild the tree.
  `$ai_session_id` is the thread; the browser session is separate and ships as
  `$session_id`, read from `X-Agent-Native-Session-Id` via
  `RequestContext.browserSessionId`. The agent chat and the action client both
  send that header, so a UI action call and the agent's own call during one
  visit share a session. `setAnalyticsSessionId()` from
  `@agent-native/core/client/analytics` pins a custom id and opts it out of the
  30-minute idle rotation. Emission lives in `posthog-ai.ts`.
- Each event is stamped with when it happened, not when the run flushed. The
  whole tree is emitted in one burst at run end, so `track()` takes an
  `occurredAt` and the trace tree keeps a real timeline.
- Agent-Native Analytics shape: the same event lands in `analytics_events` with
  mirrored query-friendly properties such as `run_id`, `thread_id`,
  `cost_cents_x100`, `duration_ms`, `tool_calls`, `successful_tools`,
  `failed_tools`, and `status`. A content-free `tools` array includes at most
  50 tool names, start offsets, durations, statuses, and coarse error classes;
  interrupted calls are finalized as errors, and failed runs still emit with
  zero or known usage. `tools_truncated` marks longer runs while the rollup counts remain complete.
  Delegated runs add `delegation_protocol`, `caller_app`, `a2a_task_id`, and
  `parent_run_id` when available. `parent_turn_id` is separate because one
  logical turn may span multiple concrete runs.

Constraints that are not visible from the emit site:

- **The trace event carries no latency, tokens, or cost under `$ai_*`.** PostHog
  DERIVES those from a trace's children: its trace query sums `$ai_latency` over
  every event whose `$ai_parent_id` is the trace or is absent, and sums
  tokens/cost over `$ai_generation` / `$ai_embedding` only. An `$ai_latency` on
  the `$ai_trace` event is therefore added to its own children's and reports
  roughly twice the real duration. Run totals ride along as `duration_ms`,
  `input_tokens`, `output_tokens`, and `cost_usd` for the backends that do no
  such aggregation.
- **The generation's `$ai_latency` is model time, not run time.** Tool calls are
  siblings under the same trace and PostHog adds their latency to the
  generation's, so tool duration is subtracted out. `duration_ms` on the same
  event is still the full run — the two differ on purpose.
- **`$ai_http_status` is absent, not defaulted, when the status is unknown.** A
  generation that streamed to completion reports 200, and the call the run died
  in reports whatever status the engine named (`EngineError.statusCode`, or a
  provider SDK error's `status`). A failure that carried no status — a socket
  drop, an SDK throw — omits the field: a defaulted 200 would report the drop as
  a healthy call, and a defaulted 500 would invent a rejection the provider
  never made. Only the failing round-trip claims the error's status; earlier
  calls that completed keep their 200.
- **PostHog's `$ai_*` latency fields are seconds; ours are milliseconds.**
  `$ai_latency` and `$ai_time_to_first_token` are seconds;
  `duration_ms` and `time_to_first_token_ms` are the millisecond siblings the
  first-party dashboards read. Feeding a millisecond value to a seconds field is
  invisible in the payload and inflates the metric 1000x.
- **Custom properties never take an `$ai_` prefix.** That namespace belongs to
  PostHog's schema; a name it does not define today it may define tomorrow with
  a different meaning. Ours are plain (`duration_ms`, `input_truncated`,
  `spans_dropped`), which also keeps them out of PostHog's `$ai_*` aggregation.
- **`$ai_trace` carries no `$ai_input_state` / `$ai_output_state`.** Content
  rides the generations; a trace-level copy repeated the run's prompt and answer
  on a second event. PostHog reads a trace's input and output from that event
  and from nowhere else, so the visible cost is that traces list with a null
  input and a conversation is titled from the first generation's `$ai_input`
  instead. Measured, not assumed — check whether that title is still wrong
  before trading the duplication back.

- **One generation per model round-trip.** Engines that bracket their calls with
  `model_stream` get one `$ai_generation` each, with that call's tools as its
  children. Only an engine that never brackets falls back to a single aggregate
  generation covering the whole run, and it is reported as one.
- **Messages are rewritten into PostHog's shape before they ship.**
  `toPostHogMessages()` in `posthog-ai.ts` maps engine parts onto the
  OpenAI/Anthropic conventions PostHog reads: `tool-call` becomes `tool_calls`,
  and a `tool-result` — which the engine has to carry inside a `user` message,
  because `EngineMessage` has no `tool` role — becomes its own `role: "tool"`
  message. Skipping this is not cosmetic: PostHog dumps raw JSON for shapes it
  does not know, and the byte-ceiling rescue in `boundAiContent` keeps "the last
  user message", which in engine shape is the last tool result rather than the
  question. Attachment bodies become a marker naming the media type and size —
  base64 renders as nothing in PostHog and spends the whole ceiling.
- **A tool call and its result pair on the id the MODEL issued.** The span id is
  a separate namespace that never appears in the transcript, so emitting it on
  `tool_calls[].id` leaves PostHog with a call and a result that never match and
  every tool call renders with no output. Span id is the fallback only for
  emitters that report no call id.
- **Disabled capture omits the field rather than sending an empty one.** An
  empty array is indistinguishable from a run that genuinely had no messages.
  Truncated content is marked, and a run over the span cap stamps
  `spans_dropped` — a truncated run must not read as a complete one. The one
  deliberate exception is a tool span's `$ai_output_state` with
  `captureToolResults` off: it carries an explicit "withheld" marker, because an
  absent output state reads as a tool that returned nothing, and the tool did
  answer.
- **A tool that RETURNS an error envelope is a success here.** `$ai_is_error`
  and `failed_tools` follow the tool event's `isError`, which the agent sets
  when an action throws. An action that returns `{ error: ... }` instead is
  counted as a healthy call by every rollup on this page. Fix it in the action
  (`fail()`), not by teaching this layer to sniff payload shapes.
- **The structural tool-call list ships even when content capture is off.**
  Backends derive their tool tags from tool-call blocks inside the output
  choices and from nothing else, so tool names (without arguments) are always
  emitted. The parallel first-party `tools` array stays because the dashboards
  read it; that duplication is deliberate, not cleanup.
- **Only thumbs carry `sentiment`.** All four feedback types are reported, but a
  category follow-up to a thumbs-down is detail about the same vote — counting
  it again inflates the metric.
- **Never invent an external id to make an integration light up.** Survey-based
  feedback is emitted only when a real survey id is configured, and nothing is
  sent otherwise.

Do not build a separate LLM-observability ingestion API unless there is a clear
reason the tracking provider registry cannot express the use case. Keep prompt,
tool input, and model output content out of tracking by default; use the existing
observability config flags for local trace content capture.
