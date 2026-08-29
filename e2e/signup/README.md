# Scheduled signup E2E

This lane exercises the real email magic-link flow on the selected apps. It
follows the link delivered by Mailosaur, proves the
authenticated Better Auth session before a refresh, then proves it again after
the refresh that exposed the reported outage.

The scheduled target is `all` email-capable sites on beta. That currently covers
12 of the 16 fleet apps; Google-only apps (`mail` and `calendar`) and apps
without the Better Auth email magic-link flow (`factory` and `macros`) are
intentionally excluded. Every target uses a fresh reserved address per run to
exercise new-user creation. Production is opt-in through `workflow_dispatch`
and also uses a fresh reserved address. The workflow is serial so one run
creates a bounded number of canary accounts instead of multiplying them across
a matrix.

## GitHub Actions setup

Add these repository secrets before enabling the scheduled workflow:

- `MAILOSAUR_API_KEY`
- `MAILOSAUR_SERVER_ID`
- `PAGERDUTY_ROUTING_KEY` (optional; the existing PagerDuty service delivers
  email, text, or push notifications according to its escalation policy)

Create one Mailosaur server for the lane. Mailosaur accepts arbitrary local
parts on the server domain, so each run uses an address like
`signup+qa-test-bot-123-beta-clips-abc123@SERVER_ID.mailosaur.net`.

The workflow runs daily at 16:15 UTC on beta and can also be started manually
with comma-separated `apps` and `environments` inputs for beta or production. A
failed run opens or updates one GitHub issue. If PagerDuty is configured, it
also triggers the existing signup canary incident and resolves it after a
successful recovery run.

## Local run

```sh
MAILOSAUR_API_KEY=... \
MAILOSAUR_SERVER_ID=... \
SIGNUP_E2E_APPS=clips \
SIGNUP_E2E_ENVIRONMENTS=beta \
pnpm e2e:signup
```

The reserved `+qa-test-bot-` address marker is suppressed by the shared
tracking registry, including `track()` and `identify()` calls. The marker is
stable enough to filter canary accounts from signup data by local-part pattern,
while the full address remains unique for every run.
`SIGNUP_E2E_APPS=all` intentionally excludes Google-only apps and Macros,
which do not expose the Better Auth email magic-link flow.

The existing `Beta E2E (scheduled)` workflow already runs the Luna agentic chat
journey. This lane stays deterministic and focuses on the email, redirect,
session, and refresh boundaries that a model-driven journey cannot reliably
assert.
