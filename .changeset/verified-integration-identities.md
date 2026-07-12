---
"@agent-native/core": patch
---

Run verified Slack direct messages with the linked Agent Native user's organization-scoped identity while keeping shared-channel messages service-scoped. Hydrated workspace members whose email is missing, unverified, or not an organization member now run as an anonymous org-scoped service principal (org-wide visibility only) with an agent-visible note and a one-time Slack heads-up, instead of being silently dropped. Identity-hydration failures, guests, external/Slack Connect members, and workspaces without a connected organization receive a polite decline reply.
