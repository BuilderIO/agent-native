---
name: launchdarkly
description: >-
  Server-side and client-side LaunchDarkly flag evaluation (project key
  `agent-native`). Use when reading a LaunchDarkly flag from an action, plugin,
  or component, or when wiring `LAUNCHDARKLY_SDK_KEY`. Distinct from the
  framework's own `feature-flags` system.
scope: dev
metadata:
  internal: true
---

# LaunchDarkly

## Rule

LaunchDarkly flags are read through `@agent-native/core/launchdarkly` on the
server and `@agent-native/core/client/launchdarkly` in the browser. Every read
fails closed to a caller-supplied default — LaunchDarkly being unconfigured,
unreachable, or slow is never an availability dependency for the caller.

## LaunchDarkly vs. the built-in `feature-flags` skill

This repo already has its own rollout system (`defineFeatureFlag`,
`isFeatureFlagEnabled`, `useFeatureFlag` — see the **feature-flags** skill),
managed from the Analytics fleet control plane with no external dependency.
Use that system for a flag whose definition and targeting rules should live in
this codebase and be manageable from Analytics.

Use LaunchDarkly instead when the flag's definition and targeting genuinely
need to live in the LaunchDarkly dashboard — for example, a flag shared with
non-Agent-Native systems, or targeting rules (percentage experiments,
multi-variate values, scheduled changes) beyond what the built-in system
offers. Don't wire the same rollout through both systems.

## Setup

Set `LAUNCHDARKLY_SDK_KEY` to a server-side SDK key from the `agent-native`
LaunchDarkly project's active environment. Unset, every read falls back to its
default value and LaunchDarkly is never contacted — there is no broken state
to debug, only an inactive one.

No client-side ID or LaunchDarkly JS SDK is used. Browser code reads evaluated
flags through the `get-launchdarkly-flags` action instead, so the SDK key never
reaches a bundle and no LaunchDarkly network connection opens from the browser.

## Server usage

```ts
import { isLaunchDarklyFlagEnabled } from "@agent-native/core/launchdarkly";

run: async (args, ctx) => {
  const enabled = await isLaunchDarklyFlagEnabled("new-checkout-flow", {
    userEmail: ctx.userEmail,
    orgId: ctx.orgId,
  });
  if (!enabled) throw new Error("New checkout flow is not enabled.");
  // guarded operation
};
```

For a non-boolean flag (string/number/JSON variation), use
`getLaunchDarklyVariation(key, actor, defaultValue)` — the return type matches
`defaultValue`'s type. `getAllLaunchDarklyFlags(actor)` returns every flag
LaunchDarkly currently evaluates for that context; prefer the single-flag
functions when only a few keys matter.

`actor` is `{ userEmail?, orgId?, anonymousId? }`. A signed-in caller evaluates
by `userEmail`. A caller with neither `userEmail` nor `anonymousId` falls back
to one shared `"anonymous"` context — every such caller gets the *same*
variation from a percentage rollout, since LaunchDarkly buckets by context key.
Pass a stable `anonymousId` (a device or session id) when an unauthenticated
caller needs its own bucket.

## Client usage

```tsx
import { useLaunchDarklyFlag } from "@agent-native/core/client/launchdarkly";

function CheckoutButton() {
  const enabled = useLaunchDarklyFlag("new-checkout-flow");
  if (!enabled) return null;
  return <Button>Checkout</Button>;
}
```

`useLaunchDarklyFlag(key, defaultValue = false)` calls the mounted
`get-launchdarkly-flags` action for the current session and requires a real
session — like `useFeatureFlag`, it never fires for a signed-out visitor and
resolves to `defaultValue` instead. `useLaunchDarklyFlags(keys, defaultValue)`
evaluates several keys in one request.

## `get-launchdarkly-flags` action

Auto-mounted for every app (like `get-feature-flags`) — no plugin or
registration needed. Gateable per app via
`frameworkTools.launchDarkly` (see `framework-tools.ts`) if an app wants to
remove it from the agent's tool surface; the HTTP route stays mounted either
way so `useLaunchDarklyFlag` keeps working.

```
run("get-launchdarkly-flags", { keys: ["new-checkout-flow"], defaultValue: false })
// => { flags: { "new-checkout-flow": true } }
```

## Never do this

- Never import `@agent-native/core/launchdarkly` (the server module) from
  client/browser code — it pulls in the LaunchDarkly Node SDK. Use
  `@agent-native/core/client/launchdarkly` instead.
- Never treat a LaunchDarkly read as required for an operation to complete —
  every function here already fails closed; don't wrap calls in retries or
  turn a `false`/default result into a thrown error unless the flag itself is
  an authorization gate the caller must respect.
- Never put `LAUNCHDARKLY_SDK_KEY` in `agent-native.config.ts` or any
  client-visible config — it is server-only.

## Related skills

- **feature-flags** — the framework's own rollout system; read this first to
  decide which system a new flag belongs in.
- **configuration** — how `LAUNCHDARKLY_SDK_KEY` resolves through
  `getAppConfig().launchDarkly`.
- **secrets** — why the SDK key is a plain deploy-level env var rather than a
  vault-backed per-user/org secret.
