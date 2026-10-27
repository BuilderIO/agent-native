---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Make the docked agent panel work at narrow widths:

- Below 384px of panel width the chat tabs become one switcher: the current chat's title opens a menu with New chat and every open chat, with a check on the current one and a close button per row. From 384px up, tabs keep a 112px minimum and a 200px maximum, scroll with faded edges, and show an "N more" menu when some are out of view.
- The panel's minimum width is now 320px (`AGENT_SIDEBAR_MIN_WIDTH`), held by the panel itself so a host layout yields space instead of squeezing it. Dragging the resize handle below it holds the panel at 320px.
- The model chip keeps its natural width in narrow composers and shrinks only when the toolbar runs out of room, so short names such as "Haiku 5.5 Medium" no longer truncate at 320 to 383px; the effort stays visible when a long name truncates.
- Home and End on the resize handle jump to the narrowest (320px) and widest panel.
- `AgentToggleButton` starts from the panel's current state, so a panel opened from a link no longer leaves the header toggle showing as closed. Core exports `getAgentSidebarState()` for controls that mount after the panel announced its state.
