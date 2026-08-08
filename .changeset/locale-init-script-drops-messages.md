---
"@agent-native/core": patch
---

Stop inlining the translation catalog into the render-blocking locale init
script. `getLocaleInitScript()` now emits only `locale`, `preference`, and
`dir`; the catalog already reaches `AgentNativeI18nProvider` through loader data
as `initialMessages`. The `messages` option is removed — passing it is now a
type error rather than a silently duplicated payload.
