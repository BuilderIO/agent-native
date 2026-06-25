---
"@agent-native/core": patch
---

MCP Apps: render inline embeds in a nested child iframe instead of transplanting
the app document on hosts where transplant breaks. Transplant boots the app via
cross-origin dynamic `import()` inside the host's opaque-origin sandbox, which
strict hosts block (blank "Loading app").

- `ui/*` bridge hosts (Cursor, Codex) now render in a nested child iframe.
- ChatGPT now uses its controlled nested frame: `isChatGptSandboxHost` was
  removed from `shouldTransplantAppDocument`, which had forced ChatGPT to
  transplant and hang blank.

Claude keeps the transplant path; `embedMode: "transplant"` still forces it.
