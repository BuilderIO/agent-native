---
"@agent-native/core": patch
---

Stop the local `dev` environment pill from swallowing clicks. It is a fixed,
`z-[100]`, decorative `role="status"` element with no handler, pinned to the
bottom-left corner — so it hit-tested on top of whatever app chrome sits there
and made those controls unclickable (the Design workspace rail's bottom item,
for one). The interactive beta/production badge keeps its pointer events.
