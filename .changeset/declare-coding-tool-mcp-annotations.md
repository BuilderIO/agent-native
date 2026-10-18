---
"@agent-native/core": patch
---

Advertise reviewed MCP tool annotations for framework tools. The `bash`, `edit`, and `write` coding tools and the `set-service-principal-lifecycle` and `set-service-principal-policy` actions are destructive, and `ask-agent` is destructive and open-world.

`run-code` and `web-request` now advertise `readOnlyHint: false`, `destructiveHint: true`, and `openWorldHint: true` over MCP, and OAuth tokens need `mcp:write` to list or call them. Both are still read-only to the in-app agent. More generally, MCP treats a read-only action as a write when its plan-mode effect can classify a call as a write, or when it declares `readOnlyHint: false`. That covers the scope check, the derived hints, ask-app-only write filtering, and directory-profile validation. Dev discovery now keeps an action's `planMode`, so its plan-mode effect also reaches the in-app agent in dev, as it already does in production.

MCP clients of a dev server see new hints for the files it discovers as tools. Before, every discovered tool advertised `readOnlyHint: false`, `destructiveHint: false`, and `openWorldHint: false`, whatever the file declared. Now a discovered action advertises the `mcpAnnotations` it declares. One that declares none advertises `destructiveHint: true` and `openWorldHint: true`, or `readOnlyHint: true` and `openWorldHint: true` if it is read-only; a file wrapped as a command-line tool counts as a write. These framework defaults live in the action entry's new `mcpAnnotationDefaults`, so `mcpAnnotations` holds only hints an action declared itself. Production catalogs do not include discovered files.

Export the framework action loader list so contract tests can load every entry strictly.
