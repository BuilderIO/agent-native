# First-Party Analytics

The analytics template can collect events into its own SQL database and query them as the `first-party` dashboard data source. This is separate from general app DB querying: use `source: "first-party"` in dashboard panels or the `query-agent-native-analytics` action, not `db-query`.

## Create a public key

Generate a public write key from **Data Sources > First-party Analytics**, or ask the agent to run `create-analytics-public-key --name "<label>"`.

Set the key on emitting apps:

```sh
AGENT_NATIVE_ANALYTICS_PUBLIC_KEY=anpk_...
VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY=anpk_...
```

The core `track()` and browser `trackEvent()` helpers automatically send to `https://analytics.agent-native.com/track` when those env vars are present. Localhost is skipped by default.

Agent loop observability also uses this same tracking path. When an emitting app
has `AGENT_NATIVE_ANALYTICS_PUBLIC_KEY` configured and observability is enabled,
core emits one PostHog-compatible `$ai_generation` event per instrumented agent
run with model, token, cache-token, latency, tool-count, status, and cost
properties. Prompts, tool inputs, and model outputs are not included by default.

## Endpoint

Use either endpoint shape:

```txt
POST https://analytics.agent-native.com/track
POST https://your-analytics-domain.com/api/analytics/track
```

Headers:

```txt
Content-Type: application/json
x-agent-native-analytics-key: anpk_...  # optional; can also be in the body
```

Single-event body:

```json
{
  "publicKey": "anpk_...",
  "event": "click template",
  "userId": "user@example.com",
  "anonymousId": "anon_123",
  "sessionId": "session_123",
  "timestamp": "2026-05-01T12:00:00.000Z",
  "properties": {
    "app": "docs",
    "template": "mail",
    "signed_in": true,
    "url": "https://agent-native.com/templates/mail"
  },
  "context": {
    "source": "docs"
  }
}
```

Batch body:

```json
{
  "publicKey": "anpk_...",
  "events": [
    {
      "event": "click template",
      "properties": {
        "app": "docs",
        "template": "mail"
      }
    }
  ]
}
```

Batches may include up to 100 events. Event names may be sent as `event` or `name`; keys may be sent as `publicKey`, `writeKey`, `apiKey`, or the `x-agent-native-analytics-key` header.

Successful requests return:

```json
{ "success": true, "accepted": 1 }
```

Invalid keys return `401`; malformed payloads return `400`.

## Stored fields

Events are stored in `analytics_events`. Common query columns include:

| Column                                | Description                                            |
| ------------------------------------- | ------------------------------------------------------ |
| `event_name`                          | Event name                                             |
| `timestamp`                           | Client event timestamp                                 |
| `received_at`                         | Collector receive time                                 |
| `user_id`                             | Identified user, when supplied                         |
| `anonymous_id`                        | Anonymous/distinct visitor id                          |
| `session_id`                          | Session id                                             |
| `app`                                 | App/site name, usually from `properties.app`           |
| `template`                            | Template dimension, usually from `properties.template` |
| `signed_in`                           | Signed-in state copied from `signed_in` or `signedIn`  |
| `url`, `path`, `hostname`, `referrer` | Page context                                           |
| `properties`, `context`               | Original JSON objects                                  |

## Action response telemetry

`event_name = 'action.response'` records one browser transport attempt, not a
user-level operation. Its `success` and `outcome` properties describe whether
that attempt completed, timed out, was cancelled, or failed at the network or
HTTP layer. Query retries and background polling are separate attempts.

The client always records errors, slow responses, 4xx responses, and startup
responses. Fast successes may be sampled. Those rows include `sample_rate`,
`sampled`, and `sample_weight = 1 / sample_rate`; use the weight for aggregate
counts instead of treating sampled rows as a complete request census. Keep
`outcome = 'cancelled'` separate from failures, and split GET reads from
mutations before presenting an action success rate. This metric is not a
substitute for user-operation success or task completion.

## Server action response telemetry

`event_name = 'http.response'` is the server-observed request outcome. Action
routes include `route_kind = 'framework'`, an `action_name`, the HTTP
`status_code`, `duration_ms`, and a server-generated `request_id`. Join that
ID with `action.response` when you need to compare the browser attempt with
what the server actually completed.

Errors, slow requests, startup requests, and database failures are retained
with `sampled = false` and `sample_rate = 1`. Fast requests may be sampled;
use `sample_weight = 1 / sample_rate` for aggregate counts. This event is a
server transport measurement, not a user-level operation: retries and
background polling remain separate requests. Mutation user outcomes are
represented by the server-side `action_started`, `action_completed`, and
`action_failed` events.

