---
"@agent-native/core": minor
---

Surface a user-visible "this chat looks stuck" affordance when an agent run goes silent. The server now tracks a durable `last_progress_at` timestamp on every emitted event (distinct from the process-liveness `heartbeat_at`); `/runs/active` returns it; and a new `useRunStuckDetection` hook + `RunStuckBanner` component poll it from the client. After 90s without progress — past the adapter's 75s no-progress reconnect — the banner appears with Retry / Cancel buttons. `MultiTabAssistantChat` wires this in by default, with Retry sending a continuation prompt via the existing chat handle. `trackEvent` calls fire on stuck-detected, retry, and cancel so we can finally see the long tail of stuck-chat incidents in analytics instead of relying on user reports.
