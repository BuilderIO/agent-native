---
name: onboarding
description: >-
  How to register user-facing setup steps (API keys, OAuth, connecting
  third-party services) for the sidebar setup checklist. Use when adding a
  feature that needs initial user configuration.
---

# Onboarding Steps

## Rule

If a feature requires user-facing setup (API keys, OAuth, connecting a third-party service), register an onboarding step so it appears in the agent sidebar's setup checklist.

## Registering a Step

```ts
import { registerOnboardingStep } from "@agent-native/core/onboarding";

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
  isComplete: () => !!process.env.GMAIL_REFRESH_TOKEN,
});
```

See `packages/docs/content/onboarding.md` for method kinds and built-in steps.

## Related Skills

- `adding-a-feature` — The four-area checklist; onboarding is often part of a new integration
- `authentication` — Most onboarding steps involve OAuth or credentials
