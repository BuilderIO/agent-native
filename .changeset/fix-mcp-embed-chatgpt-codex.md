---
"@agent-native/core": patch
---

Fix MCP App embeds never becoming visible in ChatGPT/Codex (stuck on "Loading
app", then the fallback panel). Two shell bugs in the inline-embed render path:

1. `launchEmbed` called `setMessage("Loading app")` before the dedupe check, so
   the constant `openai:set_globals`-driven relaunches wiped the just-mounted
   iframe out of the stage on every cycle — the app rendered and was instantly
   blanked, never reaching its ready handshake. The loading message now only
   shows when no frame is mounted.
2. The `openai:set_globals` handler re-synced unconditionally, and the sync
   itself called `notifyHostHeight()`/`sendHostContext()`, which the host
   reflected back as another `set_globals` — an infinite feedback storm that
   starved the host into its sad-face placeholder. `syncOpenAiBridge` now
   short-circuits when the relevant globals (tool input, open URLs, display
   mode, theme, locale) are unchanged.

Bumps the embed shell version so hosts refetch the fixed shell.
