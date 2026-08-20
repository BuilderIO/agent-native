---
"@agent-native/core": minor
---

Stop regex lookaround from 400ing the whole model turn, and give three
always-on core kits a `frameworkTools` switch.

- `stripUnsupportedSchemaKeywords` now drops a `pattern` containing lookaround
  (`(?=`, `(?!`, `(?<=`, `(?<!`). Anthropic rejects it with "regex lookaround is
  not supported" and rejects the entire request, so one such tool takes every
  other tool in the payload down with it — visible as an error in chat, and as
  nothing at all in a background run. `z.string().email()` compiles to two
  negative lookaheads and appears in ~35 action schemas, so this is answered at
  the boundary every tool passes through, alongside the existing typeless-schema
  and unsupported-`format` rewrites. The action's own zod schema still validates
  the value, so nothing that was enforced is loosened.
- `emailCatalog`, `workspaceUserGroups`, and `orgServiceTokens` are new
  `frameworkTools` groups covering twelve actions that previously had no switch.
  All three default to on, so the available surface is unchanged — but they are
  now tagged, which takes them out of every app's default first-request tool
  list and leaves them reachable through `tool-search`.
- `mcp.catalog: "app"` alongside `mcp.connectorCatalog` now throws at plugin
  init. `catalog: "app"` short-circuits the connector tier, so the two together
  served the app's full registry while the allow-list sat in the config looking
  authoritative.
