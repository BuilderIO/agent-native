---
"@agent-native/core": patch
---

Fix "Connect Builder.io" doing nothing when it is clicked before the first Builder status read lands. `BuilderConnectPopover` rendered an ordinary enabled-looking trigger for the whole duration of that read, then discarded any click that arrived during it — on a cold serverless instance that window is seconds long, which is exactly when a brand-new signup reaches the Connect AI step. The trigger now holds the intent, marks itself `aria-busy`, and runs it as soon as the capability resolves (direct connect, or the provisioning consent popover when provisioning is available). A status read that fails releases the intent instead of leaving the button busy, since the surfaces that render this trigger already surface the read error.
