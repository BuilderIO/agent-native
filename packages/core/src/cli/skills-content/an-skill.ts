export const AN_SKILL_MD = `---
name: an
description: >-
  Open and operate Agent-Native workspace apps through Dispatch MCP, with
  inline app surfaces, browser-session authentication, and current screen state.
metadata:
  visibility: exported
---

# Agent-Native Apps

Use \`/an <app>\` to open an Agent-Native app beside the conversation and keep
the app's live UI and the agent's actions in the same workflow. The first
argument is the Dispatch app id. For example, \`/an slides\` opens the Slides
editor. After it opens, the user can sign in in that browser surface and ask
for new decks or focused edits in ordinary language.

## Open the app

For a known app, call Dispatch's \`open_app\` with an inline surface:

\`\`\`json
{
  "app": "slides",
  "path": "/",
  "embed": true,
  "chrome": "full"
}
\`\`\`

The MCP App response is the preferred handoff for Claude, Claude Desktop,
Claude Cowork, ChatGPT, ChatGPT desktop, Codex, and other compatible hosts. Keep
the returned open link as the fallback for a host that cannot render MCP Apps
inline. Do not claim that a browser opened unless the host rendered the inline
surface or its browser tool confirmed the returned URL.

If the app name is missing or uncertain, call \`list_apps\` first and use the
exact granted app id. If the requested app is not listed, explain that it must
be granted in Dispatch's Agents access settings. Do not invent a URL, use a
localhost URL, or route around the Dispatch grant.

## Work in the opened app

Prefer direct app tools when the host exposes them. After opening an app, call
\`list-host-webmcp-tools\` when available, then use \`run-host-webmcp-tool\`
with the exact listed name and origin. Page-local tools reflect current app
state and selection, so use \`view-screen\` before selection-dependent edits
and read back writes.

You are the model doing the work: when the user asks for new content — a
design, a deck, a form, a document — author it yourself and save it with the
app's create/update tools. Never hand off authoring to the app's own agent
when those tools exist, and never wait on an in-app question form; it answers
back through that app's own chat, not to you.

Use \`ask_app\` only when the host has no direct page tools, the requested
capability is not exposed, the task needs the app agent's interpretation or
multi-step specialist reasoning, or a direct call fails and needs recovery.
Dispatch's unified \`/mcp\` endpoint still exposes generic cross-app verbs; a
direct app MCP connection or page WebMCP surface is where named app actions
appear.

The app's MCP \`instructions\` name its key tools (generated from the app's own
list); follow those names verbatim and use \`tool-search\` for anything else —
never guess a tool name.

1. Call \`view-screen\` before any selection-dependent edit and use the ids it
   returns; never guess an id from a title, index, or stale context.
2. If \`view-screen\` returns a \`selection\` and \`nextRequiredAction\`, make
   that call directly with the smallest atomic change; do not regenerate a
   whole artifact for a focused edit.
3. Read the result back with the app's matching read action and report what
   changed. A queued \`ask_app_status\` task is not proof an edit completed.

## Authentication and host behavior

The Dispatch MCP connector identifies the calling agent, while the embedded app
uses the user's browser session. Let the user complete sign-in in the rendered
Agent-Native browser surface. Never request, copy, or store passwords, OAuth
codes, cookies, or access tokens.

The generic Agent-Native plugin registers Dispatch at
\`https://dispatch.agent-native.com/mcp\` for hosts that support plugin MCP
configuration. ChatGPT custom connectors use the same URL with OAuth. After
installing or changing a connector, reload Claude/Cowork/ChatGPT or reconnect
and rescan the MCP server if the new tools or inline surface are not visible.

## Failure handling

- If \`open_app\` succeeds but no inline surface appears, show its returned
  link and say that this host does not expose an embedded browser here.
- After an app loads, check for \`list-host-webmcp-tools\` before delegating. If
  it is available, use the exact returned tool name and origin for direct work.
- If \`ask_app\` cannot reach Slides, check that Slides is granted in
  Dispatch and that the connector is authenticated, then retry once with the
  exact app id \`slides\`.
- If screen state has no deck or selection, describe that state instead of
  fabricating context. Ask the user to open a deck or select an element when
  the requested edit depends on it.
- Treat a successful open link, a queued task, or a tool acknowledgment as
  navigation/task setup only. Confirm a write with the app's readback action.
`;

export const AN_COMMAND_MD = `---
description: Open and operate a granted Agent-Native app through Dispatch MCP.
argument-hint: <app> [request]
---

Use the an skill. Treat the first argument as the Agent-Native Dispatch app id.
For \`/an slides\`, call \`open_app\` with app \`slides\`, path "/", embed
true, and chrome \`full\`. Keep the returned link if the host cannot render
the inline MCP App. Any remaining arguments are the user's request after the
app opens:

$ARGUMENTS
`;
