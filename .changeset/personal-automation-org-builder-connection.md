---
"@agent-native/core": patch
---

Personal automations now reach models through the organization's Builder.io connection when their creator has none of their own, instead of failing with `missing_credentials`. The org's sign-in comes first, then its key pair. It is the last resort: the creator's own sign-in (even one that needs reconnecting), their own key pair, and the deployment's credits pair still come first. Only model calls use it; the run's other Builder calls, and lookups that ask for no organization, stay personal.
