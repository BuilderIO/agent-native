---
name: ship-and-monitor
description: >-
  Run the normal guarded ship flow, then do requested post-merge checks. Add
  independent beta behavior checks only when requested or a concrete
  deployment-specific risk makes local proof insufficient. Use when standard
  `/ship` needs post-merge beta/live, docs, release, or production verification.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship and Monitor

Use the normal `/ship` workflow, then add the post-merge monitoring described
below. Read `.agents/skills/ship/SKILL.md` and follow every step through
`/new-branch`; `/ship` intentionally ends after merge and branch rotation. A
merge-triggered beta publish alone is not a reason for an independent beta
browser, URL, or E2E check.

## Deployment split

Merges to `main` trigger `.github/workflows/deploy-beta-sites-prebuilt.yml`,
which builds in GitHub Actions and uploads prebuilt artifacts to the independent
Netlify beta sites at `beta.*.agent-native.com`. Netlify Git-connected
auto-builds are disabled, so do not wait for Netlify build queues or
deploy-preview checks; verify the Actions run and its built-in per-site smoke
checks when beta deployment is in scope. Those checks do not require an extra
independent app smoke for routine source changes.
Never cancel, re-dispatch, or pin duplicate beta publisher runs; automatic/handoff runs coalesce pending runs, manual runs use run-specific groups, and publishes serialize.
When beta verification is requested or warranted by the gate below, use the
first successful publish whose source contains your merge. Do not wait for beta
solely because the merge triggered a publish.
Production promotion is manual. A healthy beta deploy is not proof that
production changed, and a production deploy is not expected unless an explicit
manual promotion was started for the task. The public docs site is the
temporary exception: matching `main` changes trigger
`.github/workflows/deploy-docs-production.yml`, which publishes
`www.agent-native.com` directly and then disables its Git-connected Netlify
builds. There is no beta docs site today.

Use `.github/workflows/deploy-production-sites-prebuilt.yml` or the targeted
`promote-netlify-deploy.yml` workflow to promote a critical fix and let it
manage Netlify lock transitions. Do not manually remove or clear a Netlify lock
as a deployment step; clearing one is not the production promotion.

## Host-dependent auth gate

When changed auth behavior depends on beta host/cookie settings, provider
callback registration, deployed auth configuration, or serverless session
behavior, local proof cannot cover that boundary. After the affected beta sites
deploy, dispatch both lanes below from `main`, using the exact affected app
ids. Auth screen copy, layout, and other changes that do not touch those
boundaries do not need beta E2E by default:

```bash
gh workflow run beta-e2e.yml --ref main \
  -f lane=signup \
  -f signup_apps=<email-signup-affected-apps> \
  -f signup_environments=beta
gh workflow run beta-e2e.yml --ref main \
  -f lane=public+authed \
  -f apps=<affected-beta-apps>
```

The signup lane's `signup_apps` input is independent of the browser lane's
`apps` input. Wait for the signup job's classified output to be exactly
`success` and for the affected browser lane to pass. Complete each touched
Google callback in a real browser session as well; the seeded authenticated
lane deliberately excludes Google-only Mail and Calendar. A failure,
cancellation, inconclusive Mailosaur result, missing beta deploy, or untested
provider path stays Open - do not report the auth fix as done.

## Post-merge monitoring

After `/new-branch`:

1. Confirm the merged PR and merge commit are present in `origin/main`.
2. Check applicable workflows and package publication. Wait for the affected
   beta deploy and exercise its exact path only when beta proof was requested
   or a concrete beta-specific risk applies (including the auth gate above).
   Otherwise do not wait solely for beta or add independent beta browser, URL,
   or E2E checks; local proof and required CI cover ordinary source changes.
3. If the task changed docs, verify the docs production workflow and
   `www.agent-native.com` separately. If the task explicitly included manual
   promotion of another production site, verify that promotion and its URL
   separately. Otherwise report those other production sites as intentionally
   not promoted, not as blocked by Netlify.
4. Re-read the merged PR for new review or bot feedback. If actionable
   post-merge feedback or a release/deploy failure appears, fix it on the fresh
   branch, run the smallest meaningful check, and invoke `/ship` for the
   follow-up.

When deployed proof is in scope, keep configured, source-tested, built-runtime,
beta-deployed, production-promoted, and observed-live claims separate. A merge
or green test alone is not live proof.

## Related skills

- `/ship` for the normal guarded flow without post-merge monitoring.
- `/ship-now` for the fast admin-merge path, which already includes monitoring.
- `/new-branch` for the required branch rotation after merge.
