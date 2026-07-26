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

## Current disabled state

The `calendar-content` pilot in
`scripts/trusted-acceptance-workspaces.json` is checked in with `enabled: false`.
The workflow can validate an open PR, produce the generic app matrix, and build
the candidate without runtime or deployment credentials. The repository also
contains the provider-neutral `trusted-lease-v1` controller contract, bounded
provider adapters, acceptance-only directory fixture, hosted OAuth/A2A harness,
and independent reaper entrypoint. None of those declarations activates the
pilot. A live deployment fails closed because the checked-in workspace has an
`unconfigured` provisioner as well as `enabled: false`.

Activation is a separate reviewed change. It must name an allowlisted protected
authority profile, prove the dedicated resources exist, and change the flag.
Changing only the flag still fails closed.

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
3. The privileged controller uses the protected `trusted-acceptance` GitHub
   Environment. It
   checks out trusted controller code, installs dependencies and the pinned
   Netlify client before credentials enter,
   rejects any resolved site ID present in the production-site inventory,
   downloads and verifies inert artifacts, then uploads them from an empty
   trusted directory using explicit paths. Candidate `netlify.toml`, plugins,
   and hooks never cross into this job. Only then do the fixed trusted
   acquire/upload/revoke steps receive scoped provider credentials. The upload
   uses `--no-build`, and no candidate or dependency script runs after that
   boundary.
4. `receipt` records a redacted artifact. Until the real OAuth/A2A harness is
   run, behavioral assertions remain `blocked`; a deployment alone is not a
   passing acceptance result.

Runs share a non-cancelling concurrency group per workspace, so two candidate
SHAs cannot interleave across the same apps.

The controller credentials enter only the trusted default-branch job, after
candidate artifacts have been downloaded and their embedded SHA metadata has
been verified. No candidate checkout, package lifecycle command, build hook, or
candidate configuration runs after that boundary.

## Disposable authority contract

`scripts/trusted-acceptance/runtime-authority.ts` separates two kinds of state:

- transient runtime material, which contains the database URL, freshly
  generated Better Auth and A2A values, and an optional bounded inference key;
  and
- a durable redacted lease record containing only deterministic lease identity,
  opaque provider handles, timestamps, state transitions, and cleanup results.

The provider contract is generic, while the first protected profile uses:

- one expiring Neon child branch in each member's unique dedicated synthetic
  seed project (two workspace members may not share a project ID);
- Netlify environment values managed through the current account environment
  API, scoped only to functions/runtime on isolated acceptance sites;
- one expiring OpenRouter child key for each member that declares inference,
  with a small USD cap and no automatic limit reset; and
- a trusted tombstone artifact deployed after runtime values are removed.

The OpenRouter management key, Neon API key, and Netlify control token remain in
the protected controller environment. Candidate code sees only the disposable
runtime values for its current lease. Provider endpoints and project/site IDs
come from the trusted profile, not workflow inputs or candidate files.

Before creating any branch or runtime value, the controller queries each
declared Netlify site, requires its exact site ID to serve the profile's exact
acceptance origin, and requires every managed runtime key to be absent. It never
overwrites or later deletes a pre-existing value. A reused or misbound site is a
hard preflight failure instead of collateral damage.

Acquisition journals before and after every provider mutation. Revocation is
idempotent and is incomplete until the inference key is absent, database
branches are absent, runtime configuration is absent, and each isolated site is
serving its verified trusted tombstone deploy. A passing receipt must include
those cleanup states and opaque tombstone deploy IDs.

The normal workflow invokes revocation from an `always()` cleanup path. The
separate `trusted-acceptance-reaper.yml` workflow is main-pinned and can also be
run on a schedule or manually. It builds a generic matrix from configured
workspaces and shares each workspace's non-cancelling concurrency group. It
discovers expired deterministic lease names from Neon branches, bounded
OpenRouter keys, and one atomic non-secret Netlify lease marker, then calls the
same idempotent cleanup path. Marker values are identifiers and expiries only;
runtime credentials remain secret and unreadable. Recovery deletes site runtime
keys or deploys a tombstone only when that site's marker still names the lease;
a markerless branch/key recovery cleans only its matching provider handles.
The marker is re-read immediately before cleanup, so an ownership race fails
closed without deleting another actor's site state.
This is required because
force-cancelling a workflow can interrupt even an `always()` job.

