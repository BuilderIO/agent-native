---
"@agent-native/core": minor
---

Wire Observational Memory into the agent loop (compaction + long-thread context
injection). The OM migration plugin is now registered alongside the other
framework migration plugins so its table is created on startup. After a clean
turn the loop runs a best-effort, fire-and-forget compaction pass
(`maybeCompactThread`) so long threads accrue dated observations and
reflections. On subsequent turns, threads that have already crossed the
compaction threshold get their reflections+observations folded in as a leading
context block while the recent raw-message window is preserved verbatim - short
threads with no OM entries are left byte-for-byte unchanged.
