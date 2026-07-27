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
Its reviewed source contract selects the generic `trusted-lease-v1`
provisioner, fixed Calendar-to-Content withdrawal harness, and an exact
acceptance-only directory origin. The workflow can validate an open PR, produce
the generic app matrix, and build the candidate without runtime or deployment
credentials. The repository also contains the bounded provider adapters,
hosted OAuth/A2A runner, Playwright adapter, and independent reaper entrypoint.
None of those declarations activates the pilot. A live deployment fails closed
while `enabled` remains false, and activation still requires an exact protected
authority profile backed by resources that do not yet exist as part of this
source change.

The `tasks-hosted-oauth-proof` workspace is also disabled and intentionally
unconfigured. It declares the same generic hosted OAuth path plus one harmless
read-only Tasks tool. That is the source-blind third-template acceptance story;
it does not claim that a Tasks site or authority profile has already been
provisioned. I8 belongs to that separate Tasks receipt rather than being marked
passed inside a Calendar/Content run that did not execute Tasks.

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
   checks out trusted controller code, installs dependencies, Playwright
   Chromium, and the pinned Netlify client before credentials enter,
   rejects any resolved site ID present in the production-site inventory,
   downloads and verifies inert artifacts, then uploads them from an empty
   trusted directory using explicit paths. Candidate `netlify.toml`, plugins,
   and hooks never cross into this job, and recursive inspection rejects
   symlinks and non-regular artifact entries. Only then do the fixed trusted
   acquire/upload/revoke steps receive scoped provider credentials. The upload
   uses `--no-build`, and no candidate or dependency script runs after that
   boundary.
4. The trusted hosted runner creates the disposable lease, deploys only the
   verified artifacts, signs into each app with a lease-bound synthetic QA
   identity, and performs real authorization-code plus S256 PKCE. It then runs
   the workspace's declared harness and negative isolation probes. The runner
   keeps passwords, authorization codes, verifiers, client secrets, access
   tokens, and provider credentials in process memory only.
5. `receipt` records status, origins, public OAuth metadata, timestamps, and
   SHA-256 proof digests only. Any missing live probe remains `blocked`; a
   deployment alone is not a passing acceptance result.

Runs share a non-cancelling concurrency group per workspace, so two candidate
SHAs cannot interleave across the same apps.

The controller credentials enter only the trusted default-branch job, after
candidate artifacts have been downloaded and their embedded SHA metadata has
been verified. No candidate checkout, package lifecycle command, build hook, or
candidate configuration runs after that boundary.

## Disposable authority contract

`scripts/trusted-acceptance/runtime-authority.ts` separates two kinds of state:

- transient runtime material, which contains the database URL, freshly
  generated Better Auth and A2A values, the hosted-QA verification flag, a
  five-minute acceptance access-token lifetime, and an optional bounded
  inference key; and
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

Every leased Netlify value is scoped to the production deploy context of its
dedicated acceptance site. Branch, preview, and development contexts never
receive the disposable database, authentication, A2A, or inference values.

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

The fixture is a separate, database-free Netlify runtime. It validates the
disposable A2A bearer and returns only the members declared by the trusted
workspace profile. Its mode is controller-owned and has two allowlisted states:
stable membership and withdrawal of one declared member. There is no
candidate-callable control endpoint and no request field that selects arbitrary
apps or URLs. Changing that allowlisted state is not sufficient by itself: the
controller redeploys the same digest-pinned trusted fixture artifact so the
running function observes the new state before status polling continues.
Each leased member receives the fixture's exact origin through
`AGENT_NATIVE_ORG_DIRECTORY_URL`. A freshly registered QA account may not have
an organization row yet, so the fixture accepts its signed email domain as the
organization scope only when the JWT omits `org_domain` and that domain exactly
matches the protected fixture profile.

The hosted harness first proves stable discovery, calls `ask_app`, records the
returned task ID only in redacted form, asks the trusted controller to withdraw
the target member, and redeploys both the trusted fixture and the caller from
their already verified artifacts. Redeploying the caller clears its bounded
directory cache; `list_apps` must then prove the target is absent before the
harness polls `ask_app_status` for that same task. The configured poll budget is
preserved exactly, with a bounded delay between attempts, and the completed
result must contain a controller-rendered, lease-unique marker carried in the
task prompt. The marker is not stored in an app database and its digest, not its
value, enters evidence. This makes directory loss a discriminating test of
preserved task routing without adding an undeclared seed-data dependency.

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

