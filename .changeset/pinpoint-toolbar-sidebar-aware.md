---
"@agent-native/pinpoint": patch
---

Keep the pinpoint toolbar inside the viewport when the agent sidebar is open by tracking the visible sidebar width via MutationObserver + ResizeObserver and clamping toolbar position + drag bounds.
