---
"@agent-native/core": patch
---

Cover the `/act` implement-the-latest-plan decision with a tested predicate.

`/act` implementing the latest plan instead of only switching modes landed in
`0566ce9`, but the only test mocked the chat handle, so the gate that decides
whether a plan can be implemented was never exercised. When that gate says no,
`/act` silently falls back to a bare mode switch, which is indistinguishable
from the original bug: a plan is generated for an existing deck, `/act` runs,
and nothing happens.

`canImplementLatestPlan` now owns that decision in one place for both `/act`
and the plan-mode callout, and is covered directly — including a thread that
already holds several turns of earlier deck work, which is the reported repro.
