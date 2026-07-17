# Centralized feature flags in Analytics

## Final direction

Agent Native needs a shared feature-flag substrate and one clean operator
control plane. It does not need a product experimentation platform.

A flag is a source-declared boolean with one rollout rule. Apps own definitions
and guarded behavior. Core owns registration, evaluation, permissions, audited
mutation, and the client read hook. Analytics owns the only management UI and
coordinates app-local actions through scoped A2A delegation.

## Evidence

- Core settings already provide provider-agnostic global and organization
  rollout persistence, so Analytics does not need a flag database.
- The organization directory already distinguishes ready, no-definition,
  unsupported, forbidden, legacy, and unreachable apps. Unreachable means a
  directory-known app whose flag-list call fails.
- Exact email, organization, and percentage rules can share one deterministic
  evaluator with OR semantics. Percentage evaluation requires an authenticated
  identity and fails closed otherwise.
- App-local management panels duplicate the control plane and teach agents the
  wrong ownership boundary. Apps need evaluation APIs, not toggle UIs.
- Exposure events, metrics, variants, hypotheses, and lifecycle state exist to
  support experiments rather than safe rollout. They are intentionally absent.

## Fable consultation

Fable agreed on the invariant: a flag is a boolean declared in code, overridden
by exactly one rollout rule, and managed in exactly one place. The consultation
also confirmed that exposure tracking should be removed because it creates the
seed of an experimentation platform, and that percentage cohorts must remain
stable when the rollout increases.

The implementation deliberately defers audit timelines, orphan-state cleanup,
personalized SSR hydration, non-boolean values, variants, and outcome analysis.
Those would require separate product decisions or new substrate.

## User experience

Analytics exposes one **Feature flags** surface under `/agents?view=flags`:

- apps grouped with honest reachability state;
- code-owned name, key, description, and default;
- Off, Targeted, or Everyone rollout state;
- exact email, organization, and deterministic percentage targeting;
- updated-by and updated-at metadata;
- atomic Enable for me, Turn off now, and Save targeting controls.

No app adds a Feature flags Settings tab. No UI creates flag definitions.

## Agent experience

The generated `feature-flags` skill teaches one workflow: declare, register,
guard the authoritative server action and hydrated client UI, verify the flag
appears Off in Analytics, roll it out, and remove it after adoption. It also
forbids variants, experiment telemetry, raw settings writes, per-app management
panels, and security boundaries behind flags.
