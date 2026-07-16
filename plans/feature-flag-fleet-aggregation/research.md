# Centralized feature flags and experiments in Analytics

## Decision

Agent Native should centralize feature-flag management in the Analytics app,
alongside A/B testing and experiment readouts. This is a near-term product
direction, not a hypothetical fleet dashboard to revisit later.

Core remains the runtime substrate. Apps declare their own stable flag keys and
guard their own client and server code. Analytics becomes the one operator
surface for discovering flags, changing rollout rules, connecting a flag to an
experiment, and reading outcomes.

The automatic per-app **Feature flags** Settings tab should not be the primary
management product. The current implementation should pivot that UI into
Analytics so operators do not have to visit a constellation of app settings
menus or wonder which island contains the switch.

## Product shape

The natural home is Analytics' existing admin and observability area under
`/agents`, which already includes experiments and is explicitly the home for
future admin additions
([Analytics agent guidance](../../templates/analytics/AGENTS.md#L135-L145)).

The first coherent surface is **Experiments & flags**:

- A fleet inventory grouped by app, with search and status filters.
- Flag name, description, owning app, rollout mode, targets, percentage, and
  last-change metadata.
- Existing management operations: enable for me, global off/on, exact user or
  organization targets, and percentage rollout.
- A clear distinction between an operational flag and a measured experiment.
- The ability to associate a flag with an experiment and choose its success
  metric.
- Exposure and outcome readouts in Analytics, not in each source app.
- Explicit **unknown/unreachable** state when an app cannot be queried.

A boolean flag can support an initial control/treatment experiment. Multivariate
flags are a later extension and should not be smuggled into this pivot unless the
first experiment workflow requires them.

## Ownership boundary

### Core owns

- Flag definition and registration primitives.
- Default-off, fail-closed evaluation.
- Shared rollout-rule types and deterministic bucketing.
- Permission and audit primitives.
- Client hooks and server-side enforcement helpers.
- The deterministic cross-app management contract used by Analytics.
- Exposure-event schema and emission helpers so assignments can be measured.

Core already owns the reusable mechanism while apps own definitions and guarded
code paths
([feature-flags skill](../../.agents/skills/feature-flags/SKILL.md#L14-L17)).
That remains correct.

### Each app owns

- Its registered flag definitions.
- Every guarded UI and server action.
- Its authoritative runtime rollout rules in the current architecture.
- Authorization of each requested read or mutation against the acting operator.
- The authoritative audit record for mutations applied to that app.

The current list action explicitly reads **this app's** registered definitions
and rules
([list-feature-flags.ts](../../packages/core/src/feature-flags/actions/list-feature-flags.ts#L8-L36)).
Analytics should orchestrate this app-owned state, not copy it into a competing
configuration table.

### Analytics owns

- Fleet discovery and the centralized operator UI.
- Experiment metadata: hypothesis, control/treatment, metrics, lifecycle, and
  readout.
- Live aggregation of each app's current flag state.
- Coordinating mutations through the target app's authenticated management
  action.
- Exposure and outcome analysis.
- Its own request/audit trail, while the target app's mutation audit remains
  authoritative.

## Data flow

1. An app registers a flag with Core and guards both its UI and server action.
2. Analytics discovers eligible workspace apps through the existing workspace
   app/agent directory.
3. Analytics calls a deterministic, authenticated Core management contract on
   each reachable app using the real operator identity.
4. The target app authorizes the operator and returns its live flag summaries.
5. Analytics renders the fleet view. It does not persist returned rules as a
   second source of truth; any display cache is ephemeral and timestamped.
6. A mutation from Analytics is sent to the owning app, applied atomically
   there, read back, and audited there.
7. When a flag participates in an experiment, the app emits bounded exposure
   events to Analytics with app id, flag key, experiment id, assignment, actor
   or subject identity as permitted, and timestamp.
8. Analytics joins exposures to the selected outcome metric and owns the
   experiment readout.

Dispatch is not in the data path. Its workspace discovery concepts may be reused
through shared Core contracts, but Dispatch does not become a flag proxy or
configuration owner.

## Current implementation changes

### Preserve

- Core registry, evaluator, rules, permissions, audit behavior, actions, hooks,
  tests, documentation, and app-owned registration.
- Design and Clips migrations to stable registered flags.
- Default-off and emergency-off behavior.

### Pivot

- Remove the automatic Feature Flags contribution from every app's shared
  Settings navigation.
- Reuse its useful row/dialog interaction design inside Analytics' admin area.
- Add a deterministic cross-app list/set contract with delegated operator
  identity; do not use a free-form LLM/A2A prompt for administrative state.
- Add Analytics actions and UI for fleet inventory and mutation orchestration.
- Teach Analytics and future agents that flags and experiments are managed from
  this centralized surface.

### Defer

- Multivariate flags.
- Automatic statistical significance claims.
- Bulk rule editing across unrelated flags.
- A one-click “turn everything off” operation.
- Moving runtime flag rules into Analytics' database. That would make Analytics
  an availability dependency and requires a separate caching and consistency
  design.

## Architectural invariants

1. Analytics is the centralized product surface, not a second configuration
   store.
2. App-local rules remain authoritative unless a later architecture explicitly
   replaces them with a resilient central service.
3. Every target app authorizes reads and writes against the real acting
   operator; Analytics' UI grants no authority by itself.
4. Unreachable means unknown, never off and never silently current.
5. The target app records the authoritative mutation audit event.
6. The target app's server action remains the enforcement boundary.
7. Experiment exposure is recorded separately from mere flag evaluation so
   readouts do not count users who never encountered the treatment.
8. Analytics is not required on the hot path for ordinary flag evaluation.
9. Dispatch owns neither flag state nor experiment state.

## Fable consultation and superseding evidence

Fable (`anthropic/claude-fable-5`, finish reason `stop`) initially recommended
waiting because only two apps currently register flags. Its enduring advice was
to preserve app authority, represent unreachable apps as unknown, and introduce
cross-app mutation narrowly.

That timing recommendation is superseded. New product evidence establishes that
the need recurs across the team and that feature flags and A/B testing should be
centralized in Analytics sooner rather than later. The placement is now a product
decision; the remaining work is implementation shaping, not whether Analytics is
the right home.

## Recommendation

Pivot the current feature-flag PR rather than discarding its Core work. Move the
operator experience from shared per-app Settings into Analytics' existing
`/agents` admin/observability area, introduce the smallest safe cross-app
management contract, and make room for experiment association and measurement.

Execution placement: local implementation in the Agent Native repository using
the existing hosted Analytics/Core topology. No separate service or
framework-compute workload is needed for this phase.

## Sources

- Agent Native feature-flags skill and current Core implementation, linked
  above.
- Analytics' current admin/experiments architecture and repository guidance,
  linked above.
- Product-direction update received 2026-07-16; stakeholder details intentionally
  omitted from the repository artifact.
