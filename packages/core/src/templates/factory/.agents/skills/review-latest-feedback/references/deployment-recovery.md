# Deployment, release, and publish recovery

Use this guide for each `review-latest-feedback` sweep, even when no report
links a failed run.

## Scan and classify

- Inspect recent deploy, release, desktop build/sign/notarize/update, and
  package-publish runs since the previous deployment cursor; on the first run,
  use the last 7 days. Cover app/template beta, docs, and production lanes where
  configured. Use the current workflow/target maps and provider or registry
  state.
- Check deployed app revisions, desktop release assets, and package versions
  for missing or stale artifacts, including when a workflow reports success.
- For each failure or target mismatch, inspect authoritative logs. Record the
  run URL, workflow, failed job/step, target/platform/package/version, source
  SHA, and error in the ledger.
- Separate repo-owned source/workflow/config defects from provider errors,
  skipped or manual gates, cancellations, and superseded runs. Fix confirmed
  repo-owned causes at their owning boundary. Record an external owner and exact
  next action when the cause is outside the repo.

## Recover and verify

Use the lane's normal workflow and the invocation's applicable publish/deploy
authority. Recover only affected lanes. Read `ship` for PR/push/merge work and
`ship-and-monitor` for beta, docs, release-tail, or manual-production proof.
If a required release action is not authorized, keep its operational row active
with the exact next action.

Verify the intended source and delivery artifact at the target:

- **Apps:** confirm the target has the intended revision and smoke-test the
  affected URL or health path, including cache behavior when relevant.
- **Desktop:** confirm the expected version and platform assets exist, then
  exercise the affected install or update path through launch.
- **Packages:** confirm the exact version is in the registry and install or
  scaffold it from a clean cache. For npx, record pinned/filed versions, remove
  local overrides, verify the candidate and published release, and check the
  existing-app upgrade path (for example, `pnpm add
  @agent-native/core@<version>` or the documented hand edit).

A green workflow, merged source, beta promise, or local scaffold alone does not
prove delivery. Keep the operational row active until the intended artifact is
present and its target check passes; a linked source issue can be **Fixed**
while the operational row remains open. Run-only failures get a ledger row, not
a fabricated Slack reaction. Local proof is not **Shipped**/**Live verified**
until the relevant artifact is published and its delivery/runtime bar passes.
Link the merge, release, verification, and any bump/re-scaffold follow-up.
