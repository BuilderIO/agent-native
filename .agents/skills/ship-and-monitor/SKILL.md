---
name: ship-and-monitor
description: >-
  Run the normal guarded ship flow, then monitor beta deployments, release
  tails, and any explicitly requested manual production promotion. Use when
  standard `/ship` needs post-merge verification.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship and Monitor

Use the normal `/ship` workflow, then add the post-merge monitoring described
below. Read `.agents/skills/ship/SKILL.md` and follow every step through
`/new-branch`; `/ship` intentionally ends after merge and branch rotation.

## Deployment split

Merges to `main` trigger `.github/workflows/deploy-beta-sites-prebuilt.yml`,
which builds in GitHub Actions and uploads prebuilt artifacts to the independent
Netlify beta sites at `beta.*.agent-native.com`. Netlify Git-connected
auto-builds are disabled, so do not wait for Netlify build queues or
deploy-preview checks; verify the Actions run and its per-site smoke checks.
Production promotion is manual. A healthy beta deploy is not proof that
production changed, and a production deploy is not expected unless an explicit
manual promotion was started for the task.

Use `.github/workflows/deploy-production-sites-prebuilt.yml` or the targeted
`promote-netlify-deploy.yml` workflow to promote a critical fix and let it
manage Netlify lock transitions. Do not manually remove or clear a Netlify lock
as a deployment step; clearing one is not the production promotion.

## Post-merge monitoring

After `/new-branch`:

1. Confirm the merged PR and merge commit are present in `origin/main`.
2. Check every workflow attached to that commit, the beta deployment status,
   and package publication when applicable. Wait for publication and use an
   independent beta URL smoke check when the affected surface is observable.
3. If the task explicitly included manual production promotion, verify that
   promotion and the affected production URL separately. Otherwise report
   production as intentionally not promoted, not as blocked by Netlify.
4. Re-read the merged PR for new review or bot feedback. If actionable
   post-merge feedback or a release/deploy failure appears, fix it on the fresh
   branch, run the smallest meaningful check, and invoke `/ship` for the
   follow-up.

Keep configured, source-tested, built-runtime, beta-deployed, production-
promoted, and observed-live claims separate. A merge or green test is not live
proof.

## Related skills

- `/ship` for the normal guarded flow without post-merge monitoring.
- `/ship-now` for the fast admin-merge path, which already includes monitoring.
- `/new-branch` for the required branch rotation after merge.
