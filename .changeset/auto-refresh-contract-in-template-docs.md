---
"@agent-native/core": patch
---

Docs only: spell out the auto-refresh contract in the default-template and starter `AGENTS.md` so newly-scaffolded apps know that agent writes must reflect in the UI without a manual refresh. Use `useActionQuery` (auto-covered) or fold `useChangeVersions([<source>, "action"])` into raw `useQuery` keys. Mirror the framework `adding-a-feature` and `real-time-sync` skills into `packages/core/src/templates/default/.agents/skills/` and `templates/starter/.agents/skills/` so scaffolded apps inherit the same guidance.
