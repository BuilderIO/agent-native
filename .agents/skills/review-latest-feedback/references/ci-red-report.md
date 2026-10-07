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
Search open PRs and tracking issues for every run id, workflow, or fingerprint.
A run-ID-only match owns only that occurrence; keep other unowned run IDs
actionable. Mark the aggregate **Owned elsewhere** only when an open item names
its workflow or fingerprint, and link it. Classify other fingerprints as
**product regression**, **stale spec**, **harness flake**, or **infrastructure**.
Reproduce locally and fix the owning boundary. Keep one tracking issue per
fingerprint and close it on fix.

Quarantine only with a named owner, expiry, and linked tracking issue. A green
result produced by quarantine is a defect. Follow quarantined rows until fixed
or restored. The recap records run count, fingerprint count, query status,
classification, disposition, evidence, and any owner/issue.

For deploy, release, and publish workflows, follow
[deployment recovery](deployment-recovery.md). Keep the operational row active
until target proof passes; a delivery gap is not a quarantine.
