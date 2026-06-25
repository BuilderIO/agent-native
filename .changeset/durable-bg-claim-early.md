---
"@agent-native/core": patch
---

Durable background agent-chat: claim the run UP-FRONT, before the heavy handler
setup. The background worker previously claimed the run (flipping it to
`background-processing`) only in the worker branch — which runs after building
the system prompt, reading thread data, and loading actions. On a heavy app
whose setup exceeds the foreground's claim grace, the foreground recovered the
turn inline before the worker ever claimed, so the 15-minute background budget
was never used (observed on analytics: the worker stalled at `auth_passed` with
no crash — just slow setup). The claim now happens right after the background
marker is recognized, so the foreground sees `background-processing` within the
grace and subscribes to the worker instead of re-running inline.
Duplicate-delivery dedup and chained-continuation row inserts are preserved.
Because the claim now precedes setup, a setup failure after the claim could
otherwise leave the run stuck in `background-processing`; the `_process-run`
route now marks such a run errored (terminal) so the subscribed foreground sees
an immediate failure instead of waiting out a confusing timeout.
