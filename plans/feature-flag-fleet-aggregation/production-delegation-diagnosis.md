# Production feature-flag delegation diagnosis

## Answer

Analytics can now discover the production app fleet, but it cannot authorize a
feature-flag operator in the target apps because the delegation protocol treats
an app-local organization ID as though it were a cross-app identity.

That assumption is false in the hosted architecture. Each app owns its user and
organization store. Production evidence from 2026-08-12 showed the same
`alice@builder.io` Builder.io admin membership under different organization IDs
in Analytics and Dispatch. The framework's cross-app identity contract already
reflects this boundary: hosted apps have separate stores, and signed federation
uses verified email and organization domain rather than trusting a foreign user,
role, or organization row ([authentication skill](../../.agents/skills/authentication/SKILL.md#cross-app-sso-dispatch-identity-hub)).

There are also two adjacent defects:

1. Analytics labels every thrown target-call failure `unreachable`, hiding
   whether the cause was token signing, DNS, timeout, or target execution.
2. Dispatch is always removed from the directory response even though it owns
   the default-off `desktop.workspace-sso` flag. Analytics therefore cannot
   manage Dispatch flags even after delegation authorization is repaired.

PR [#2602](https://github.com/BuilderIO/agent-native/pull/2602) is confirmed as
**Add reusable OAuth lifecycle custody** on
`codex/oauth-lifecycle-foundation`. Its current diff contains OAuth custody and
MCP integration work, not the feature-flag control plane. This diagnosis should
produce a separate fix and must not widen #2602.

## Causal trace

1. Analytics verifies Alice against its local `org_members` row and obtains its
   local organization ID.
2. Analytics signs a short-lived, exact-audience A2A token with that local ID as
   `org_id`, but passes no organization domain
   ([workspace-feature-flags.ts](../../templates/analytics/server/lib/workspace-feature-flags.ts#L151)).
3. The target verifies the signature, audience, scope, and nonce, then copies
   the foreign `org_id` directly into the target action context
   ([a2a-action-route.ts](../../packages/core/src/feature-flags/a2a-action-route.ts#L34),
   [a2a-claims.ts](../../packages/core/src/a2a-claims.ts#L13)).
4. `requireFeatureFlagManager` queries the target app's local `org_members`
   table using that foreign ID. No row matches, so a legitimate operator is
   returned as `forbidden`
   ([permissions.ts](../../packages/core/src/feature-flags/permissions.ts#L22)).
5. Even if list authorization were bypassed, mutation read-back would still
   fail: the target returns its local `scope.orgId`, while Analytics requires it
   to equal Analytics's local ID
   ([set-feature-flag.ts](../../packages/core/src/feature-flags/actions/set-feature-flag.ts#L81),
   [workspace-feature-flags.ts](../../templates/analytics/server/lib/workspace-feature-flags.ts#L65)).

This is a deterministic contract mismatch, not a missing role. Editing Alice's
role again cannot repair it.

## Evidence classification

### Direct evidence

- Production Analytics accepted Alice as an admin and rendered the Feature
  flags control plane.
- After `AGENT_NATIVE_ORG_DIRECTORY_URL` was added and production deploy
  `6a7c8e8d40ec076dfe36767a` published as `main@71db5aa`, Analytics discovered
  the fleet instead of reporting an unavailable directory.
- Production then classified Analytics, Brain, Chat, Clips, Content, Design,
  Forms, Plans, and Slides as `forbidden`; Assets, Calendar, Mail, and Videos
  were `unreachable`.
- An unauthenticated reachability probe returned HTTP 401—not 404—for the
  feature-flag action on Analytics, Assets, Brain, Calendar, Chat, Clips,
  Content, Design, Forms, Mail, Plans, and Slides. This proves those hosts and
  protected action paths existed at probe time, but does not prove a valid
  delegated call completes. `videos.agent-native.com` did not connect.
- The implementation transmits Analytics's local `org_id`, authorizes against
  the target's local table, and requires exact org-ID equality in mutation
  read-back, as shown in the causal trace.
- Dispatch defines `desktop.workspace-sso`
  ([feature-flags.ts](../../templates/dispatch/shared/feature-flags.ts#L6)) but
  its directory handler always supplies `selfId: "dispatch"`, and the directory
  builder removes that entry
  ([org-apps-directory.ts](../../templates/dispatch/server/plugins/org-apps-directory.ts#L165),
  [directory builder](../../templates/dispatch/server/lib/org-apps-directory.ts#L279)).

### Inferences

- The `forbidden` fleet entries are explained by the app-local ID mismatch.
  This follows directly from the observed IDs and authorization query, but a
  captured target-side query trace would make the diagnosis independently
  reproducible.
- The `unreachable` entries are a separate failure class. Their protected
  endpoints exist, so DNS or a missing route is not a sufficient explanation
  for most of them. The current catch-all erases the precise cause.
- The flag Alice expected to manage may be Dispatch's
  `desktop.workspace-sso`, because it is the only Dispatch flag currently
  declared and it is absent from Analytics. PR #2602 itself does not declare or
  consume a feature flag, so the exact relationship between enabling that flag
  and accepting #2602 remains an open workflow question, not a code fact.

## Architecture constraints

### Demonstrated caller and request

- Caller: a signed-in Analytics organization admin.
- Request: list and mutate source-declared flags across the production fleet,
  including Dispatch, through Analytics's sole management UI.

### Existing primitives and intended seams

- Exact-audience, scoped, short-lived A2A JWTs already protect flag delegation.
- `verifyA2AToken` already verifies and returns the signed `org_domain`
  ([a2a/server.ts](../../packages/core/src/a2a/server.ts#L94)).
- Dispatch's directory already resolves a verified organization domain into
  its own local organization ID before querying local data
  ([org-apps-directory plugin](../../templates/dispatch/server/plugins/org-apps-directory.ts#L116)).
- Each target's `requireFeatureFlagManager` is the correct owner of the final
  local owner/admin check. Analytics must not grant a role to another app.
- Target-local organization IDs remain correct for target-local flag storage
  and organization targeting; they are simply not portable identities.

### Ownership boundaries

- Analytics owns operator UX, fleet orchestration, and verification of the
  cross-app response contract.
- Core A2A owns signed identity claims, audience/scope verification, and the
  action-route adapter.
- Each target app owns its local organization resolution, membership/role
  authorization, flag definitions, rollout persistence, and audit record.
- Dispatch owns the organization directory and must advertise itself when the
  caller needs to manage Dispatch-owned capabilities.

### Legacy contracts to preserve

- No raw-SQL or settings-based feature-flag management.
- No trust in a foreign role or foreign database row ID.
- Exact audience, scope, expiry, nonce, and shared-secret verification remain
  mandatory.
- Unauthorized callers cannot see targeting rules or mutate flags.
- App-local evaluation and storage continue to use the receiver's local org ID.
- Unknown, malformed, or unverifiable identity fails closed.
- Existing non-flag A2A callers and directory consumers keep their current
  behavior.

## Smallest compatible delta

1. Have Analytics resolve its active organization's verified domain and include
   that domain in privileged flag-delegation tokens. Domainless production
   workspaces fail closed in this first slice.
2. Extend the verified claims result to retain the cryptographically verified
   organization domain. For feature-flag actions only, resolve that domain to
   the receiver's local organization ID before constructing the action context.
3. Keep the target's email-plus-local-org owner/admin check unchanged after
   translation. Do not accept an Analytics role claim.
4. Version the mutation acknowledgement so Analytics verifies the stable
   cross-app organization domain plus the flag key and persisted rules, while
   the target may also report its local org ID for audit/debugging. Do not
   compare unrelated app-local IDs.
5. Stop removing Dispatch inside the directory authority. Return the complete
   allowed fleet and let each directory client remove itself using its existing
   `selfId`/`selfOrigin` filter. Analytics, which intentionally asks for the
   whole fleet, will then see Dispatch.
6. Preserve per-app honest states, but attach a safe diagnostic reason for
   `unreachable` that distinguishes timeout, network failure, token-generation
   failure, and target execution failure without exposing secrets or response
   bodies.

### Deferred capabilities

- A global organization-ID migration or shared cross-app organization table.
- Trusting roles from Dispatch or Analytics.
- Domainless cross-app administration; it needs a separate canonical workspace
  identifier design rather than an email-only fallback.
- Repairing every currently `unreachable` app before the identity and directory
  defects are fixed and re-observed.
- Changing OAuth custody, adding OAuth consumers, or enabling a flag inside
  PR #2602.

## Acceptance story

A Builder.io owner/admin opens Analytics Feature flags and sees Dispatch plus
every directory-advertised app. For two app databases whose Builder.io
organization rows deliberately have different local IDs, Analytics can list a
registered target flag, use **Enable for me**, and read back the exact persisted
email rule from the target. A member and a same-email user outside the mapped
target organization remain forbidden. A token with the wrong domain, audience,
scope, signature, or nonce fails closed. Dispatch's `desktop.workspace-sso`
appears Off by default. Unreachable apps retain a truthful, non-secret failure
class instead of being confused with authorization denial.

Required evidence:

- Automated integration tests with different sender/receiver local org IDs and
  the same verified domain, covering list, mutation, read-back, member denial,
  cross-org denial, malformed claims, and contract-version rejection.
- Directory tests proving Dispatch is visible to Analytics and still stripped
  for a Dispatch caller that explicitly identifies itself.
- Regression tests proving target-local org IDs still scope rollout storage,
  evaluation, and audit records.
- Tester-owned real-interface acceptance in an isolated multi-app hosted
  preview, because this changes an authorization boundary. The tester must use
  two distinct local org IDs and exercise the actual Analytics UI and target
  action routes.
- Current production smoke after integration is observational follow-through,
  not the first proof of correctness.

## Lifecycle authority

```yaml
authoritySchemaVersion: 3
stage: work
authority-source: "Alice: $work"
authorized-scope:
  repositories: [BuilderIO/agent-native]
  product-surfaces: [Analytics feature-flag fleet control plane, Core privileged A2A flag delegation, Dispatch organization directory]
  outcome: Implement and prove the frozen repair for production cross-app feature-flag administration without changing OAuth PR 2602
allowed-mutations: [artifact-write, branch, commit, push, pull-request, deploy]
write-targets:
  artifacts: [plans/feature-flag-fleet-aggregation/production-delegation-diagnosis.md]
governing-artifact:
  path: plans/feature-flag-fleet-aggregation/production-delegation-diagnosis.md
  revision: work-r1
architecture-fingerprint:
  outcome: Make Analytics administer target-local flags using verified cross-app workspace identity rather than foreign database IDs
  shipping-surfaces:
    - id: core-flag-delegation
      repository: BuilderIO/agent-native
      product-surface: Core privileged feature-flag A2A authentication and mutation contract
      constituency: authenticated organization owners and admins
      durable-destination: agent-native main through a separate review PR
      integration-action: merge
    - id: analytics-fleet
      repository: BuilderIO/agent-native
      product-surface: Analytics Feature flags fleet UI and server orchestration
      constituency: Analytics organization owners and admins
      durable-destination: agent-native main through the same separate review PR
      integration-action: merge
    - id: dispatch-directory
      repository: BuilderIO/agent-native
      product-surface: Dispatch organization app directory
      constituency: authenticated first-party fleet clients
      durable-destination: agent-native main through the same separate review PR
      integration-action: merge
  governing-architecture: A signed stable organization domain identifies the workspace across apps; each receiver maps it to its own local org ID and remains the sole authority for local membership, role, storage, and audit.
  acceptance-story:
    id: cross-app-flag-admin-v1
    summary: A legitimate admin can list and mutate a target flag across differing local org IDs, while every invalid identity fails closed and Dispatch remains discoverable.
    required-assertions:
      - Core translates only a verified domain into receiver-local org context and preserves all JWT and local-role checks.
      - Analytics verifies a versioned cross-app acknowledgement without equating sender and receiver local org IDs.
      - Dispatch is visible to whole-fleet clients and self-filtering remains correct for ordinary callers.
      - A tester-owned hosted multi-app story passes with deliberately different local org IDs.
    acceptance-policy:
      modality: real-interface
      independence: required
      custody: tester-owned
      interface: isolated hosted Analytics plus at least Dispatch and one other target app
      rationale: This is cross-service authorization; independent acceptance must prove both legitimate access and tenant denial through the real interfaces.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: The repair changes shared authentication claims, cross-service authorization, and a multi-consumer directory contract.
  status: grounded
  demonstrated-callers: [Analytics admin listing and mutating production fleet flags]
  existing-primitives: [audience-bound scoped A2A JWT, verified org_domain, receiver-local resolveOrgByDomain, receiver-local requireFeatureFlagManager, client-side self filtering]
  ownership-boundaries: [Analytics orchestrates, Core authenticates and adapts, targets authorize and persist, Dispatch advertises]
  legacy-contracts: [fail-closed JWT checks, no foreign-role trust, target-local flag storage, no raw SQL management, non-flag A2A compatibility]
  shared-vocabulary: [organization domain is cross-app identity; organization ID is app-local scope]
  smallest-compatible-delta: Carry and verify org_domain, resolve it locally at the target, version mutation acknowledgement, include Dispatch in the complete fleet, and expose safe unreachable reasons.
  deferred-capabilities: [global org ID, domainless federation, OAuth consumer work, blanket unreachable-app repair]
  reversibility: The delta is confined to privileged flag delegation and directory response shaping; no data migration or OAuth behavior changes.
  direct-evidence: [production Analytics and Neon observations on 2026-08-12, cited repository source, current PR 2602 diff and metadata]
  inferences: [forbidden entries arise from local-ID mismatch; unreachable entries have multiple causes; Alice likely needs the Dispatch desktop workspace SSO flag]
  unresolved-owner-questions: []
delegation-ceiling: [read-only investigation, bounded technical review, tester-owned hosted acceptance]
acceptance-state:
  status: pending
  summary: Implementation and focused verification pass; independent review and tester-owned hosted acceptance are pending.
  blockers: [independent technical review, tester-owned hosted acceptance]
  last-land-packet: null
ledger-revision: feature-flag-production-delegation-work-r1
status: active
```

## Recommendation

Implement this as a separate, narrowly reviewed feature-flag infrastructure PR.
Do not mutate production roles again, do not synchronize database-local org IDs,
and do not add the fix to OAuth PR #2602. After this control-plane repair is
accepted, re-evaluate what specific production flag or acceptance step #2602
actually requires; its current diff does not itself establish that dependency.
