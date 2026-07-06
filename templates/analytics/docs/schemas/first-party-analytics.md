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

## LLM observability events

Core emits LLM usage as first-party events with:

```txt
event_name = '$ai_generation'
```

Useful query fields live in `properties`:

| Property                                         | Description                               |
| ------------------------------------------------ | ----------------------------------------- |
| `$ai_trace_id`, `run_id`                         | Agent run id                              |
| `$ai_session_id`, `thread_id`                    | Chat/thread id, when available            |
| `$ai_model`, `model`                             | Model used                                |
| `$ai_provider`, `provider`                       | Engine/provider name                      |
| `$ai_input_tokens`, `input_tokens`               | Input tokens                              |
| `$ai_output_tokens`, `output_tokens`             | Output tokens                             |
| `cache_read_tokens`, `cache_write_tokens`        | Prompt-cache token counts                 |
| `$ai_total_cost_usd`, `cost_usd`                 | Estimated run cost in USD                 |
| `cost_cents_x100`                                | Estimated run cost in centicents          |
| `$ai_latency`, `duration_ms`                     | Run duration in seconds / milliseconds    |
| `tool_calls`, `successful_tools`, `failed_tools` | Tool-call counts                          |
| `$ai_is_error`, `status`, `$ai_error`            | Error status and message, when applicable |

Install the `agent-observability-llm` dashboard template for canned panels over
these events.

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
