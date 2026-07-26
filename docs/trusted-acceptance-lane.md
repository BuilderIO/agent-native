# Trusted acceptance lane

The trusted acceptance lane is the repository-owned path for testing an exact
same-repository pull request SHA against stable, isolated hosted apps. It is for
framework behavior that a local test or ordinary visual preview cannot prove,
including remote MCP OAuth, workspace discovery, A2A delegation, and hosted
async task status.

The lane is intentionally separate from ordinary Netlify deploy previews. It
does not read, copy, reconcile, or repair preview environment configuration,
and a successful lane receipt says nothing about preview OAuth or preview
credential isolation.

## Current bootstrap state

The `calendar-content` pilot in
`scripts/trusted-acceptance-workspaces.json` is checked in with `enabled: false`.
The workflow can validate an open PR, produce the generic app matrix, and build
the candidate without runtime or deployment credentials. A live deployment
fails closed even if the flag is changed: the bootstrap config deliberately has
no runtime-authority provisioner. A later reviewed change must implement the
trusted per-run credential lease and cleanup path before activation.

## Custody boundaries

The manual `.github/workflows/trusted-acceptance.yml` controller must be
dispatched from `main`. Every trusted job pins controller code to that immutable
dispatch SHA. Candidate runs verify that the selected full SHA is the current
head of an open, non-fork pull request in `BuilderIO/agent-native`.

The jobs deliberately have different custody:

1. `plan` checks out trusted default-branch controller code and validates PR
   provenance plus the declarative workspace.
2. `build` checks out the selected candidate without persistent GitHub
   credentials. Candidate dependency and build scripts run without Netlify,
   database, Better Auth, A2A, provider, OAuth, or runtime secrets, then upload
   inert build artifacts and SHA metadata.
3. `deploy` uses the protected `trusted-acceptance` GitHub Environment. It
   checks out trusted controller code, installs the pinned Netlify client,
   rejects any resolved site ID present in the production-site inventory,
   downloads and verifies inert artifacts, then uploads them from an empty
   trusted directory using explicit paths. Candidate `netlify.toml`, plugins,
   and hooks never cross into this job. Only then does the upload step receive
   the scoped Netlify token; it uses `--no-build` and never runs candidate
   scripts.
4. `receipt` records a redacted artifact. Until the real OAuth/A2A harness is
   run, behavioral assertions remain `blocked`; a deployment alone is not a
   passing acceptance result.

Runs share a non-cancelling concurrency group per workspace, so two candidate
SHAs cannot interleave across the same apps.

## Provision the first workspace

Provisioning is an infrastructure-owner operation after the controller is on
the default branch. Create new non-production resources; do not reuse or copy
production or ordinary-preview values.

Candidate server code can read every value available to its hosted runtime.
Therefore a long-lived acceptance database credential, Better Auth secret, or
A2A secret is not an isolation boundary: a candidate could retain it after the
run. Static runtime credentials configured directly on the stable acceptance
sites are forbidden.

Before this workspace can be enabled, a follow-up implementation must add a
trusted runtime-authority provisioner that:

- creates a fresh, revocable database credential over synthetic data for each
  run;
- generates fresh Better Auth and shared-workspace A2A secrets for that run;
- installs those values on the acceptance sites only after candidate build
  artifacts are inert and verified;
- revokes or rotates every leased value in an `always()` cleanup path, including
  failed and cancelled acceptance runs; and
- records only lease identifiers, issue/revocation timestamps, and cleanup
  status in the redacted receipt. A receipt cannot pass until revocation is
  confirmed.

The candidate may inspect or corrupt its disposable lease while the test is in
progress. Its authority must become useless when cleanup completes; production,
ordinary previews, other workspaces, and later acceptance runs remain outside
the blast radius.

For each app, the infrastructure owner may prepare:

- create a dedicated Netlify site and stable acceptance domain matching the
  configured origin;
