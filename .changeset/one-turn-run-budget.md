---
"@agent-native/core": minor
---

Give the continuation-chain guard and stale-run recovery one turn-run budget.

The ceiling on run rows for a logical turn was written three times: the chain
bound `MAX_BACKGROUND_RUN_CONTINUATIONS` (20), an inline
`turnRunCount > MAX_BACKGROUND_RUN_CONTINUATIONS + 5` in `production-agent.ts`,
and a hand-maintained literal `25` in `run-store.ts` whose own comment asked the
next editor to keep it in sync, because importing back would have been circular.

The cycle is gone now that the base value is configuration and `app-config`
imports no agent code, so both sites read `resolveTurnRunLedgerBudget()` with
the slack named `TURN_RUN_LEDGER_SLACK` and its reason recorded: the two bounds
count different things — handoffs a chunk decided to make versus every run row
the turn produced, including sweep redispatches and recoveries — which is why
the ledger must sit strictly above the chain bound. A spec pins the
relationship.

Both call sites compared `turnRunCount > budget` while the current run's row was
already inserted and counted, and the successor's row is inserted after the
check — so at equality they permitted one row past the documented ceiling. They
now call a `turnRunLedgerExhausted()` predicate, so the two cannot disagree
about the boundary again.

Also removes `DEFAULT_BACKGROUND_RUN_SOFT_TIMEOUT_MS`, an exported alias for
`BACKGROUND_SOFT_TIMEOUT_CEILING_MS` with no source caller; use the ceiling (or
`resolveBackgroundSoftTimeoutCeilingMs()`) directly.

No behaviour change: every resolved value is what it was.
