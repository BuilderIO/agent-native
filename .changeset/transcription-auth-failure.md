---
"@agent-native/core": patch
---

Record a rejected Builder credential on the transcription path so it is not
retried forever. The chat engine already marks a 401/403 and stops reusing that
credential for the auth-failure TTL; transcription threw the raw upstream text
and marked nothing, so one unusable credential re-sent the same doomed request
on every attempt — 24 identical "Missing Authentication header" 401s in a day.
