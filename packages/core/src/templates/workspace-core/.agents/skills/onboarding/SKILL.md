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
For API keys and service tokens, prefer `registerRequiredSecret()` from the
`secrets` skill so the settings UI, encrypted storage, validation, and
onboarding checklist stay in one place. For OAuth, check the scoped OAuth token
store. Use deployment env vars only for deploy-level configuration, not
per-user credentials.

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
