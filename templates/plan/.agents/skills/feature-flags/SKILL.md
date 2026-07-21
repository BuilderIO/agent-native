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

A feature flag is a boolean declared in app code, evaluated locally by Core,
and managed from the Analytics fleet control plane. Code owns whether a flag
exists. Runtime settings own only its rollout state.

Flags let an app deploy dormant code and turn it on in the real environment
without another deployment. They are not experiments: do not add variants,
hypotheses, conversion metrics, exposure tracking, or lifecycle states.

## When to use one

Use a flag for a reversible rollout of a user-facing capability whose dormant
code is safe to deploy. Flags are useful for production dogfooding, exact-user
or organization pilots, and deterministic percentage rollouts.

Do not use a flag for authentication, authorization, secrets, audit enablement,
SSR cache behavior, or another security boundary. Client hiding is presentation
only; every guarded server action must evaluate the same registered flag.

## Agent workflow

### 1. Declare

Keep definitions in a shared TypeScript module so server and client code use the
same stable key. Flags are boolean and default-off.

```ts
import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const FULL_APP_BUILDING = defineFeatureFlag({
  key: "full-app-building",
  displayName: "Full app building",
  description: "Create and edit Fusion-backed applications.",
});
```

Keys are immutable, never reused, and contain only letters, numbers, dots,
underscores, or hyphens. Prefer a concise app-owned name. Do not create flag
definitions or rollout rows from Analytics.

### 2. Register

Register app definitions from a Nitro plugin before actions are discovered.
Do not add app-specific flags to a Core registry.

```ts
import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { FULL_APP_BUILDING } from "../../shared/feature-flags.js";

export default createFeatureFlagsPlugin({ flags: [FULL_APP_BUILDING] });
```

### 3. Guard server and client

The server action is the enforcement boundary:

```ts
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";

run: async (args, ctx) => {
  if (!(await isFeatureFlagEnabled(FULL_APP_BUILDING, ctx))) {
    throw new Error("Full app building is not enabled for this account.");
  }
  // guarded operation
}
```

Use the client hook only to hide or reveal hydrated UI:

```tsx
import { useFeatureFlag } from "@agent-native/core/client/feature-flags";

const enabled = useFeatureFlag(FULL_APP_BUILDING.key);
return enabled ? <FullAppOption /> : null;
```

The client hook intentionally returns false while loading or for an unknown
flag. Never replace that fail-closed behavior with app-local bucketing or a
compile-time fallback. Never evaluate personalized flags in the public SSR
shell; it is shared and cached for every visitor.

### 4. Verify and roll out

1. Verify the off path before changing rollout state.
2. Confirm the registered flag appears in **Analytics → Feature flags** for the
   app and is Off by default.
3. Use **Enable for me** for initial production dogfood.
4. Expand to exact emails, organization IDs, or a percentage only from
   Analytics.
5. Confirm the client presentation and authoritative server action agree.

## Management contract

Core mounts three actions in registered apps:

| Action | Purpose |
| --- | --- |
| `get-feature-flags` | Return the current caller's evaluated boolean values. |
| `list-feature-flags` | Return definitions and rollout metadata to an authorized operator. |
| `set-feature-flag` | Atomically turn a flag off, enable it for the operator, or replace targeting rules. |

Analytics calls the app-local operator actions through narrowly scoped A2A
delegation. Tokens require an exact audience, organization, scope, operator
role, and audit correlation id. Management is permission-checked and audited
by the target app. Never manage flags through generic settings routes, raw SQL,
or per-app toggle UIs.

## Rollout semantics

The operator modes are **Off**, **Targeted**, and **Everyone**. Core stores them
as `off`, `rules`, and `on`.

Targeted rules combine exact normalized emails, exact organization IDs, and a
percentage with OR semantics. Exact matches are checked first. Percentage
buckets use Core's stable hash of the flag key and authenticated user identity;
anonymous callers fail closed. Raising a percentage preserves the users already
included at a lower percentage. Do not implement bucketing in app code.

Unknown definitions, missing state, malformed state, storage errors, and
evaluation errors all return the code default (`false` in v1). Explicit Off
wins over every target; Everyone enables every authenticated caller.

## Remove a flag

After a rollout is permanent:

1. Replace guarded branches with the chosen behavior.
2. Delete the server and client gates.
3. Delete the definition and registration entry.
4. Verify the flag disappears from the Analytics fleet.
5. Remove stale tests and rollout instructions.

A permanent flag is just an if statement with a pension plan.

## Verification checklist

- Unknown and unregistered keys evaluate false.
- UI hiding and server enforcement use the same registered key.
- Exact-user, organization, deterministic percentage, Everyone, and Off paths
  have focused tests.
- Increasing a percentage is monotonic; anonymous percentage evaluation is off.
- Unauthorized callers cannot list targeting details or mutate flags.
- Mutations are atomic, read back stored state, emit refresh, and appear in the
  audit log with the flag key.
- Analytics represents ready, no-definition, unsupported, forbidden, legacy,
  and unreachable directory apps honestly.
- Future agents can find this skill from root `AGENTS.md`, and
  `pnpm guard:workspace-skills` passes after syncing generated copies.

## Related skills

- **adding-a-feature** — preserve UI/action/instruction/application-state parity
- **actions** — define and call guarded app operations
- **audit-log** — inspect automatic action mutation history
- **reliable-mutations** — make rollout changes atomic and provable
- **security** — keep security controls out of feature flags
