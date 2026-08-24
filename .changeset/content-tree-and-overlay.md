---
"@agent-native/toolkit": patch
---

Adds a shared `afterBodyPointerUnlock` helper (`@agent-native/toolkit/ui/pointer-lock`) that defers opening a follow-up Dialog/Sheet/AlertDialog until `document.body.style.pointerEvents` is confirmed unlocked, avoiding the Radix dismissable-layer race where a new modal mounts before a closing one (with a nested Select) finishes unregistering and leaves the page permanently unclickable.
