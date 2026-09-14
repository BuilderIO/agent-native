---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fix three reported Content defects at their shared boundaries.

`findConnectedMcpServersForProvider()` (new, from `@agent-native/core/mcp-client`)
resolves the remote MCP servers a user or org has saved for one catalog
provider, so an app-level status action can stop answering "not connected" for a
provider that Settings shows connected. Any app that keeps its own provider
credential registry alongside the MCP catalog had the same latent conflation.
The provider host table moved to `@agent-native/core/shared/mcp-provider-hosts`
so a server path can match provider URLs without importing the inlined logo data
from the client catalog.

`TaskListPasteNormalization` (new, from `@agent-native/toolkit/editor`) rewrites
foreign checkbox-list HTML into the canonical `data-type="taskList"` shape
before the schema parses it, so pasting a checklist from Notion or GitHub keeps
its checkboxes instead of degrading to plain bullets. It is registered
automatically whenever the shared editor factory's `tasks` feature is on.

The shared block drag handle no longer opens its menu in the top-left corner of
the window. `getBoundingClientRect()` answers an all-zero rect rather than null
for a hidden, detached, or unlaid-out element, so the previous null-check never
fired for the case that actually happens and the zero rect clamped the menu to
the viewport padding. The menu now walks grip, block, and editor candidates and
declines to open when none of them is laid out.
