# Dispatch chat-first workbench

## Direction

Dispatch's opt-in mode is a sparse control plane for conversations: New chat,
Integrations, and Scheduled sit above a compact six-app workspace shelf, with
the existing chat history beneath it. Selecting an app opens an authenticated,
chrome-less contextual iframe beside the chat.

## Layout contract

- The default Dispatch navigation and all non-chat routes stay unchanged.
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
