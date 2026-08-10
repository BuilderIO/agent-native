# Dispatch chat-first workbench

## Direction

Dispatch's opt-in mode is a sparse control plane for conversations: New chat,
Integrations, and Scheduled sit above a compact six-app workspace shelf, with
the existing chat history beneath it. Selecting an app opens an authenticated,
chrome-less contextual iframe beside the chat.

## Layout contract

- The default Dispatch navigation keeps Overview, Chat, and Apps as its stable
  wayfinding destinations; workspace app names remain in the Apps destination.
- App discovery comes from list-workspace-apps; rendering always mints
  create_embed_session instead of loading a registry URL directly.
- Agent-native app frames intentionally keep scripts, storage, and same-origin
  behavior; the server-minted embed ticket and registered app origin are the
  security boundary. Regular browser frames are visibly chrome-bearing and
  accept only HTTP(S) URLs, rather than masquerading as app panes.
- The app iframe deliberately does not use a restrictive `sandbox` or broad
  `allow` list: first-party agent-native apps need their scripts, storage, and
  registered permissions. This is safe only because the server-minted ticket
  validates the named app and app-relative path; arbitrary browser URLs use the
  separate chrome-bearing browser pane.
- The open_app action can focus a pane through the shared browser event
  contract, while the agent remains the main chat surface.
- Chat rows expose the same right-click copy-session-ID affordance. Watch and
  message opens a second, route-owned AgentChatSurface beside the main chat,
  using the same core thread transport as the primary surface. The Electron
  renderer uses its run-manager transcript host for code-agent sessions; the
  shared target/state contract keeps the interaction parity without sharing
  platform-specific rendering code.
- The side-surface tab model ships app, browser, and watched-session tabs. The
  empty catalog names terminal, files, diff, and agent activity as deliberate
  deferred surfaces with platform/data-boundary reasons rather than pretending
  those panes are interactive already.
- The shell preference is local to the current browser profile and defaults
  off.

## Future boundary

Keep the pane request app/path/url based so a future cloud worker can resume
the same thread and contextual view. This change does not claim background
execution, phone handoff, hosting, or computer-use portability.

## Thread Debug audit plane

Thread Debug is an operate-mode incident desk for people diagnosing agent runs
under pressure. Its visual world is a restrained graphite-and-signal console:
semantic status colors carry meaning, while the surrounding surface stays quiet
and dense enough for repeated use. The first viewport answers one question -
what failure pattern needs attention - then lets the operator open one run for
its diagnosis, timeline, conversation, and raw evidence. The list is a compact
scan surface; the selected run is the workbench. Technical payloads, event
streams, and access metadata remain progressively disclosed instead of competing
with the immediate recovery path. Avoid equal-weight cards, repeated raw JSON,
internal error codes as primary copy, and dashboards that make every run look
equally urgent.

## Dispatch shell sidebar

The default shell is an operate-mode wayfinding rail, not an app directory. Keep
the first viewport to the three destinations people use to orient themselves -
Overview, Chat, and Apps - plus quiet account and management access at the
bottom. Workspace apps belong in the Apps destination; they must not be repeated
as a long label list beside the global navigation. The chat-first route may show
a compact pinned-app shelf because app switching is part of that workflow, with
the rest behind its existing disclosure. Prefer a short, stable rail over a
context dump that competes with the page the user opened.
