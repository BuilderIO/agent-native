---
title: "Observability"
description: "Agent traces, evals, feedback, A/B experiments, and the admin dashboard — all built-in with zero configuration."
---

# Agent Observability

Every agent-native app gets observability out of the box. Traces, automated evals, user feedback, and A/B experiments work with zero configuration — all data lives in the app's own SQL database.

## What's Captured Automatically

When a user sends a message, the framework automatically records:

- **Token usage** — input, output, cache read, cache write
- **Cost** — computed from token counts and model pricing
- **Latency** — total duration and time per tool call
- **Tool calls** — which actions were invoked, success/error status, duration
- **Automated evals** — 5 quality scores computed after every run

No code changes needed. The instrumentation hooks into `production-agent.ts` transparently.

## The Dashboard

Add the dashboard to any template with a single route:

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

The dashboard has 5 tabs:

| Tab               | What it shows                                                                   |
| ----------------- | ------------------------------------------------------------------------------- |
| **Overview**      | Key metrics — runs, cost, latency, tool success rate, satisfaction, eval score  |
| **Conversations** | Trace list with drill-down to individual spans (agent_run, llm_call, tool_call) |
| **Evals**         | Automated eval scores by criteria, trends over time                             |
| **Experiments**   | A/B test list with status badges, variant results with confidence intervals     |
| **Feedback**      | Thumbs up/down stream, category breakdown, frustration scores                   |

## User Feedback

### Explicit Feedback

Thumbs up/down buttons render inline on every agent message in the chat UI. Thumbs down opens a category popover (Inaccurate, Not helpful, Wrong tool, Too slow). This is wired into `AssistantChat.tsx` automatically.

### Implicit Feedback (Frustration Index)

The framework computes a Frustration Index (0-100) from conversation signals:

| Signal         | Weight | What it detects                     |
| -------------- | ------ | ----------------------------------- |
| Rephrasing     | 30%    | User repeats similar messages       |
| Retry patterns | 20%    | "Try again", "no that's wrong"      |
| Abandonment    | 20%    | Session ends shortly after response |
| Sentiment      | 15%    | Negative language patterns          |
| Length trend   | 15%    | Declining message lengths           |

Score interpretation: 0-20 = healthy, 20-40 = friction, 40-60 = dissatisfied, 60+ = broken session.

## Automated Evals

Five deterministic scorers run after every agent run:

| Criteria            | What it measures                                       | Score range |
| ------------------- | ------------------------------------------------------ | ----------- |
| `tool_success_rate` | % of tool calls without errors                         | 0-1         |
| `step_efficiency`   | Penalizes excessive LLM iterations for tool-using runs | 0-1         |
| `latency_score`     | Normalized against 10s/tool baseline                   | 0-1         |
| `cost_efficiency`   | Normalized against cost baseline                       | 0-1         |
| `error_recovery`    | Did the agent recover from tool errors?                | 0 or 1      |

### LLM-as-Judge (Optional)

Enable sampled LLM-based evaluation by setting `evalSampleRate`:

```ts
import { putSetting } from "@agent-native/core/settings";

await putSetting("observability-config", {
  enabled: true,
  evalSampleRate: 0.05, // 5% of runs
});
```

Custom criteria use natural language rubrics:

```ts
const criteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = unhelpful, 0.5 = partially helpful, 1.0 = fully resolved",
};
```

## A/B Experiments

Test different models, temperatures, or agent configurations:

```ts
// Create via API
POST /_agent-native/observability/experiments
{
  "name": "sonnet-vs-haiku",
  "variants": [
    { "id": "control", "weight": 50, "config": { "model": "claude-sonnet-4-6" } },
    { "id": "treatment", "weight": 50, "config": { "model": "claude-haiku-4-5-20251001" } }
  ],
  "metrics": ["cost", "latency", "satisfaction"]
}

// Start the experiment
PUT /_agent-native/observability/experiments/:id
{ "status": "running" }
```

The agent loop automatically resolves the user's variant and applies the config override. Assignment uses consistent hashing — same user always gets the same variant.

## Configuration

All settings are stored in the `observability-config` key:

```ts
{
  enabled: true,           // Master switch
  capturePrompts: false,   // Store prompt content in traces
  captureToolArgs: false,  // Store action input arguments
  captureToolResults: false, // Store action results
  evalSampleRate: 0,       // 0-1, fraction of runs to LLM-judge
  exporters: []            // OTLP export targets
}
```

