---
"@agent-native/core": patch
---

Share one browser session id across the agent run and the actions a page calls. Only the chat adapter sent `X-Agent-Native-Session-Id`, and only the agent-run path read it, so `RequestContext.browserSessionId` was always undefined inside an action — a UI action call and the agent's own call during the same visit could not be joined to one `$session_id`. The action client now sends the header and the action route reads it into request context.

Let `track()` take an action's `ctx` as its third argument — `track("project_created", { template }, ctx)` — instead of restating `{ userId: ctx?.userEmail }` at every call site, and resolve the browser session from the ambient request context so no caller has to thread it. `TrackingEvent` carries it as a typed `sessionId` that each provider maps to its own field (`$session_id` for PostHog, a `session_id` property for Mixpanel and Amplitude, a top-level `sessionId` for webhooks and Agent Native Analytics), rather than leaking one backend's reserved key into every other backend. The browser `track()` helper sends the session header too, so a client event and the server events from the same visit no longer land in different sessions.

Let an app pin that id with `setAnalyticsSessionId()` (and drop it with `clearAnalyticsSessionId()`) from `@agent-native/core/client/analytics`. A pinned id opts out of the 30-minute idle rotation, so a workflow that spans a quiet stretch stays one correlated session instead of silently splitting in two. Ids the transport cannot carry — empty, over 127 characters, whitespace, or non-ASCII — throw at the call site rather than unlinking every later request.
