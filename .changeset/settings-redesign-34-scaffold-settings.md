---
"@agent-native/core": patch
---

New apps scaffolded from the default template open the redesigned Settings full height when `settings-redesign` is on, without their own Back link, title, or language card (the shell has Back to {App}, and core Preferences owns the interface language), and gain a `settings.$.tsx` splat route so `/settings/<page>` links resolve. With the flag off the scaffold's Settings page is unchanged.
