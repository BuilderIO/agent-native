// guard:allow-unscoped — static skill prose uses “create/update tools”; it contains no database query
export const AN_SKILL_MD = `---
name: an
description: >-
  Create and edit decks, docs, designs, email, calendar events, forms,
  dashboards and screen recordings in Agent-Native apps through one Dispatch
  connection. Use when the user asks for any of these, names an Agent-Native
  app or /an, or needs to sign in or reconnect.
metadata:
  visibility: exported
---

# Agent-Native Apps

Open an Agent-Native app beside the conversation and keep the app's live UI
and the agent's actions in the same workflow. The user can ask in plain words,
such as "make a five-slide deck about our Q4 launch", without naming an app or
typing \`/an\`. When they do use \`/an <app>\`, the first argument is the Dispatch
app id: \`/an slides\` opens the Slides editor.

## Pick the app

Use the app the user names. Otherwise call \`list_apps\` and pick the granted app
whose name fits the request, and whose description fits too when the result
shows one. Use its exact id. When a request fits more than one app or none, ask
one short question rather than guessing.

If the app you need is not listed and \`degradedSources\` is not empty, call
\`list_apps\` once more. If it is still missing, say which reasons could apply:
Dispatch could not check every app (only when \`degradedSources\` is not empty),
the app needs a grant in Dispatch's Agents access settings, or the organization
hides Agent-Native's hosted apps. Do not invent a URL, use a localhost URL, or
route around the Dispatch grant.

## Open the app

Call Dispatch's \`open_app\` with an inline surface:

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

## Keep the open app in step with the chat

Claude opens an embedded app in its side panel. The panel is one live app: an
edit made through a tool shows there, and an edit the user makes by hand is in
the app's data the next time you read it.

- To change what the open panel shows (filter a list, open a record, switch a
  week), call the view tools \`read_view\` and \`navigate_view\` on the open app
  instead of calling \`open_app\` again. Each new \`open_app\` call opens a new
  view and replaces the panel.
- Before acting on "this", "it" or "the one I opened", call \`read_view\`;
  the user may have clicked or typed in the panel since your last turn.
- Draft and edit with the app's own actions (create or update a draft, an
  event, a task), then read it back. Send, delete or move only when the user
  asks.

## First run and sign-in

The Dispatch MCP connector identifies the calling agent, while the embedded app
uses the user's browser session. On a user's first request, tell them what to
expect:

- One authorization covers every app. The host asks them once to authorize the
  Agent-Native connector; after that, every app granted to them works with no
  new authorization in the host.
- Each app's inline view signs in on its own the first time it opens. When its
  sign-in page offers **Continue with Agent-Native**, that uses their Dispatch
  account instead of a new password. Without an active Dispatch session,
  Dispatch asks them to sign in there first.

Let the user complete sign-in in the rendered Agent-Native browser surface.
Never request, copy, or store passwords, OAuth codes, cookies, or access tokens.

The generic Agent-Native plugin registers Dispatch at
\`https://dispatch.agent-native.com/mcp\` for hosts that support plugin MCP
configuration. ChatGPT custom connectors use the same URL with OAuth. After
installing or changing a connector, reload Claude/Cowork/ChatGPT or reconnect
and rescan the MCP server if the new tools or inline surface are not visible.

## Reconnect a dropped connection

Authorization normally persists. If Dispatch tools that worked before return
401 or an authorization error, or disappear, give the user the one reconnect
step for their host:

- Claude Code: run \`/mcp\` and choose **Authenticate** or **Reconnect** for the
  \`agent-native-dispatch\` connector.
- Codex, Cursor and other local clients: run
  \`npx @agent-native/core@latest reconnect https://dispatch.agent-native.com\`,
  then reload the client. Codex needs a new session before the tools return. If
  it reports no existing entry, as it can for a plugin install, authenticate the
  connector from the client's own MCP settings.
- Claude, Claude Desktop, Cowork and ChatGPT: reconnect the Agent-Native
  connector in the host's connector settings, then rescan its tools.

Reconnecting refreshes only the authorization and keeps the installed skill, so
never reinstall the skill or plugin to fix a 401.

## Failure handling

- If \`open_app\` succeeds but no inline surface appears, show its returned
  link and say that this host does not expose an embedded browser here.
- After an app loads, check for \`list-host-webmcp-tools\` before delegating. If
  it is available, use the exact returned tool name and origin for direct work.
- If \`ask_app\` cannot reach an app, check that it is granted in Dispatch and
  that the connector is authenticated, then retry once with the exact app id
  from \`list_apps\`.
- If screen state has no open item or selection, describe that state instead
  of fabricating context. Ask the user to open one or select an element when
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
