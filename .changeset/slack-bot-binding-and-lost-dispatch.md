---
"@agent-native/core": patch
---

Fix the Slack bot answering as the wrong app and silently dropping mentions

Outbound Slack delivery never passed an app id, so token resolution fell back
to a team-only lookup that took whichever installation was updated most
recently. A workspace with two connected Slack apps posted as whichever one
reconnected last. Outbound targets can now name an installation, and an
ambiguous tenant is reported instead of resolved to an arbitrary app.

Webhook dispatch also discarded a definitive `failed` outcome and answered the
platform 200 regardless, leaving a queued task nobody was running behind an
in-progress indicator that never resolved. That failure is now surfaced to the
user, and stuck-task recovery sweeps every dispatch mode rather than only
durable scopes — portable dispatch is the mode most likely to strand a task,
since its self-dispatch dies with the container.
