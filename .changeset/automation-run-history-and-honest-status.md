---
"@agent-native/core": minor
---

Fix the Automations page reporting runs that never happened, and add run history and schedule editing.

A scheduler or dispatcher tick that declined to run an automation used to stamp
`lastRun` with the current time, so a permanently blocked automation reported a
fresh run every minute while its `nextRun` stayed frozen in the past. Skipped
ticks now record `lastCheck` instead, leave `lastRun` alone, and only rewrite the
resource when the failure state actually changes. The failure reason
(`lastError`) is surfaced on the row and in the details view instead of being
swallowed behind a bare `skipped` chip.

Also adds:

- `automation_runs` history for real executions, exposed through a new
  `list-automation-runs` action and a Past runs section in the details view.
- A Details view that shows more than the list row: schedule, next/last run,
  last checked, last status, scope, creator and model.
- An Edit affordance for changing a scheduled automation's cron expression.
- A "Manage agent" entry in the sidebar organization switcher.
