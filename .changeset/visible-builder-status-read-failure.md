---
"@agent-native/core": patch
---

Surface a failed Builder connection-status read instead of leaving the
first-run "Activate Builder.io free credits" CTA silently inert. `statusResolved`
only flips on a successful status response, so a 404, a 500, or the 10s abort
left the button fully styled and dead for the rest of the session with nothing
rendered and nothing logged.
