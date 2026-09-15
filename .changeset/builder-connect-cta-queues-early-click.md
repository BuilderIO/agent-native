---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fix "Connect Builder.io" doing nothing when it is clicked before the first Builder status read lands. `BuilderConnectPopover` rendered an ordinary enabled-looking trigger for the whole duration of that read, then discarded any click that arrived during it — on a cold serverless instance that window is seconds long, which is exactly when a brand-new signup reaches the Connect AI step. The trigger now holds the intent, marks itself `aria-busy`, and opens the provisioning consent choice as soon as the capability resolves. It never replays the intent into `flow.start()`, because that reaches `window.open` and browsers only permit it inside the click that asked for it; when the resolved capability has no consent choice to show, the intent is released and the now-resolved trigger answers the next click synchronously.

`useBuilderConnectFlow` also exposes `statusReadSettledCount`, which increments whenever a status read settles regardless of outcome. `statusResolved` alone cannot bound a caller waiting on a read: a second failure leaves it `false` with no observable change, so a queued click keyed on it would wait forever. `retry()` now returns whether a read actually started, so a caller cannot wait on a disabled flow that will never read. The composer runtime adapter contract (`ComposerBuilderConnectFlow`) declares `retry` alongside it, so a non-core runtime can supply it and get the same behavior in `TiptapComposer`.