Content is **redacted by default** — only token counts, costs, and timing are stored. Opt in to content capture when needed for debugging.

## API Endpoints

All auto-mounted at `/_agent-native/observability/`:

| Method | Path                       | Purpose                        |
| ------ | -------------------------- | ------------------------------ |
| GET    | `/`                        | Overview stats                 |
| GET    | `/traces`                  | List trace summaries           |
| GET    | `/traces/:runId`           | Trace detail (summary + spans) |
| GET    | `/traces/:runId/evals`     | Evals for a run                |
| POST   | `/feedback`                | Submit feedback                |
| GET    | `/feedback`                | List feedback                  |
| GET    | `/feedback/stats`          | Feedback aggregation           |
| GET    | `/satisfaction`            | Satisfaction scores            |
| GET    | `/evals/stats`             | Eval statistics                |
| POST   | `/experiments`             | Create experiment              |
| GET    | `/experiments`             | List experiments               |
| PUT    | `/experiments/:id`         | Update experiment              |
| POST   | `/experiments/:id/results` | Compute results                |
| GET    | `/experiments/:id/results` | Get results                    |

All endpoints support `?since=N` (ms timestamp) and `?limit=N` query params.

## Export to External Platforms

Send traces to Langfuse, Datadog, Grafana, or any OTel-compatible backend:

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer sk-..." },
    },
  ],
});
```

The framework emits `gen_ai.*` semantic convention spans compatible with the OpenTelemetry GenAI spec.

## Error Reporting (Sentry)

Server-side errors that escape Nitro route handlers are reported to Sentry when a DSN is configured. Without it the SDK silently no-ops, so it's safe to leave the env vars unset in dev. Three independent Sentry projects cover the framework:

| Surface             | SDK              | Env var                   | Notes                                                                 |
| ------------------- | ---------------- | ------------------------- | --------------------------------------------------------------------- |
| Browser / SPA       | `@sentry/browser`| `VITE_SENTRY_CLIENT_DSN`  | Captures unhandled errors and route-change breadcrumbs in the client. |
| Nitro server        | `@sentry/node`   | `SENTRY_SERVER_DSN`       | Captures 5xx responses and Nitro lifecycle errors. Per-request user.  |
| `agent-native` CLI  | `@sentry/node`   | _hardcoded_               | Crash reports from the published CLI binary; not user-configurable.   |

### Server-side configuration

Set `SENTRY_SERVER_DSN` in the deploy environment (Netlify dashboard, Cloudflare secrets, etc.). The framework auto-mounts a Nitro plugin that:

1. Calls `Sentry.init` once at startup (idempotent — safe to call from multiple plugins).
2. Resolves the user via `getSession(event)` on every API/framework request and attaches `id` / `email` / `username` plus an `orgId` tag to Sentry's per-request isolation scope. Static-asset paths are skipped to avoid extra DB hits.
3. Captures every framework-route 5xx with searchable `route`, `method`, and `userAgent` tags.

Optional knobs:

- `SENTRY_SERVER_TRACES_SAMPLE_RATE` (float `0`–`1`) — opt in to performance tracing. Defaults to `0` (errors only). Invalid values clamp to `0`.
- `AGENT_NATIVE_RELEASE` — overrides the `release` tag. Defaults to `agent-native-server@<core-version>`.

### Templates

Every template inherits this automatically — there's nothing to import. Templates that want custom behavior (extra tags, different DSN per template, hard-disable Sentry) can override by exporting their own plugin from `server/plugins/sentry.ts`:

```ts
// server/plugins/sentry.ts
import { createSentryPlugin } from "@agent-native/core/server";
export default createSentryPlugin();
```

The CLI's hardcoded DSN is intentional — the published binary needs to phone home crashes regardless of which environment runs it. The server module never hardcodes a DSN because it runs inside customer environments where operators decide whether errors should reach Sentry at all.

### Privacy & PII

Both server and CLI initialize with `sendDefaultPii: false` and a `beforeSend` hook that strips:

- `request.headers.authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `request.cookies`
- `user.ip_address` (auto-collected without consent)
- `contexts.runtime_env` (process env snapshot)
- Any event whose top-level exception type is `ValidationError` (treated as expected user-input rejection, not a bug).

Identity fields explicitly set via `setUser({ id, email, username })` are preserved.
