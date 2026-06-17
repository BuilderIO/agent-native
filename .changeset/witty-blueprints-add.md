---
"@agent-native/core": minor
---

Add `agent-native add <kind> [name|url]`, a blueprint installer. Instead of
scaffolding files, it prints a curated Markdown integration blueprint to stdout
so you can pipe it into your own coding agent (`agent-native add provider stripe
| claude`). A URL instead of a name emits a generic research-and-integrate
blueprint with the URL as the research seed. Ships seeded blueprints for
provider-api integrations, inbound channel adapters, custom sandbox adapters,
and multi-surface actions; `--list` browses what's available.
