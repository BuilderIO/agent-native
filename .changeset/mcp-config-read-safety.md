---
"@agent-native/core": patch
---

fix(mcp): throw on corrupt JSON config instead of silently overwriting with empty object

`readJsonFile` in `mcp-config-writers.ts` previously swallowed all read/parse errors and returned `{}`, meaning a corrupt or partially-written `~/.claude.json` (or `.mcp.json` / `~/.cowork/mcp.json`) would be silently replaced with only the new `mcpServers` entry — destroying the user's entire Claude Code state. Now only a missing or empty file yields `{}`; a non-empty file that fails to parse throws a descriptive error pointing to the file path and asking the user to fix or move it before re-running.
