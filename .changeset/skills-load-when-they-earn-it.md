---
"@agent-native/core": patch
---

Narrow the auto-load triggers on the `frontend-design`, `shadcn-ui`, and
`self-modifying-code` skills so a routine UI edit no longer pulls a full skill
body into context. `frontend-design` now fires on genuine design work instead
of any web UI change, `shadcn-ui` no longer matches every project with a
`components.json`, and `self-modifying-code` no longer matches every source
edit. Skill bodies are unchanged; the vendored skills record the deliberate
divergence from upstream in their frontmatter.
