---
"@agent-native/core": minor
---

Give chat readers control over how much model reasoning is shown, and make
reasoning collapsible everywhere it appears.

Reasoning inside the "Worked for…" summary used to render as flat prose with no
disclosure of its own, so opening that summary dumped the full chain of thought
between the tool calls with no way to fold it back. It now keeps its own
"Thought for Xs" row, collapsible exactly like the tool calls it sits between,
and renders its markdown instead of showing `**source characters**` — OpenAI
reasoning summaries arrive pre-formatted.

A new browser-local preference picks between three modes, reachable from the
chat panel's ⋮ menu:

- **Expanded** — the previous behaviour: the live cell opens itself.
- **Collapsed** — the new default. The label and its timing stay visible, the
  text is one click away, and a live turn no longer pushes the answer out of
  the viewport.
- **Hidden** — no reasoning cells at all.

Hosts can pin the mode with the `thinkingDisplay` prop on `AgentSidebar`,
`AgentPanel`, `AgentChatSurface`, and `AssistantChat`; when pinned, the in-chat
control is not offered rather than left as a dead menu item. The preference is
presentation only — it never changes what the engine requests or what is
persisted, so switching back reveals the same text on the same turns.
