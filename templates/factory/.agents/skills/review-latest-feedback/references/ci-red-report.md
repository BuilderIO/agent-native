# CI failure triage

`pnpm ci:red-report` lists failed `push` and `schedule` workflows on `main`
whose jobs completed during the last five days. It searches up to 35 days back
for long-running workflows and ignores cancellations. Rows include the run,
workflow, failed job/step, and stable fingerprint. If logs name Playwright
cases, the fingerprint is test-level; otherwise `job-step` is broader and
requires logs or artifacts for case-level diagnosis. An incomplete or failed
API query exits 2 and means **CI unavailable**, never an empty result.

Keep every row in the recap. Search open PRs and tracking issues for its run id,
workflow, or fingerprint. Mark **Owned elsewhere** only when an open item names
one of those identifiers, and link it. Classify other rows as **product
regression**, **stale spec**, **harness flake**, or **infrastructure**. Reproduce
locally and fix the owning boundary. Keep one tracking issue per fingerprint
and close it on fix.

Quarantine only with a named owner, expiry, and linked tracking issue. A green
result produced by quarantine is a defect. Follow quarantined rows until fixed
or restored. The recap records run count, fingerprint count, query status,
classification, disposition, evidence, and any owner/issue.
