---
"@agent-native/toolkit": patch
---

`useCollabReconcile` takes a new `mergedLocalSave` option: the text the host sent in a save whose answer came back merged with another writer's change, plus that answer's body and revision. When the hook plans that answer, and both the answer and the editor's current text still hold every change the host sent, it measures the server's change against the text the host sent rather than the older base. On a slow save the editor keeps typing past what it sent, and until now that made its own earlier text look like an overlap, so another writer's change stayed out until typing paused. With the option set, an agent's edit merged into a save shows up while the user keeps typing.