## Acceptance-only app directory

Separately hosted templates do not form a local filesystem workspace. Hosted
`list_apps` therefore uses the organization-directory HTTP contract. The
acceptance lane supplies a small trusted fixture implementing only that public
contract; it does not reuse production Dispatch data or authority.

The fixture validates the disposable A2A bearer and returns only the members
declared by the trusted workspace profile. Its mode is controller-owned and has
two allowlisted states: stable membership and withdrawal of one declared
member. There is no candidate-callable control endpoint and no request field
that selects arbitrary apps or URLs.

The hosted harness first proves stable discovery, calls `ask_app`, records the
returned task ID only in redacted form, asks the trusted controller to withdraw
the target member, and polls `ask_app_status` for that same task. This makes
directory loss a discriminating test of preserved task routing instead of a
simulation that skips discovery.

## Provision the first workspace

Provisioning is an infrastructure-owner operation after the controller is on
the default branch. Create new non-production resources; do not reuse or copy
production or ordinary-preview values.

Candidate server code can read every value available to its hosted runtime.
Therefore a long-lived acceptance database credential, Better Auth secret, or
A2A secret is not an isolation boundary: a candidate could retain it after the
run. Static runtime credentials configured directly on the stable acceptance
sites are forbidden.

Before this workspace can be enabled, the implemented trusted runtime-authority
provisioner must be connected to dedicated resources and prove that it:

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

Content also needs a real inference call to complete the delegated task. The
controller mints a child key with an exact expiry and tiny spend cap, installs
it together with `AGENT_ENGINE=ai-sdk:openrouter` only for the leased runtime,
and deletes or disables it before cleanup can pass. A reusable model-provider
key is forbidden.

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
  dedicated acceptance sites;
- secrets `ACCEPTANCE_NEON_API_KEY` and `ACCEPTANCE_OPENROUTER_API_KEY`, each
  scoped to the dedicated synthetic projects or bounded child-key authority;
  and
- non-secret `ACCEPTANCE_AUTHORITY_PROFILES_JSON`, an object keyed by workspace
  ID. Each profile allowlists exact member origins, Neon project/database/role
  IDs, Netlify account/site IDs, the tiny inference cap, and the verified
  tombstone artifact. It contains no provider token or runtime credential.

The repository contains key names and resource references only. Never put
secret values, synthetic login credentials, tokens, or raw provider responses
in the workspace config, workflow, docs, logs, or receipt.

After a redacted inventory proves those resources are isolated and the trusted
provision/cleanup implementation has its own security review and tests, replace
the `{ "kind": "unconfigured" }` provisioner with a `trusted-lease-v1`
descriptor, add its exact entry to the protected profile map, then change the
workspace to `enabled: true` in a separate reviewed PR. The descriptor's
`profileMapVariable` must be exactly `ACCEPTANCE_AUTHORITY_PROFILES_JSON`;
changing only the flag still fails closed.
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
After `ask_app`, the trusted directory fixture withdraws the target member;
`ask_app_status` must still complete that exact task through its preserved
route. Run production-to-acceptance, acceptance-to-production, and
cross-resource token replay negatives before marking the receipt passed.

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
- exact acceptance-scoped Netlify account and site IDs in the protected
  non-secret profile map;
- acceptance-scoped runtime key names, optional inference declaration, and an
  implemented disposable-authority provisioner;
- the template's build command and relative publish directory;
- absolute health, protected-resource metadata, and MCP paths; and
- the assertion IDs that the workspace must prove.

Keep the entry disabled and its provisioner unconfigured until its dedicated
site, per-run database credential lease, per-run identity and A2A rotation,
cleanup path, DNS, and protected-environment custody have been independently
verified. Run the focused validator and workflow boundary tests before review:

```sh
pnpm tsx --test scripts/trusted-acceptance.spec.ts scripts/guard-trusted-acceptance-workflow.spec.ts
pnpm tsx --test scripts/trusted-acceptance/*.spec.ts
pnpm guard:trusted-acceptance
```

The generic fixture in `scripts/trusted-acceptance.spec.ts` uses the repository's
real Tasks template to demonstrate that a third template validates and produces
a plan without changing workflow code. A real secretless Tasks build remains an
activation-time proof, not something this schema test claims to establish.
