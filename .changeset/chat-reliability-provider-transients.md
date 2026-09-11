---
"@agent-native/core": patch
---

Agent chat reliability: a bare HTTP 403 from the model gateway ("403 status code (no body)" / "Forbidden" with no structured code) is now classified as a transient provider rejection that is retried with backoff and never shown as a rejected credential; a turn takes at most one rate-limit-driven continuation and then ends with a clear `provider_rate_limited` error instead of chaining identical requests for minutes; sustained 429/529/transient-403 on the primary model falls back once to a sibling model; a continuation chunk re-fetching a read-only tool whose result was trimmed from context no longer counts toward the identical-call breaker; stale-run recovery is capped at three successors per turn and preserves the successor worker's last diagnostic stage.
