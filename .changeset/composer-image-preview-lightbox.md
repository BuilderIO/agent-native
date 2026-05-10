---
"@agent-native/core": patch
---

Two small UI primitives:

- Prompt composer: click an attached image to open a fullscreen preview (Esc / click-outside to close). The thumbnail's X button still removes.
- Agent sidebar: new `window.dispatchEvent(new Event("agent-panel:close"))` event mirrors the existing `agent-panel:open` so apps can collapse the sidebar programmatically (used by the design template's Edit mode to free up canvas space).