When a host has an OpenTelemetry provider, the reviewed timing-bearing events
are mirrored as best-effort spans: `action.client` for browser action
responses, `http.server` for server responses, `action.server` for mutation
outcomes, and dedicated spans for agent, A2A, and LLM lifecycle events.
Ordinary clicks and caller-defined event names stay in analytics rather than
becoming spans. Server request boundaries await the queued OTel mirror before
completion, while export remains optional and isolated from request failures.

## LLM observability events

Core emits LLM usage, explicit user feedback, and optional inferred message
sentiment as first-party events with:

```txt
event_name = '$ai_generation'
event_name = '$ai_feedback'
event_name = '$ai_sentiment'
```

Useful query fields live in `properties`:

| Property                                         | Description                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `$ai_trace_id`, `run_id`                         | Agent run id                                                                                                             |
| `$ai_session_id`, `thread_id`                    | Chat/thread id, when available                                                                                           |
| `$ai_model`, `model`                             | Model used                                                                                                               |
| `$ai_provider`, `provider`                       | Engine/provider name                                                                                                     |
| `$ai_input_tokens`, `input_tokens`               | Input tokens                                                                                                             |
| `$ai_output_tokens`, `output_tokens`             | Output tokens                                                                                                            |
| `cache_read_tokens`, `cache_write_tokens`        | Prompt-cache token counts                                                                                                |
| `$ai_total_cost_usd`, `cost_usd`                 | Estimated run cost in USD                                                                                                |
| `cost_cents_x100`                                | Estimated run cost in centicents                                                                                         |
| `duration_ms`                                    | Run duration in milliseconds                                                                                             |
| `$ai_latency`                                    | Model time in seconds (run duration minus tool time), on `$ai_generation`                                                |
| `tool_calls`, `successful_tools`, `failed_tools` | Complete tool-call counts                                                                                                |
| `tools`, `tools_truncated`                       | First 50 tool names, offsets, durations, statuses, and error classes, including interrupted calls                        |
| `delegated`, `delegation_protocol`, `caller_app` | Delegated-run attribution                                                                                                |
| `a2a_task_id`, `parent_run_id`, `parent_turn_id` | Cross-app trace linkage, when available                                                                                  |
| `$ai_is_error`, `status`, `$ai_error`            | Error status and message, when applicable                                                                                |
| `$ai_http_status`                                | Provider HTTP status: 200 on a completed call, the reported status on a failed one, absent when the failure carried none |

The `tools` array never includes tool arguments, results, or error messages.
Use `tools_truncated` with the complete `tool_calls` count when a run exceeds
the 50-entry detail cap.
Failed runs still emit a generation row with zero or known usage so delegated
timeouts and setup failures remain visible.

Explicit thumbs feedback is content-free and uses these `$ai_feedback`
properties:

| Property              | Description                                    |
| --------------------- | ---------------------------------------------- |
| `sentiment`           | Explicit `positive` or `negative` user rating  |
| `feedback_type`       | Feedback control/type that produced the rating |
| `$ai_model`, `model`  | Model that generated the rated agent response  |
| `run_id`, `thread_id` | Related agent run and thread identifiers       |

These values describe user-provided thumbs feedback.

When optional inferred sentiment is enabled, content-free `$ai_sentiment`
events use these properties:

| Property              | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `sentiment`           | Inferred `positive`, `neutral`, or `negative` classification |
| `method`              | Classification method; `llm` for model-inferred sentiment    |
| `$ai_model`, `model`  | Main model attributed to the preceding agent response        |
| `classifier_model`    | Small model used only to classify sentiment                  |
| `run_id`, `thread_id` | Related agent run and thread identifiers                     |

The inferred-sentiment event does not contain message text. Keep it separate
from `$ai_feedback`: inferred sentiment is a model classification, while
feedback sentiment is an explicit user rating. For by-model reporting, group
on `$ai_model` or `model`; use `classifier_model` only to audit classifier usage.

Agent-Native observability panels belong in the canonical Agent-Native dashboard
(`agent-native-templates-first-party`), including generation metrics, explicit
feedback sentiment, optional inferred message sentiment, and separate
by-main-model breakdowns. Do not publish or install a separate observability
dashboard.

Example dashboard panel:

```json
{
  "id": "clicks-by-template",
  "title": "Clicks by Template",
  "source": "first-party",
  "chartType": "bar",
  "width": 1,
  "sql": "SELECT COALESCE(NULLIF(template, ''), 'unknown') AS template, COUNT(*) AS count FROM analytics_events WHERE event_name = 'click template' GROUP BY COALESCE(NULLIF(template, ''), 'unknown') ORDER BY count DESC LIMIT 20",
  "config": { "xKey": "template", "yKey": "count" }
}
```
