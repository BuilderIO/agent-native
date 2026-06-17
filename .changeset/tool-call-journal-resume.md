---
"@agent-native/core": patch
---

Add a per-turn tool-call journal that hardens the run-resume path against
duplicate side effects. When a run resumes after an interruption (gateway or
transport drop, cold start, or soft-timeout auto-continue), the journal is
derived from the existing run-event ledger and injected into the resume nudge:
tool calls that already completed are listed with their results and flagged as
"do NOT re-run", and any tool call that started but never recorded a result is
surfaced as "interrupted / unknown outcome" so the model can decide rather than
blindly re-executing (e.g. re-sending an email or re-creating a ticket). The
journal is read-only over the ledger (no new recording hook), best-effort, and a
no-op for turns with no completed or interrupted tool calls, so normal resumes
are unchanged.
