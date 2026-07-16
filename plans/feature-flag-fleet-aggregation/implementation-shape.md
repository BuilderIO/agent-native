# Analytics feature flags and product experimentation — implementation shape

## Decision

Analytics should own the centralized operator experience for feature flags and
product A/B tests. Core should continue to own the app-local flag registry,
evaluation, persistence contract, and actions. Dispatch remains the directory
that tells Analytics which apps exist; it does not become the flag database or
control plane.

Ship this in one draft PR with three independently reviewable and verifiable
layers. The code must remain mixed-version safe because one monorepo merge does
not guarantee every target app deploys simultaneously:

1. Core fleet contract layer: finish the app-local engine, remove the automatic per-app
   Settings tab, add versioned fleet responses and narrowly scoped A2A action
   auth, and refactor the editor into controlled presentation components.
2. Analytics fleet layer: discover, read, and manage every participating app's
   flags from `/agents?view=flags`.
3. Product experiments layer: add Analytics-owned product experiments, explicit
   flag exposure tracking, integrity checks, and conversion readouts.

The second slice is not an extension of Core's existing observability
experiments. Those experiments change agent runtime configuration and measure
agent cost, latency, evals, tool success, and satisfaction
([experiment config application](../../packages/core/src/observability/experiments.ts#L149),
[result computation](../../packages/core/src/observability/experiments.ts#L173)).
Product experiments govern application behavior and measure product events.
They need a distinct schema and action surface.

## Evidence from the current system

- Apps own stable flag definitions; Core intentionally starts with an empty
  registry ([registry contract](../../packages/core/src/feature-flags/registry.ts#L1)).
- Core already provides scoped list and atomic set actions. The target app
  validates that the flag exists, authorizes the operator, persists it, reads it
  back, and emits an audit target
  ([list action](../../packages/core/src/feature-flags/actions/list-feature-flags.ts#L8),
  [set action](../../packages/core/src/feature-flags/actions/set-feature-flag.ts#L33)).
- The current UI is coupled to those local actions and is injected into every
  app's Settings when local flags exist
  ([panel coupling](../../packages/core/src/client/feature-flags/FeatureFlagsPanel.tsx#L29),
  [Settings injection](../../packages/core/src/client/settings/SettingsPanel.tsx#L3149)).
- Analytics already reserves `/agents` for admin surfaces and explicitly says
  future admin additions belong there
  ([Analytics instructions](../../templates/analytics/AGENTS.md#L136)). The route
  already gates admin-only views with `useOrgRole`
  ([admin gate](../../templates/analytics/app/pages/Agents.tsx#L380)).
- Core action routes already have an app-supplied authentication adapter for
  A2A JWT callers and keep the token's org separate from ambient browser state
  ([action-route adapter](../../packages/core/src/server/action-routes.ts#L176),
  [request scoping](../../packages/core/src/server/action-routes.ts#L320)).
- A2A verification already supports audience-bound tokens and is expressly
  exported for action-route authentication
  ([token verification](../../packages/core/src/a2a/server.ts#L60)).
- Analytics already ingests user-keyed product events with app, template,
  properties, and org ownership
  ([event schema](../../templates/analytics/server/db/schema.ts#L216),
  [ingest row](../../templates/analytics/server/lib/first-party-analytics.ts#L390)).
  Core tracking can enrich default properties and send arbitrary event
  properties to Analytics
  ([default props](../../packages/core/src/client/analytics.ts#L1030),
  [event send](../../packages/core/src/client/analytics.ts#L1611),
  [server provider](../../packages/core/src/tracking/providers.ts#L330)).

## Slice 1: centralized fleet flag management

### UI and navigation

Add an admin-only `Feature flags` view to Analytics at
`/agents?view=flags`, beside Monitoring and Dashboard usage. Keep Database in
the Advanced menu. This follows the existing admin-surface architecture instead
of creating another primary sidebar destination
([current view switcher](../../templates/analytics/app/pages/Agents.tsx#L467)).

The page groups rows by app. Each app section shows discovery state, flag name,
key, rollout summary, last update, and operator. Editing reuses a refactored
Core presentation component, but the Analytics container calls Analytics-local
fleet actions. Core's current `FeatureFlagsPanel` should be split into
presentation/editor pieces that accept app-qualified data and callbacks; it
must not silently call the current app's actions.

Remove the conditional feature-flag Settings contribution from
`useAgentSettingsTabs`. The app-local list and set actions remain because they
are the authoritative contract used by Analytics and agents.

Update all navigation mirrors: `AgentAdminView`, parsing, application state,
`navigate`, `view-screen`, command/search entries, strings, and localized
catalogs. The agent should be able to navigate to the view and perform the same
list/set operations through actions.

### Discovery and reads

Add Analytics action `list-workspace-feature-flags`:

1. Require an authenticated organization owner/admin. Extract a generic
   `requireAnalyticsAdminContext` from the existing database-admin-specific
   guard ([current guard](../../templates/analytics/server/lib/db-admin-connections.ts#L83)).
2. Use the existing organization app directory, which already returns trusted
   sibling app URLs with bounded caching and local-only degradation
   ([directory client](../../packages/core/src/mcp/org-directory.ts#L162)).
3. Fan out with bounded concurrency and a short per-app timeout to each target's
   `list-feature-flags` action, using a short-lived, audience-bound A2A token.
4. Return an app-qualified envelope. Each app is independently `ready`,
   `unsupported`, `unreachable`, `forbidden`, or `unknown-legacy`. No non-ready
   state is ever rendered as “all flags off.” Partial success is a normal
   result. The existing org-directory cache and Analytics action-query cache
   bound repeated reads; explicit refresh performs a new fleet fan-out.

Make the target list response unambiguous. It currently returns the same
`{ flags: [], canManage: false }` shape for “this app has no flags” and “caller
is forbidden” ([current ambiguity](../../packages/core/src/feature-flags/actions/list-feature-flags.ts#L15)).
Add a backward-compatible status/reason field so fleet callers can distinguish
those cases.

### Mutations and trust boundary

Add Analytics action `set-workspace-feature-flag` with `appId`, `flagKey`, and
the existing discriminated operation payload. It must:

1. authorize the Analytics caller as org owner/admin;
2. resolve the target only from the trusted directory, never a caller-supplied
   URL;
3. mint a token immediately before dispatch with a lifetime of at most 120
   seconds, whose audience is the exact target origin, `sub` is the operator,
   `org_id` is the verified organization id, `scope` is `flags:read` or
   `flags:write`, and `jti` gives the call an audit/replay correlation id;
4. call the target app's existing `set-feature-flag` action;
5. let the target re-authorize the delegated operator, validate the local flag,
   persist atomically, and read back the result; and
6. return the target's persisted result to the UI.

The action-route adapter should be packaged as a narrow Core helper that only
accepts A2A callers for the two feature-flag actions and checks the scope claim.
Do not enable A2A bearer auth for every HTTP action. Extend action-route caller
metadata so verified delegated calls are audited as `a2a`, rather than today's
generic `http` tag
([current caller tagging](../../packages/core/src/server/action-routes.ts#L460)).
The target must match `org_id`, then independently confirm that `sub` is an
owner/admin in its own membership. Org domain is a discovery hint, not an
authorization boundary. The target audit entry is authoritative and records
the human operator, issuer app, and `jti`; Analytics may also audit the
orchestration attempt.

### Slice 1 file map

- Core: feature-flag list response, reusable presentational editor, scoped A2A
  action client/auth helper, caller metadata, docs/skill/locales, tests.
- Analytics: `Agents.tsx` view, fleet list/set actions, admin guard extraction,
  navigation/application-state mirrors, strings/locales, action and UI tests.
- Existing apps: keep definitions and runtime guards; no Settings UI.
- Changeset: required for Core package changes. Analytics gets a user-facing
  changelog entry.

## Slice 2: Analytics-owned product experiments

### Product contract

V1 supports only authenticated-user, boolean experiments:

- one target app and one registered boolean flag;
- control is `false`, treatment is `true`;
- one fixed treatment percentage while running;
- one primary conversion event name;
- lifecycle: draft, running, paused, completed;
- descriptive results only: exposed users, conversions, conversion rate, raw
  lift, sample size, and a sample-ratio-mismatch validity warning.

Defer multivariate values, anonymous/session assignment, metric builders,
automatic winner declarations, sequential significance, and mutually exclusive
experiment layers. This makes the first causal contract small enough to trust.

Create an additive Analytics-owned `product_experiments` schema module and
named migration. Rows include identity, hypothesis, app id/origin reference,
flag key, lifecycle (including `interrupted` for integrity failures), fixed
percentage, rollout epoch, primary event, start/end times,
creator/updater, owner email, and org id. Analytics schema already uses
feature-owned modules, and migrations require unique names
([schema convention](../../templates/analytics/server/db/schema.ts#L12),
[migration convention](../../templates/analytics/server/plugins/db.ts#L30)).

### Assignment and exposure

Core's evaluator should gain a decision API while preserving the current
boolean wrapper:

```ts
type FeatureFlagDecision = {
  value: boolean;
  reason:
    | "off"
    | "global"
    | "email"
    | "org"
    | "percentage-control"
    | "percentage-treatment";
  bucket?: number;
  rolloutEpoch?: string;
  rolloutPercentage?: number;
};
```

Percentage rules carry a `rolloutEpoch` salt. Rotate it whenever percentage
changes and always rotate it when a new experiment starts. This prevents a
changed rollout from silently moving users across cohorts and prevents
sequential experiments on the same flag from repeatedly assigning the same
people to treatment. An experiment snapshots percentage+epoch; readouts accept
only matching exposure events.

Define one canonical authenticated `userKey` for V1 as normalized email. Core's
tracking identity already uses normalized email when it is available, so
bucketing, exposure, and ordinary conversion events use the same byte-identical
key. The results query rejects anonymous and non-email keys rather than trusting
callers to honor the documentation.

Emit a `$feature_flag_exposure` event only when the user is actually exposed to
the behavior, not every time code evaluates a guard. A mounted/preloaded
component or a server authorization check is not necessarily an exposure. The
event includes only app, flag key, value, decision reason, bucket, rollout
epoch, rollout percentage, and canonical user key; never copy email/org
targeting lists into analytics properties. Provide both an imperative exposure
helper and a hook option built on it. Exposure remains explicit by default; the
hook fires only when the gated surface mounts. Deduplicate client-side once per
session per flag+epoch, then deduplicate again in the result query.

Experiment readouts include only percentage-control and
percentage-treatment decisions. Exact-email, exact-org, and global decisions
are dogfood/rollout traffic, not randomized experiment cohorts.

For each user, the result query takes the first qualifying exposure during the
experiment window with the snapshotted epoch, then counts the primary outcome
only after that exposure and before pause/end. Exclude anyone observed in both
cohorts or with an exact email/org override exposure during the window.
Analytics already stores `user_key`, timestamp, event name, app, and arbitrary
properties, so the query fits the current event model without copying raw event
payloads into the experiment table.

### Lifecycle invariants

Starting writes the target flag first with a new epoch and fixed percentage,
then persists the Analytics experiment snapshot. This order may leave a live
rollout without an experiment record if Analytics persistence fails, but never
claims a running experiment before assignment is live. While it is running,
ordinary percentage/targeting edits are locked through the Analytics UI and
action layer. Because another operator or older client can still mutate the
target, a reconciler compares live flag state with the snapshot and marks drift,
missing definitions, or removal as `interrupted`.

Emergency off remains available: write the target off first, then mark the
experiment interrupted. If the Analytics write fails, the reconciler heals the stale
running record and the result window closes at the last qualifying exposure.

Only one running product experiment may own an app+flag pair. Completing an
experiment freezes its window and leaves the flag in an explicit operator-chosen
state; it must not silently roll treatment to 100%.

### UI naming

Keep `/agents?view=flags` as the permanent `Feature flags` view. Slice 2 adds a
sibling `/agents?view=experiments` view named `Product experiments`; experimented
flag rows and experiment records cross-link to one another. Rename Analytics'
embedded Core Observability tab to `Agent experiments` in Slice 1, before the
product surface arrives. Without that qualification, two unrelated systems
would look like one slightly unreliable system, which is worse.

## Verification gates

### Slice 1

- Unit-test directory filtering, A2A audience/scope rejection, permission
  replay at the target, list-state distinctions, timeouts, and partial results.
- Prove the same operator can mutate one target and is forbidden from another
  when org membership differs.
- Prove unreachable targets remain unknown, not off.
- UI-test grouping, optimistic rollback, retry, navigation state, and no local
  Settings tab.
- Human QA in Analytics against at least two real local apps with different
  registered flags.

### Slice 2

- Golden tests for stable assignment and decision reasons.
- Prove evaluation without exposure produces no analytics event.
- Prove outcomes before exposure and non-percentage targeting are excluded.
- Prove canonical user keys join assignment, exposure, and conversion; reject
  anonymous, cross-cohort, override, and wrong-epoch traffic.
- Add a sample-ratio-mismatch check (chi-square, p < 0.001) and fixture-test the
  warning independently from any later statistical winner calculation.
- Prove a running experiment locks incompatible edits and emergency off pauses
  it.
- Reconcile a fixture query by hand: cohort counts, conversions, rate, and lift.
- Human QA the full story: create, start, encounter control/treatment in the
  target app, emit conversion, inspect readout, pause, and complete.

## Fable consultation and final resolutions

Claude Fable 5 reviewed the repository evidence and draft shape. It agreed with
the federated topology and changed the implementation in five material ways:

1. The Core/target contract must be implemented and tested as an ordered layer
   before the Analytics integration is considered valid, even though both ship
   in one PR.
2. `view=flags` remains permanent; `view=experiments` is a sibling product view.
3. A2A scope+allowlist is sufficient, but the verified contract must include
   `org_id`, `jti`, exact audience, and target-local membership authorization.
4. Exposure has both imperative and hook APIs, explicit by default.
5. Product experiments require rollout epochs, one canonical user key,
   drift/interruption detection, override/cross-cohort exclusion, and a V1
   sample-ratio-mismatch check.

Final delivery decision: implement all three layers in the existing
shared-feature-flags draft PR. Keep their verification gates separate, preserve
mixed-version fleet states, and never make Core evaluation depend on Analytics
at runtime.
