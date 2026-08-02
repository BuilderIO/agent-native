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

Schedules are also timezone-aware. Cron expressions used to be read in the
server's zone, so an automation created as "every day at 8am" ran at 8am UTC.
A schedule now stores the IANA zone it was written in, taken from a new
scheduling timezone preference in Account settings and falling back to the
caller's browser zone. Descriptions name their zone ("Every day at 8 AM
(America/New_York)"), and both the agent tools and the schedule editor accept a
timezone. Existing schedules keep their current host-relative meaning until
edited.

Also adds:

- `automation_runs` history for real executions, exposed through a new
  `list-automation-runs` action and a Past runs section in the details view.
- A Details view that shows more than the list row: schedule, next/last run,
  last checked, last status, scope, creator and model.
- An Edit affordance for changing a scheduled automation's cron expression and
  timezone.
- A "Manage agent" entry in the sidebar organization switcher.

Run history is bounded and honest about interrupted runs: a row left `running`
past the point a run could still be alive is reported as `interrupted` rather
than shown as permanently in-flight, and rows are pruned per automation so a
frequent schedule cannot grow the table without limit. Recording a run's
outcome also re-reads the automation first, so a schedule edited while it was
running is no longer reverted by the completion write.

Also from review: a completion write no longer recreates an automation deleted
mid-run, a run-history write failure can no longer reclassify a completed
automation as failed, deleting an automation forgets its run history so a new
one reusing the name does not inherit it, an unusable `X-User-Timezone` header
is rejected rather than persisted, and a settings read failure surfaces instead
of silently pinning a schedule to the host zone.

Run history never blocks the automation it describes: opening the record,
attaching its thread and closing it out are all non-fatal, so an unwritable
history table costs the record rather than the run.
