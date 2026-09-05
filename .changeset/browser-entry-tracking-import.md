---
"@agent-native/core": patch
---

Load the tracking registry lazily from the action lifecycle wrapper so `@agent-native/core`'s browser entry no longer pulls `server/deploy-environment` and the database client into client bundles, which crashed the Slides deck editor at load. A test now walks the browser entry's static import graph and fails on any server-only module.
