---
"@agent-native/core": patch
---

Bundle a `fusion-starter` scaffold template as a layer over the Chat template: `agent-native template materialize --template fusion-starter` copies Chat, removes the Chat shell, replaces the files the starter owns, and merges its Drizzle scripts and dependencies into Chat's `package.json`. A bundled template opts into layering with a `template-layer.json` naming its base. `skills update scaffold` keeps the starter's skill overrides for apps marked `scaffold.template: "fusion-starter"`.
