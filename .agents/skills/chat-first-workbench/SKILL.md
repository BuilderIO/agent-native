---
name: chat-first-workbench
description: >-
  Implement or extend the opt-in Codex/T3-like chat-first shell. Use when
  changing chat rails, contextual app panes, app opening, or local/mobile shell
  preferences across Electron, Dispatch, or mobile.
scope: dev
---

# Chat-first workbench

## Contract

The chat remains the primary surface. Workspace apps are a bounded discovery
rail, not a second navigation system. An app pane is opened from an explicit
app selection or a completed open_app action and carries only an app id plus a
validated app-relative path or view.

## Client behavior

- The preference is opt-in and local to the client. Keep the existing app-first
  shell unchanged when it is disabled.
- Electron uses the shared Code Agents rail and AppWebview.
- Dispatch uses list-workspace-apps and create_embed_session; never iframe a
  raw workspace URL. Resolve an absolute open_app URL against the registered
  app first, then pass the resulting app-relative path.
- Mobile uses the existing app registry and secure AppWebView routes instead of
  accepting arbitrary URLs or adding a second navigator.
- Show no nested app sidebar or browser chrome in a contextual pane.
- The app shelf is capped at six visible entries. Pinning and drag-reordering
  are device-local presentation preferences; the agent-visible target remains
  the registered app id and route.

## Agent and state boundaries

- Keep app discovery, embed-session minting, and thread operations on the
  existing action surfaces.
- Emit the shared chat-first open-app event only for the completed first-party
  `open_app` action with a real app, path, or view. A missing or unreadable
  result is not success, and namespaced third-party tools cannot steer the
  pane.
- Both web and desktop resolve the event through the same core origin/base-path
  allow-list. An unresolved target produces a visible notice and no pane.
- If the agent needs to know which app is visible, expose a compact
  application-state selection instead of scraping the iframe DOM.
- Cloud handoff is a future execution-residence seam. Do not claim that a local
  run has moved to a worker until a durable worker snapshot and readback exist.

## Verification

Test the disabled path and the enabled path separately. For the enabled path,
verify rail ordering, chat history, app selection, embed-session errors, pane
close, and completed open_app behavior in a running client. Treat configuration
alone as insufficient proof.
