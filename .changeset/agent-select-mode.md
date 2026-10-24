---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add a Select button to the agent composer. Apps register on-screen objects with `useAgentSelectable` or `useAgentSelectableSource` from `@agent-native/toolkit/composer`; in Select mode the user clicks objects to add or remove them as context chips, and Esc exits. Picked objects are listed in a `Selected objects` context block as the agent's target set and mirrored to the `agent-selection` application state key.
