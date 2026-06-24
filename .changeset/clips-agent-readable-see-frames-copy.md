---
"@agent-native/core": patch
---

Clarify the Clips "agent-readable clips" docs so the "see and hear" promise is
accurate: frame-viewing works in any image-capable agent (ChatGPT, Claude Code,
Cursor, Codex, MCP-connected agents), while text-only web chats fall back to the
transcript and can take an uploaded frame. Verified empirically — ChatGPT fetches
the JPEG frame URLs and describes the screen; claude.ai's web chat reads the
transcript only. Docs-only copy change; the agent-context/frame APIs are
unchanged.
