---
"@agent-native/core": patch
---

Fix PostHog LLM analytics events so trace, span, and generation metrics match PostHog's schema and aggregation.

- `$ai_time_to_first_token` is now sent in seconds. It was being handed the millisecond value verbatim, inflating every time-to-first-token in LLM analytics 1000x.
- The `$ai_trace` event no longer carries `$ai_latency`, `$ai_input_tokens`, `$ai_output_tokens`, or `$ai_total_cost_usd`. PostHog derives all four from a trace's children, and summed the trace's own `$ai_latency` alongside them — reporting roughly twice the real run duration. The run totals now ride along as `duration_ms`, `input_tokens`, `output_tokens`, and `cost_usd` for backends that do no such aggregation.
- The generation's `$ai_latency` is measured model time rather than the whole run, so tool duration is no longer counted both in the generation and in its sibling tool spans. It is read from the `model_stream` start/end brackets the agent loop already emits once per LLM round-trip, which close before any tool of that turn starts. Engines that do not bracket their model calls fall back to backing tool time out of the run duration — counting overlapping tools once, and leaving in the time of tools that `captureLlmSpans` or the per-run span cap keeps out of PostHog, since no sibling span would carry it. The new `latency_source` property records which of the two produced a given `$ai_latency`.
- A tool `$ai_span` is timestamped at the tool's start rather than its completion. PostHog draws a span forward from its event timestamp by `$ai_latency`, so a completion-stamped span rendered the tool beginning where it ended and running past the end of its own trace.
- `$ai_request_count` reports the run's real LLM round-trip count instead of a hardcoded `1`, which undercharged multi-step runs on request-priced models.
- `$ai_trace` now carries `$ai_input_state` / `$ai_output_state` when `capturePrompts` is on. PostHog reads a trace's input and output only from that event, so the trace detail view was empty.
- Successful tool calls now record their result on the span under `captureToolResults`, so a healthy tool span reports an output instead of looking like a tool that returned nothing.
- AI events are stamped with when they happened rather than when the run flushed. `track()` accepts an `occurredAt`, so a trace tree keeps a real timeline instead of collapsing into one instant.
- `$ai_stream` is set, which is what makes `$ai_time_to_first_token` meaningful.
- Custom properties no longer use an `$ai_` prefix (`$ai_input_truncated` → `input_truncated`, `$ai_spans_dropped` → `spans_dropped`). That namespace is PostHog's schema and a name it does not define today it may define tomorrow.