- create an acceptance database service capable of issuing per-run revocable
  credentials over synthetic users and fixtures;
- set the exact acceptance origin as `APP_URL` and `BETTER_AUTH_URL`; and
- leave reusable database, Better Auth, and A2A credentials off the site.

All apps in one workspace receive the same per-run A2A secret. It must be
rotated after the run and must never be used by production, previews, another
workspace, a provider integration, or a later acceptance run.

Configure the protected GitHub Environment named `trusted-acceptance` with:

- secret `ACCEPTANCE_NETLIFY_AUTH_TOKEN`, scoped to deployment of only the
  dedicated acceptance sites; and
- non-secret site variables named by each member's `siteIdVariable`, initially
  `ACCEPTANCE_CALENDAR_NETLIFY_SITE_ID` and
  `ACCEPTANCE_CONTENT_NETLIFY_SITE_ID`.

The repository contains key names and resource references only. Never put
secret values, synthetic login credentials, tokens, or raw provider responses
in the workspace config, workflow, docs, logs, or receipt.

After a redacted inventory proves those resources are isolated and the trusted
provision/cleanup implementation has its own security review and tests, replace
the bootstrap `unconfigured` provisioner and change the workspace to
`enabled: true` in a reviewed PR. Changing only the flag still fails closed.
Keep GitHub Environment approval rules in place; enabling configuration is not
permission to bypass them.

## Run a dry plan

Open **Actions → Trusted acceptance → Run workflow** from `main` and provide:

- `workspace`: `calendar-content`;
- `pull_request`: the open same-repository PR number;
- `sha`: its full lowercase 40-character current head SHA; and
- `deploy`: false.

The run must fail before build for a fork, closed PR, stale or abbreviated SHA,
unknown workspace, or invalid configuration. A dry run emits a blocked receipt
and never enters the protected deployment environment.

For a live run after activation, set `deploy` to true. The stable apps must then
be tested with a real authorization-code plus PKCE client: inspect protected
resource metadata, connect to Calendar, require Content from `list_apps`, call a
bounded read-only `ask_app`, and poll the returned ID through `ask_app_status`.
Run production-to-acceptance, acceptance-to-production, and cross-resource
token replay negatives before marking the receipt passed.

## Roll back

Use `rollback_sha` together with the `rollback_run_id` of a prior passing,
redacted acceptance receipt. Leave the candidate `pull_request` and `sha` inputs
empty. The controller downloads and validates that same-repository receipt,
requires the prior run to be a successful `main` dispatch of this exact
workflow, and matches its controller SHA, workspace, and current known-good SHA.
It then verifies that the commit still resolves exactly in
`BuilderIO/agent-native`, rebuilds it without credentials, and redeploys it
through the same isolated path. Rollback never promotes acceptance code or data
to production.

## Add another hosted template

No workflow branch is required. Add a member or workspace entry containing:

- a unique template ID that exists under `templates/`;
- a stable, non-production HTTPS acceptance origin;
- a unique acceptance-scoped Netlify site-variable name;
- acceptance-scoped runtime key names and an implemented disposable-authority
  provisioner;
- the template's build command and relative publish directory;
- absolute health, protected-resource metadata, and MCP paths; and
- the assertion IDs that the workspace must prove.

Keep the entry disabled and its provisioner unconfigured until its dedicated
site, per-run database credential lease, per-run identity and A2A rotation,
cleanup path, DNS, and protected-environment custody have been independently
verified. Run the focused validator and workflow boundary tests before review:

```sh
pnpm tsx --test scripts/trusted-acceptance.spec.ts scripts/guard-trusted-acceptance-workflow.spec.ts
pnpm guard:trusted-acceptance
```

The generic fixture in `scripts/trusted-acceptance.spec.ts` uses the repository's
real Tasks template to demonstrate that a third template validates and produces
a plan without changing workflow code. A real secretless Tasks build remains an
activation-time proof, not something this schema test claims to establish.
