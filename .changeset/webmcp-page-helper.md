---
"@agent-native/core": patch
---

Publish a `window.__agentNativeWebMcp` page helper for browser agents that wraps readiness, discovery, the host input contract, stale-descriptor retries, and pending handles for short evaluators; register WebMCP tools concurrently so a hidden browser pane no longer pays one throttled timer wake-up per tool; and re-poll the sync transport after WebMCP writes so the UI repaints without a reload.
