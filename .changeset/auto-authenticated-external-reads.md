---
"@agent-native/core": patch
---

Add an opt-in authenticated-read MCP policy that automatically exposes explicitly safe GET actions while keeping external writes behind `ask_app`. Generic SQL stays out of that automatic surface.

The `authenticatedReads: "auto"` derivation now also applies a hard, name-based exclusion for generic database (`db-query`/`db-schema`/`db-exec`/`db-patch`), template `seed-*`, extension-management, browser-session, and Context X-Ray actions, so they can never be auto-exposed even if one is mis-annotated with the full authenticated-read flag set — only an explicit `connectorCatalog` entry can expose them.
