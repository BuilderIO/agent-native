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

Search open PRs and existing issues for every run ID, workflow, or fingerprint
to find an active owner. An existing issue covers only the exact failure-level
evidence it names: a run-ID-only match owns only that occurrence, and a workflow
name alone does not cover every failure in it. Record the matching PR, issue,
or Codex task as owner and keep every unmatched occurrence actionable. Do not
create or update GitHub issues to track CI fingerprints. The current sweep's
recap table is its CI ledger; carry unresolved occurrences into the ship ledger
and PR recap, linked to their workflow runs. If a dedicated workflow already
owns a reporter-managed issue, link it and leave its updates and recovery
lifecycle to that workflow. If no active owner or canonical issue can be
verified, record the ownership gap and next action in the recap instead of
opening a competing ticket.

Preserve unresolved failures after they age out of the report's five-day
window. A failure is recovered only after a later passing run of the same
workflow and test/fingerprint, or a verified fix with a passing rerun; aging
out of the report is not recovery. Carry unresolved rows from the prior sweep
or ship recap into the current table. Keep each occurrence's evidence and
disposition even when several failures share one fingerprint.

Quarantine only with a named owner, expiry, and an explicitly authorized
tracking issue. A green result produced by quarantine is a defect. Follow
quarantined rows until fixed or restored. The CI table records run count,
fingerprint and occurrence counts, query status, classification, disposition,
evidence, and owner/action.

For deploy, release, and publish workflows, follow
[deployment recovery](deployment-recovery.md). Keep the operational row active
until target proof passes; a delivery gap is not a quarantine.
