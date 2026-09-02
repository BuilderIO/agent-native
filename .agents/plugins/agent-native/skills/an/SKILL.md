---
name: an
description: >-
  Open and operate Agent-Native workspace apps through Dispatch MCP, with
  inline app surfaces, browser-session authentication, and current screen state.
metadata:
  visibility: exported
---

# Agent-Native Apps

Use `/an <app>` to open an Agent-Native app beside the conversation and keep
the app's live UI and the agent's actions in the same workflow. The first
argument is the Dispatch app id. For example, `/an slides` opens the Slides
editor. After it opens, the user can sign in in that browser surface and ask
for new decks or focused edits in ordinary language.

## Open the app

For a known app, call Dispatch's `open_app` with an inline surface:

```json
{
  "app": "slides",
  "path": "/",
  "embed": true,
  "chrome": "full"
}
```

The MCP App response is the preferred handoff for Claude, Claude Desktop,
Claude Cowork, ChatGPT, ChatGPT desktop, Codex, and other compatible hosts. Keep
the returned open link as the fallback for a host that cannot render MCP Apps
inline. Do not claim that a browser opened unless the host rendered the inline
surface or its browser tool confirmed the returned URL.

If the app name is missing or uncertain, call `list_apps` first and use the
exact granted app id. If the requested app is not listed, explain that it must
be granted in Dispatch's Agents access settings. Do not invent a URL, use a
localhost URL, or route around the Dispatch grant.

## Work in Slides

Dispatch intentionally keeps most app actions behind the app's own agent. For
Slides, call `ask_app` with a clear task after opening the editor. The Slides
agent has the authoritative `view-screen`, `get-deck`, `create-deck`,
`add-slide`, `update-slide`, `patch-deck`, and `navigate` actions.
When direct Slides actions are exposed by the host, use them; otherwise
`ask_app` is the supported MCP bridge to the same action surface.

Every Slides edit request must tell the app agent to:

1. Call `view-screen` before editing when the current deck, slide, layout,
   or selection is relevant.
2. Use the current deck and slide ids returned by screen state. Never guess an
   id from a title, slide number, or stale conversation context.
3. Prefer the smallest atomic action that satisfies the request. Do not
   regenerate a whole deck for a focused visual change.
4. Read the result back with `get-deck` or another relevant read action and
   report what changed.

For a request such as “make this bigger”, send a focused task like:

```
Inspect the current Slides screen first. Use the active selection from
view-screen, including its stable objectId or runtimeSelector and current
style. Increase only the selected element's size with the smallest supported
update-slide or patch-deck operation. Read the edited slide back and report the
result. If there is no active selection, do not guess; ask the user to select
an element or identify it.
```

The app's screen state is the source of truth for what the user has open. It
contains the current deck, slide, editor view, and compact selected-element
metadata without copying the entire browser screen into the prompt. Use
`navigate` for a deliberate slide change and preserve the user's current
selection when the request is a focused edit.

For creation or broad changes, still ask the Slides agent to open or inspect the
current screen, use the existing deck actions, and return the editor surface or
open link for review. If the task runs asynchronously, poll the returned
`ask_app_status` task until it reaches a terminal state; a queued task is
not proof that the edit completed.

## Authentication and host behavior

The Dispatch MCP connector identifies the calling agent, while the embedded app
uses the user's browser session. Let the user complete sign-in in the rendered
Agent-Native browser surface. Never request, copy, or store passwords, OAuth
codes, cookies, or access tokens.

The generic Agent-Native plugin registers Dispatch at
`https://dispatch.agent-native.com/mcp` for hosts that support plugin MCP
configuration. ChatGPT custom connectors use the same URL with OAuth. After
installing or changing a connector, reload Claude/Cowork/ChatGPT or reconnect
and rescan the MCP server if the new tools or inline surface are not visible.

## Failure handling

- If `open_app` succeeds but no inline surface appears, show its returned
  link and say that this host does not expose an embedded browser here.
- If `ask_app` cannot reach Slides, check that Slides is granted in
  Dispatch and that the connector is authenticated, then retry once with the
  exact app id `slides`.
- If screen state has no deck or selection, describe that state instead of
  fabricating context. Ask the user to open a deck or select an element when
  the requested edit depends on it.
- Treat a successful open link, a queued task, or a tool acknowledgment as
  navigation/task setup only. Confirm a write with the app's readback action.
