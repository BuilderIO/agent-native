---
"@agent-native/core": minor
---

Make PostHog a first-class error-reporting and LLM-observability backend, and fix
the malformed exception events it was already receiving.

`captureException()` emitted an event named `$exception` carrying camelCase
properties. PostHog ingests anything by that name and renders it as an issue, but
it groups and symbolicates from `$exception_list` — so every PostHog-configured
app was already collecting exceptions that arrived empty and ungroupable, which
reads as coverage rather than as a failure. The PostHog provider now reshapes
those into a real `$exception_list` with parsed stack frames.

Route errors no longer depend on Sentry. The Nitro `error` hook lived inside
`sentry-plugin.ts`, which returns early when no `SENTRY_DSN` is set, so an app
running PostHog alone reported no route errors at all. The hook moved to
`core-routes-plugin.ts` and goes through the provider-agnostic `captureError()`
registry, so every configured backend receives it. The ~150 lines of
production-tuned drop rules (expected 4xx, permission rejections, Lambda
freeze/thaw `socket hang up`) moved out of Sentry's `beforeSend` into
`server/error-noise-filter.ts` and now apply to every backend — without them a
second backend receives a firehose. Server exceptions are also attributed to the
in-flight user instead of landing under `anonymous`.

Browser exceptions go to PostHog when `POSTHOG_PUBLIC_KEY` / `VITE_POSTHOG_KEY`
is set, posted directly rather than relayed through `/_agent-native/track`, which
requires a session and would drop every signed-out crash. `POSTHOG_API_KEY` is
deliberately not a fallback for the public key: that value is inlined into the
public HTML shell. Note that PostHog does not symbolicate without uploaded source
maps, so minified browser stacks stay minified.

LLM observability now emits the full PostHog trace tree. Previously a run
produced a single `$ai_generation` labelled `agent_run` whose `$ai_parent_id`
pointed at a span that was never sent, so PostHog wrapped it in a placeholder
trace with no steps. Runs now emit `$ai_trace`, one `$ai_span` per tool call, and
a generation parented to the trace. Tool calls ship inside `$ai_output_choices`
even with content capture off, because that is the only thing PostHog derives
`$ai_tools_called` from. The previously dead `capturePrompts` flag is now wired
and gates `$ai_input` and assistant text; disabled fields are omitted rather than
sent empty, and oversized content is replaced with an explicit truncation marker
instead of being silently shortened. `$ai_error` became a structured object with
the terminal code and retryability, and errors captured during a run carry the
run's `$ai_trace_id` so an issue and its trace resolve to each other.

Feedback previously emitted only for thumbs; category and free-text submissions
emitted nothing. All four now report, with `sentiment` still limited to thumbs so
a category follow-up does not double-count the vote. PostHog surfaces feedback in
LLM analytics only through a `survey sent` event, so that is emitted too when
`POSTHOG_AI_FEEDBACK_SURVEY_ID` is configured — and not at all when it is unset,
rather than inventing a survey id.

Agent traces carry the browser session as `$session_id` (read from a new
`X-Agent-Native-Session-Id` header) so a trace joins its session replay, distinct
from `$ai_session_id`, which remains the conversation thread.
