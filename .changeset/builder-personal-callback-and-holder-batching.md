---
"@agent-native/core": patch
---

The Builder.io OAuth callback decides where a connection is saved from the connector's current role in the organization the flow started in, so a promotion, demotion, restriction change, or organization switch during sign-in can't leave a personal grant that shadows the organization's connection or skips the personal API key restriction. The personal API key restriction view reads every member's Builder.io grant in a few batched queries instead of one per member.
