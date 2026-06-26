---
"@agent-native/core": patch
---

Make the background-worker's post-`model_done` milestone diagnostics
(`env_config`, `context_all`, `action_tool_setup`, `owner_thread`, `prestart`)
AWAITED writes instead of fire-and-forget. A blocked event loop can't flush
fire-and-forget async writes, so they never landed once the worker froze; an
awaited write lands while the loop is still running, so the last milestone
visible in `/runs/active` pinpoints exactly where the worker freezes.
