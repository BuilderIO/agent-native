---
"@agent-native/core": patch
---

Fix Chrome visual glitchiness (blank/stale regions on scroll, pan, and zoom) in
plan documents and canvases by removing `backdrop-filter` (`backdrop-blur`) from
always-rendered per-block controls. A long plan rendered 40+ per-block edit
triggers, each forcing its own composited backdrop layer; Chrome re-samples every
backdrop snapshot on each scroll frame and its backdrop-filter invalidation drops
tiles, leaving regions blank until the next repaint. The tiny hover-trigger chips
now use an opaque background, which is visually identical but eliminates the
composited backdrop layers. Affects the block edit trigger, diagram/mermaid
expand/style triggers, and wireframe style trigger.
