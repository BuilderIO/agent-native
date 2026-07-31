---
"@agent-native/core": patch
---

Let a delegated A2A run inherit the caller's model when the receiving app never
picked one. A cross-app turn resolved its model entirely on the receiving side,
and the stored lookup is scoped to the receiver's own app id — so selecting
Sonnet in Slides still ran any question Slides delegated to Analytics on
Analytics' default. Nothing in the request carried the caller's choice.

`call-agent` now sends the model it is running on as `callerModel` in the
existing A2A correlation metadata, and the receiver applies it strictly last
before its default: explicit config, then its own stored setting, then the
hint. An app that deliberately pins a model keeps it; the hint only fills the
gap where the receiver would otherwise take a default it never chose.

The hint is a preference, never an authorization. It is bounded to the
receiver's already-resolved engine catalog by `resolveDelegatedRunModel`, so a
peer cannot move the run to another provider, an unknown id, or a capability
tier the engine does not offer; engines that cannot prove membership (empty
catalog, OpenAI-compatible gateway) take no hint at all. A rejected hint is
logged and dropped rather than failing the delegated run, and it stays out of
every identity, org, access, and approval path.
