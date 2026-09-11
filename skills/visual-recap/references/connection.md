# Connecting & publishing — single source of truth

This file is the canonical rule for the never-inline deliverable, finding the
Plan MCP connector, and restoring it when its tools are missing. It is shared
word for word by `/visual-plan` and `/visual-recap`. Read it when you are about
to publish, or whenever a connector or auth error appears; do not improvise an
inline fallback from memory.

<!-- SHARED-CORE:connection START -->

**The deliverable is ALWAYS a published Agent-Native Plan, never inline chat
content.** Do not hand the plan or recap to the user as Markdown prose, an ASCII
sketch, a table, a fenced "wireframe", or a "here's the summary" paragraph. The
entire value is the hosted, interactive, annotatable Plan; an inline summary is
the thing a Plan replaces, not a degraded version of one. The only supported
output is to publish through the Plan MCP connector and return its absolute URL.
Local-files privacy mode (`references/local-files.md`) is the one exception.

**The connector is usually the `plan` server**, but older installed agents may
expose the same hosted connector as `agent-native-plans` — both names are valid,
so never report the connector as missing just because it is named
`agent-native-plans` instead of `plan`. Some clients also lazy-load connector
tools through a deferred tool registry instead of showing the namespace upfront.
Before declaring the connector missing, search/load tools with the host's
discovery surface (`tool_search` when available) for `create_visual_plan`,
`create_visual_recap`, or `get_plan_blocks`, then use the tools it exposes.

**If the tools are still missing after discovery, do NOT fall back to inline
output.** The usual cause is a connector that did not finish connecting this
session (it registers zero tools), NOT necessarily an auth problem — so do not
assume the user must re-authenticate. Stop and give the user the exact restore
step for their current client:

- **Codex / Codex Desktop:** run
  `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`
  and start a new Codex session.
- **Claude Code:** run `/mcp` and choose Authenticate/Reconnect, or run the same
  reconnect command with `--client claude-code` and restart Claude.

The same applies when a Plan tool returns `needs auth`, `Unauthorized`, or
`Session terminated`: stop retrying the tool and give the reconnect step instead.

Auth is stored per client config/session, so one client's reconnect does not make
another running client load tools. `--client all` refreshes every local client
config that already has the Plan entry, but each running client still has to
reload its MCP tools afterward. Reconnect re-authenticates WITHOUT reinstalling
and finds the entry by URL regardless of connector name — never reinstall from
scratch just to fix auth. Publish once the tool is reachable. Falling back to
inline content is a defect, not a degraded mode.

<!-- SHARED-CORE:connection END -->
