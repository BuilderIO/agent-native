---
"@agent-native/core": patch
---

Correct the GPT-5.6 pricing rates, which matched no published tier.

The `sol` / `terra` / `luna` entries carried input and output rates that appear
in neither column of OpenAI's table (luna was $1.00/$6.00 per MTok against a
real $0.20/$1.20), and set `cacheWrite: 0` on the belief that OpenAI does not
bill cache writes — it does, at above the full input rate. All three now track
the published short-context rates:

|       | input | cached | cache write | output |
| ----- | ----- | ------ | ----------- | ------ |
| sol   | $4.00 | $0.40  | $5.00       | $20.00 |
| terra | $2.00 | $0.20  | $2.50       | $12.00 |
| luna  | $0.20 | $0.02  | $0.25       | $1.20  |

Short context on purpose: each model has a long-context tier at roughly 2x, and
a usage row does not preserve the request's context size, so the tier cannot be
recovered at pricing time.

Together with the cached-token double-billing fix, a real 11-call run drops from
a reported $0.8524 to $0.0358 — 24x. Pricing that run's cache writes at the
input rate instead reproduces PostHog's independently derived $0.0328 to the
cent, which is what confirms the rates.
