# CI failure triage

`pnpm ci:red-report` lists failed `push` and `schedule` workflows on `main`
whose jobs completed during the last five days. It searches up to 35 days back
for long-running workflows and ignores cancellations. Rows include the run,
workflow, failed job/step, stable fingerprint, and the count plus JSON evidence
for every matching run ID, attempt, timestamp, URL, and job/step occurrence.
`run_count` counts distinct run attempts; `occurrence_count` counts distinct
failed job/step/test occurrences across them. `runs_json` keeps those
occurrences under each run attempt's `jobSteps` array. The report groups
repeated failures by workflow and fingerprint, orders Design E2E first, then
deployment, release, and health workflows, followed by other CI/test/build
workflows. It preserves every fingerprint and includes all matching run
attempts and job occurrences in each row. If logs name Playwright
cases, the fingerprint is test-level; otherwise `job-step` is broader and
requires logs or artifacts for case-level diagnosis. An incomplete or failed
API query exits 2 and means **CI unavailable**, never an empty result.

Keep every fingerprint and failed occurrence in the CI triage table in this
sweep's recap, including its run count and links. Record the workflow, run ID and attempt,
timestamp, failed job/step, exact fingerprint, and test name or shard when
available. Classify each fingerprint as **product regression**, **stale spec**,
**harness flake**, or **infrastructure**, then reproduce locally and fix the
owning boundary.

Scheduled CI, production-health, and signup reporters publish grouped findings
to `#qa-agent-native`, with a run link and an artifact containing the complete
report. Read the full artifact; the channel message is the discovery index, not
a replacement for the occurrence ledger. Search the channel and open PRs/tasks
for each run ID, workflow, or fingerprint to find an active owner. A matching
PR, task, or QA rollup covers only the exact failure-level evidence it names:
a run-ID-only match owns only that occurrence, and a workflow name alone does
not cover every failure in it. Record the matching PR, task, or Slack permalink
and keep every unmatched occurrence actionable. Do not create or update GitHub
issues for CI fingerprints. Legacy automated issue reports are not the
reporting or recovery state; carry their evidence to the QA rollup and use the
workflow's run artifacts for deduplication and recovery. If no active owner or
canonical report can be verified, record the ownership gap and next action
instead of opening a competing ticket.

The durable cross-sweep ledger is the **CI failure ledger** section in the most
recent `review-latest-feedback` Codex task transcript. At the start of a sweep,
use `list_threads` to locate the latest prior feedback task; if it is archived,
search `list_archived_threads` pages. Read the task with `read_thread` and copy
its unresolved occurrences, exact fingerprints, evidence links, and dispositions
before running the new report. Inspect the transcript itself; titles and
summaries are not the ledger. At the end of the sweep, include the complete
current ledger in the task recap. A ship recap and PR body carry a snapshot, but
do not replace this cross-sweep source.

If there is no prior feedback task with a CI ledger, initialize from the current
report. If task history cannot be listed or read, the transcript is truncated,
or the prior ledger cannot be confirmed complete, record **prior CI ledger
unavailable** and keep the missing carry-over state unresolved. Never turn an
unreadable prior ledger into an empty table or claim those failures recovered.

Preserve unresolved failures after they age out of the report's five-day
window. A failure is recovered only after a later passing run of the same
workflow and test/fingerprint, or a verified fix with a passing rerun; aging
out of the report is not recovery. Carry unresolved rows from the prior task
transcript into the current ledger and keep each occurrence's evidence and
disposition even when several failures share one fingerprint.

Quarantine only with a named owner and expiry, and use an existing authorized
tracking record rather than creating an automated findings issue. A green
result produced by quarantine is a defect. Follow
quarantined rows until fixed or restored. The CI failure ledger records run count,
fingerprint and occurrence counts, query status, classification, disposition,
evidence, and owner/action.

For deploy, release, and publish workflows, follow
[deployment recovery](deployment-recovery.md). Keep the operational row active
until target proof passes; a delivery gap is not a quarantine.
