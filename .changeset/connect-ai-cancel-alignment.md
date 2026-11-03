---
"@agent-native/toolkit": patch
---

Keep the Connect AI setup card inside narrow chat panels and phone screens: its buttons wrap onto a second line instead of overflowing, a connect error wraps under the buttons instead of pushing Custom keys out of the card, and a long "Connected to" workspace name truncates. The Waiting, Cancel, and Custom keys buttons now share one size while a Builder.io connection is in progress. `BuilderConnectPopover` accepts `cancelSize` so the Cancel button can match its trigger.
