---
name: feature-flags
description: >-
  Declare, evaluate, manage, and remove framework feature flags. Use when
  shipping a capability gradually, targeting users or organizations, or
  replacing a compile-time rollout switch with a production-safe runtime flag.
scope: dev
metadata:
  internal: true
---

# Feature Flags

Feature flags let an app ship dormant code and turn it on in the real runtime
without another deployment. The framework owns registration, evaluation,
management actions, audit history, and the Settings UI; each app owns its flag
definitions and the code paths they guard.

## When to use one

Use a flag for a reversible rollout of a user-facing capability whose code is
safe to deploy before it is enabled. Flags are especially useful for production
dogfooding, exact-user or organization pilots, and deterministic percentage
rollouts.

Do not use a runtime flag for authentication, authorization, secret handling,
audit enablement, SSR cache behavior, or another security boundary. A flag may
hide UI, but the guarded server action must evaluate the same flag itself.

## Declare and register

Keep definitions in a shared TypeScript module so server and client code use the
same stable key. Boolean flags are default-off in v1.

```ts
import { defineFeatureFlag } from "@agent-native/core/feature-flags";

export const FULL_APP_BUILDING = defineFeatureFlag({
  key: "full-app-building",
  displayName: "Full app building",
  description: "Create and edit Fusion-backed applications.",
});
```

Register definitions from a Nitro plugin before actions are discovered or
called. Do not add app-specific flags to Core's registry.

```ts
import {
  createFeatureFlagsPlugin,
} from "@agent-native/core/server";

import { FULL_APP_BUILDING } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: [FULL_APP_BUILDING] });
```

## Guard both surfaces

Server actions are the enforcement boundary. Evaluate the current action caller
before doing guarded work:

```ts
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";

run: async (args, ctx) => {
  if (!(await isFeatureFlagEnabled(FULL_APP_BUILDING, ctx))) {
    throw new Error("Full app building is not enabled for this account.");
  }
  // guarded operation
}
```

Use the client hook only for presentation. It reads the same evaluated action
result and fails closed while loading or for unknown flags.

```tsx
import { useFeatureFlag } from "@agent-native/core/client";

const enabled = useFeatureFlag(FULL_APP_BUILDING.key);
return enabled ? <FullAppOption /> : null;
```

Never evaluate a personalized flag while rendering the public SSR shell. The
shell is shared and cacheable; evaluate after client hydration or inside an
authenticated action.

## Management actions

Core mounts these actions in every app:

| Action | Purpose |
| --- | --- |
| `get-feature-flags` | Return only the current caller's evaluated boolean values. Safe for ordinary app code. |
| `list-feature-flags` | Return registered definitions and rollout metadata to an authorized flag operator. |
| `set-feature-flag` | Atomically turn a flag off, enable it for the current operator, or replace its targeting rules. |

The Feature flags Settings tab calls the same actions. It appears only when the
app has registered flags and the server says the caller may manage them.
Management is permission-checked and audited on the server. Do not read or write
flag settings through generic settings routes, raw SQL, or extension tools.

## Rollout semantics

Runtime state supports immediate off/on, exact normalized user emails, exact
organization IDs, and a deterministic percentage. Evaluation is fail-closed:
missing definitions, missing state, malformed state, and evaluator errors return
the code default (`false` in v1).

An explicit global off wins over every target. Global on enables every caller.
Otherwise an exact user or organization match enables the caller, followed by
the stable percentage bucket. A percentage rollout must use Core's evaluator;
do not invent another hash in app code.

## Lifecycle

1. Add the dormant code and register the default-off definition.
2. Guard UI and every server mutation/read that exposes the capability.
3. Verify the off path first, then use **Enable for me** for production dogfood.
4. Expand with exact targets or percentage rollout while watching product and
   operational signals.
5. Turn the flag off immediately if rollback is needed. Polling clients roll
   back on their next refresh, so document any non-instant native poll window.
6. Once the rollout is permanent, remove the flag, its runtime state, both code
   branches, and stale tests. A permanent flag is just an if statement with a
   pension plan.

## Verification

- Unknown and unregistered keys evaluate false.
- UI hiding and server action enforcement use the same registered key.
- Exact-user, organization, percentage, global-on, and global-off paths have
  focused tests.
- Unauthorized callers cannot list targeting details or mutate flags.
- Mutations are atomic, read back their stored state, emit action refresh, and
  appear in the audit log with the flag key.
- Future agents can find this skill from the root `AGENTS.md`, and
  `pnpm guard:workspace-skills` passes after syncing generated copies.

## Related skills

- **adding-a-feature** — preserve UI/action/instruction/application-state parity
- **actions** — define and call guarded app operations
- **audit-log** — inspect automatic action mutation history
- **reliable-mutations** — make rollout changes atomic and provable
- **security** — keep security controls out of feature flags
- **agent-native-toolkit** — framework ownership of shared Settings surfaces
