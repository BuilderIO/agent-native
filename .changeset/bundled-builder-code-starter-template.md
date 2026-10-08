---
"@agent-native/core": patch
---

Bundle a `builder-code-starter` scaffold template as a layer over the Chat template: `agent-native template materialize --template builder-code-starter` copies Chat, removes the Chat shell, applies the starter's unified-diff patches to the Chat files it changes, adds its own files, and merges its Drizzle scripts and dependencies into Chat's `package.json`. A bundled template opts into layering with a `template-layer.json` naming its base; a patch that no longer applies fails the materialize instead of dropping the change. `skills update scaffold` assembles the starter's patched skills the same way for apps marked `scaffold.template: "builder-code-starter"`.
