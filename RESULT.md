# Private turn auto-continue fix

Root cause (confirmed by test): `run-manager.ts` set `shouldAutoContinueAfterUnfinishedTurn` from `endsAfterToolResultWithoutAssistantFinal` without checking `privateTurn`. A private turn ending on a completed tool with only empty text was persisted `truncated` with `auto_continue`. The continuation always fails because `tool-call-journal-seed.ts` refuses to resume private tool history (`private_history_unrecoverable`), and the run-manager then overwrote the error code with `private_content_omitted`.

Fix: private turns are never auto-continued (they complete and the client shows its "stopped after these actions" state), and a private run keeps an allowlisted framework error code instead of the blanket `private_content_omitted`.

Tests: three new/updated cases in `run-manager.spec.ts` failed before the fix and pass after. `pnpm --filter @agent-native/core typecheck` passes.

PR: see PR description / CI state below.
