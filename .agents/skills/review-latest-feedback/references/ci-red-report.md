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
Classify each E2E fingerprint separately as **product regression**, **stale
spec**, **harness flake**, or **infrastructure**, then reproduce locally and fix
the owning boundary.

Track the complete E2E failure set in one aggregate issue. One issue covers all
E2E workflows, tests, shards, fingerprints, and runs in the report; keep the
test-level evidence and disposition for every fingerprint in its body. Reuse
the same open E2E issue on later reports and update its full failure list.
Never create a separate issue per test, fingerprint, shard, or run. Search
open PRs and tracking issues for every run id, workflow, or fingerprint; a
matching aggregate E2E issue owns every listed E2E row, not only one run-ID
occurrence. If matching per-fingerprint issues already exist, link them as
evidence and do not open more issues. Close the aggregate after all listed E2E
failures recover or are fixed.

Keep non-E2E workflow incidents separately tracked. For those rows, a run-ID-
only match owns only that occurrence; keep other unowned run IDs actionable.
Mark an aggregate **Owned elsewhere** only when an open item names its workflow
or fingerprint, and link it.

Quarantine only with a named owner, expiry, and linked tracking issue. A green
result produced by quarantine is a defect. Follow quarantined rows until fixed
or restored. The recap records run count, fingerprint count, query status,
classification, disposition, evidence, and any owner/issue.

For deploy, release, and publish workflows, follow
[deployment recovery](deployment-recovery.md). Keep the operational row active
until target proof passes; a delivery gap is not a quarantine.
