---
"@agent-native/toolkit": patch
---

Let an app open its own block menu from the drag handle with the new `openMenu` option, and keep the handle on screen beside blocks at the page's edge. An open block menu now stays on its block when blocks around it are added, removed or duplicated. It closes when a collaborator changes that block, and does nothing once the block is deleted, instead of acting on the block that took its place.
