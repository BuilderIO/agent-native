---
"@agent-native/core": patch
---

Treat a reasonless Anthropic 403 as provider load-shedding instead of a rejected
credential. The Anthropic engine tagged every HTTP status `http_<status>`, so an
empty-body `403 status code (no body)` ended the turn on its first occurrence,
discarded the partial answer, and told the reader to reconnect a provider key
that was working. The Builder gateway engine and the AI SDK lane already
classified that exact wording as transient; the Anthropic engine now shares the
same predicate, so the run retries with backoff and a turn that stays refused
reports a retryable sentence rather than a bare HTTP status echo. A 403 that
carries a real reason still keeps `http_403` and the credential lane.
