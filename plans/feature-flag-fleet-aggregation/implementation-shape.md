# Analytics feature flags — implementation shape

## Conceptual model

```text
app code declares boolean flags
           ↓
Core evaluates one rollout rule locally
           ↓
Analytics manages rollout through scoped A2A actions
```

Code is the source of truth for existence. Core settings are the source of truth
for runtime rollout. Analytics is the sole operator UI.

## Keep

### Core

- `defineFeatureFlag` and app-owned registration plugins;
- default-off, fail-closed evaluation;
- exact normalized email, exact organization, and deterministic percentage
  targeting with OR semantics;
- `isFeatureFlagEnabled`, `useFeatureFlag`, and evaluated-value reads;
- permission-checked, atomic, audited list and mutation actions;
- exact-audience, versioned A2A fleet administration;
- controlled rollout-editor primitives for Analytics.

### Analytics

- one Feature flags navigation item;
- organization-directory fleet discovery;
- grouped app states including unreachable and unsupported apps;
- one focused rollout editor with Off, Targeted, and Everyone;
- last-changed metadata already returned by target apps.

### Dogfood and instructions

- Design and Clips use the shared substrate for real flags;
- the generated feature-flag skill is copied into every relevant template;
- docs state that server actions are authoritative and the client hook is
  presentation-only and false while loading.

## Remove

- product experiment schema, actions, server logic, lifecycle, navigation, and
  UI;
- exposure and decision APIs, allocation epochs, cohort terminology, and
  outcome analysis;
- app-local Settings management wrappers and stale Settings claims;
- mutation locks and edit restrictions that existed only for experiments.

## Rollout invariants

1. Off wins over every target.
2. Everyone enables every caller accepted by the action boundary.
3. Targeted exact email or organization matches enable the flag.
4. Percentage uses Core's stable flag-key plus authenticated-identity bucket.
5. Anonymous percentage evaluation is false.
6. Increasing a percentage preserves the lower-percentage cohort.
7. Unknown definitions, malformed state, and storage failures are false.
8. Analytics accepts success only from a matching versioned response whose app,
   key, organization scope, and persisted rules match the request.

## Definition of done

- No product-experiment code, schema, routes, navigation, or UI remains.
- No feature-flag exposure/decision API or rollout epoch remains.
- Analytics shows only the clean fleet editor and honest app states.
- Core's public feature-flag surface remains boolean-only.
- Exact target, organization, percentage monotonicity, Off, Everyone, unknown,
  permission, audit, and A2A contract tests pass.
- Design and Clips dogfood tests pass.
- Skill copies are synchronized and Analytics is taught as the sole management
  UI.
- A representative local fleet UI is verified in the real browser.
