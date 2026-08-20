---
name: onboarding
description: >-
  How to register user-facing setup steps (API keys, OAuth, connecting
  third-party services) for the sidebar setup checklist. Use when adding a
  feature that needs initial user configuration.
scope: dev
metadata:
  internal: true
---

# Onboarding Steps

## Rule

If a feature requires user-facing setup (API keys, OAuth, connecting a third-party service), register an onboarding step so it appears in the agent sidebar's setup checklist.

Onboarding must point users to a secure credential path; it must never encode
the credential value in source, docs, fixtures, prompts, or generated content.
For a provider represented in the workspace connection catalog, check the
connection readiness and app grant first, then resolve credentials through the
scoped workspace-connection helper. Only when no reusable connection exists
should API keys and service tokens use `registerRequiredSecret()` from the
`secrets` skill. For OAuth, check the scoped OAuth token store. Use deployment
env vars only for deploy-level configuration, not per-user credentials.

Model onboarding around the logical connection outcome, not its individual
fields. Because `registerRequiredSecret({ required: true })` auto-injects a
checklist item per registration, do not mark every credential/config field as
required by reflex. Use one composite onboarding step or connection readiness
check when several values are needed for one provider.

A custom setup page is appropriate only when it adds provider-specific
prerequisites, sequencing, or health checks. Keep it as a thin guide over the
shared settings, vault, OAuth, and action surfaces; never make it a second place
that stores or manages credentials.

## Registering a Step

```ts
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { hasOAuthTokens } from "@agent-native/core/oauth-tokens";

registerOnboardingStep({
  id: "gmail",
  order: 100,
  title: "Connect Gmail",
  description: "Grant read/send access.",
  methods: [
    {
      id: "oauth",
      kind: "link",
      primary: true,
      label: "Sign in with Google",
      payload: { url: "/_agent-native/google/auth-url" },
    },
  ],
  isComplete: async (ctx) =>
    ctx?.userEmail ? hasOAuthTokens("google", ctx.userEmail) : false,
});
```

See `packages/core/docs/content/onboarding.md` for method kinds and built-in steps.

## Related Skills

- `adding-a-feature` — The four-area checklist; onboarding is often part of a new integration
- `authentication` — Most onboarding steps involve OAuth or credentials
