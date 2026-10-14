# Chat run health

Reporters only see a slice of chat failures. A run that ends on a typed outcome
(`write_tool_outcome_unknown`, `http_429`, `automation_no_confirmed_work`) is not
a Sentry exception, so it never reaches the error-issue lanes. Sweep it directly
every run, even without linked feedback.

## Measure

From a checkout whose `templates/*/.env` files hold `DATABASE_URL` (read-only):

```bash
node scripts/chat-health.mjs --hours 72
```

It prints per-app turns, `bad%`, p50/p90 wait, and `top reasons` (the run's
`error_code`/`terminal_reason`), plus A2A task failures. Record the fleet line
and every app marked `!`. A reason is **new** when it was absent from the
previous sweep's recap; **climbing** when its count grew more than 25%.

Durable counts survive run pruning in each app's `agent_run_outcome_daily`
(`day`, `status`, `terminal_reason`, `run_count`). Events and failed rows are
pruned in about a day and a week, so reconstruct a run within 7 days.

## Reconstruct one run

Read `agent_runs` (`status`, `error_code`, `error_detail`, `terminal_reason`,
`dispatch_mode`, `continuation_order`, `auto_continue_of`, `thread_id`) and
`agent_run_events` (`seq`, `event_data` JSON with `type`). Same-thread runs
within 10 minutes show retries and user re-sends. For a tool failure, read the
`tool_done` that carries `isError`, `outcomeUnknown`, and the result text: the
first failing result names the real cause. Use the run id from the report; never
ask the reporter for it. Do not print `DATABASE_URL`, user prompts, or emails.

## Known classes

| Reason                                                 | Usually means                                                                                                                                                                                                                  | Owner                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `write_tool_outcome_unknown`                           | A write action returned a deterministic rejection and the loop blocked every later call of that tool. Read the first `outcomeUnknown` result: if it is a validation or "not found" message, the action is missing `retrySafe`. | the action's template |
| `http_400`                                             | Our own request shape (parameter names, tool schema). Retry does not help; fix the request.                                                                                                                                    | core engine           |
| `http_429`, `provider_transient_rejection`, `http_500` | Provider or gateway throttling. Check chain length, backoff, and whether successors were spaced.                                                                                                                               | core retry policy     |
| `automation_no_confirmed_work`                         | Often a held approval or a vetoed no-op, not an absent write. Read the last tool events.                                                                                                                                       | the automation's app  |
| `credits-limit-*`                                      | Billing limit. Expected; do not fix.                                                                                                                                                                                           | none                  |
| A2A "verified as an organization, not as a user"       | Org secret equals the fleet secret. Needs an operator to rotate the org secret.                                                                                                                                                | operator              |

## Record

Per app and reason: count, window, one representative run id, owner, and the
disposition. Group one Slack report per sweep in `#qa-agent-native`; do not post
per run. A class that is repo-owned with a verified cause is a fix, not a ticket.
