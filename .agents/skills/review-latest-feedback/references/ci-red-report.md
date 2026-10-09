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

Keep every fingerprint in the recap, including its run count and run links.
Classify each fingerprint as **product regression**, **stale spec**, **harness
flake**, or **infrastructure**, then reproduce locally and fix the owning
boundary.

Search open PRs and tracking issues for every run id, workflow, or fingerprint.
For non-E2E rows, keep one tracking issue per fingerprint and reuse it across
runs. A run-ID-only match owns only that occurrence; keep other unowned run IDs
actionable. Mark an item **Owned elsewhere** only when an open issue body names
its exact fingerprint or its run URL/id together with the workflow; a workflow
name alone does not cover every failure in it. Link the matching issue. Close
an issue only when issue closure is explicitly authorized.

For E2E rows, first identify issue ownership. A workflow with a reporter-managed
suite issue owns that issue's updates and recovery lifecycle. Verify and link
its canonical issue as the owner; do not create a separate manual issue for
those failures or fold another workflow's failures into it. If no canonical
issue can be verified, report the ownership gap instead of creating a competing
tracker. For workflows without a
reporter-managed issue, keep one reusable manual aggregate per workflow/suite
across its tests, shards, fingerprints, and runs. Keep test-level evidence and
disposition for every fingerprint in the aggregate. Never create an issue per
test, fingerprint, shard, or run.

Reuse the same open manual aggregate on later reports, add every new or
unmatched run and fingerprint, and preserve unresolved failures after they age
out of the report's five-day window. A grouped row is covered only when the
issue body lists every matching workflow, run ID/attempt, and failure-level
evidence: the exact fingerprint and, when available, the test name, shard, and
failed job/step. A run URL or ID with the workflow but without a failure-level
identifier does not cover a failure; an exact occurrence match leaves every
other occurrence in the grouped row actionable. A matching title alone is not
enough. Add each unmatched fingerprint and occurrence before marking it owned.
When only per-fingerprint issues are open for a manually tracked suite, reuse
one as the aggregate and link the others; do not create another issue or close
duplicates unless closure is explicitly authorized. For manual aggregates,
mark a listed failure recovered only after a later passing run of the same
workflow and test/fingerprint or a verified fix with a passing rerun; aging
out of the report is not recovery. Mark the aggregate recovered only after
every listed failure meets that evidence bar. Leave reporter-managed issue
recovery and closure to its workflow.

Quarantine only with a named owner, expiry, and linked tracking issue. A green
result produced by quarantine is a defect. Follow quarantined rows until fixed
or restored. The recap records run count, fingerprint count, query status,
classification, disposition, evidence, and any owner/issue.

For deploy, release, and publish workflows, follow
[deployment recovery](deployment-recovery.md). Keep the operational row active
until target proof passes; a delivery gap is not a quarantine.
