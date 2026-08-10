# Desktop chat-first workbench

## Direction

The opt-in desktop mode is a quiet command center: a narrow, persistent
conversation rail, a generous chat canvas, and a contextual app pane that
appears only when the user or agent asks for one. It borrows the information
architecture of Codex and T3 Code while keeping Agent-Native's existing
surface, typography, iconography, and app URLs.

## Layout contract

- The shared Code Agents rail owns New chat, search, subscriptions, computer
  access, pinned/recent chat history, and the composer.
- Desktop adds Integrations and Scheduled as first-party rail actions and
  shows at most six workspace apps above Chats.
- App panes use the existing Electron AppWebview and have a small title row,
  no address bar, and no nested app/sidebar chrome.
- Chat rows expose a right-click menu for copying the stable session ID and
  opening a live watch/message panel backed by the existing run-manager host.
- The tabbed side-surface shell currently ships app, browser, and watched-session
  surfaces. Terminal, files, diff, and live-agent panes stay explicit deferred
  cards until their platform-specific data boundaries are connected.
- The mode is opt-in and persisted in frame settings; the existing app-first
  shell remains the default.

## Future boundary

Cloud handoff should move the same thread/run descriptor to a worker
residence, not create a second conversation. This mode only establishes the
local contextual-pane seam; computer use remains local until that worker
contract is implemented.