## Hosted QA identity and OAuth

The hosted-QA identity uses the framework's normal email/password session path,
not `AUTH_DISABLED`, direct session seeding, a provider account, or a production
identity. The controller creates a synthetic `+qa` email and a random 256-bit
password for one lease, registers it at the exact acceptance origin, verifies a
wrong password fails in an isolated browser context, and closes the credential
over an in-memory callback. `AUTH_SKIP_EMAIL_VERIFICATION=1` is installed only
after exact lease-marker ownership is proven and is removed by normal cleanup
and the independent reaper.

After sign-in, the browser approves the app's real MCP OAuth authorization
surface. The runner uses dynamic client registration, an exact loopback
callback, exact state matching, and RFC 7636 S256 PKCE before exchanging the
code for a five-minute access token. The browser and protocol adapters reject
cross-origin authorization, consent, registration, and token endpoints.

The runner also creates a second synthetic user in a separate browser context.
The first user writes a lease-bound display-name marker through the shared
`update-user-profile` action; the second reads through `get-user-profile` and
must not receive that marker, while the first must still receive it. This is the
generic tenant-data isolation probe used by I4 and does not depend on a
template-specific schema.

The isolation story does not require a valid production token. An acceptance
token must fail at the production resource and a different acceptance resource,
and a controller-created foreign-domain sentinel must fail at the acceptance
resource. The receipt also requires public issuer/resource metadata to remain
distinct and records expiry, replay, wrong-audience, and post-cleanup failures.
If the running framework does not expose a safe way to perform one of those
probes, that assertion stays blocked rather than being inferred. Only response
status and proof digests are durable.

The controller imposes a hard hosted-harness deadline shorter than the lease,
and every HTTP phase has a bounded timeout. The loopback callback listener also
closes itself on timeout. Any stall enters the same verified revoke path; the
independent reaper remains the recovery layer for runner or host termination.

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
  IDs, Netlify account/site IDs, the tiny inference cap, the verified tombstone
  artifact, and the directory fixture's exact account, site, origin, member map,
  withdrawal target, trusted artifact path, artifact SHA-256, and the exact
  synthetic hosted-QA domain `agent-native.acceptance.invalid`. It contains no
  provider token or runtime credential.

The repository contains key names and resource references only. Never put
secret values, synthetic login credentials, tokens, or raw provider responses
in the workspace config, workflow, docs, logs, or receipt.

After a redacted inventory proves those resources are isolated and the trusted
provision/cleanup implementation has its own security review and tests, add the
workspace's exact entry to the protected profile map, then change the workspace
to `enabled: true` in a separate reviewed activation PR. The checked-in
descriptor's `profileMapVariable` must remain exactly
`ACCEPTANCE_AUTHORITY_PROFILES_JSON`; changing only the flag still fails closed.
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
After `ask_app`, the trusted directory fixture withdraws the target member and
both fixture and caller are redeployed from their same verified artifacts;
`list_apps` must no longer name the target, while `ask_app_status` must still
complete that exact task through its preserved route and return the expected
synthetic result. The declared isolation probes must all return their required
fail-closed status before the receipt can pass.

## Roll back

Use `rollback_sha` together with the `rollback_run_id` of a prior passing,
redacted acceptance receipt. Leave the candidate `pull_request` and `sha` inputs
empty. The controller downloads and validates that same-repository receipt,
requires the prior run to be a successful `main` dispatch of this exact
workflow, and matches its controller SHA, workspace, and current known-good SHA.
It then verifies that the commit still resolves exactly in
`BuilderIO/agent-native`, rebuilds it without credentials, and redeploys it
through the same isolated path. A14 passes only when the rollback operation's
own hosted controller receipt passes and every workspace member records a
deployment ID; selecting a rollback operation is not evidence by itself.
Candidate receipts intentionally omit rollback-only A14, allowing a fully
passing candidate to establish the known-good SHA that a later rollback run
must cite. Rollback receipts include A14 and re-run the other configured proofs.
Rollback never promotes acceptance code or data to production.

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

The disabled `tasks-hosted-oauth-proof` workspace uses the repository's real
Tasks template to demonstrate that the same runner can select a generic
`mcp-read-only-tool` harness without a template branch or template auth change.
A real hosted Tasks run remains a later activation-time proof, not something
this source contract claims to establish.
