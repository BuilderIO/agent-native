---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Route cross-app reads tool-first: when a known peer publishes a read-only action that fits a bounded read, agents look it up with `describe-workspace-apps` and call it with `call-agent` action + input instead of starting a full delegated agent run. Natural-language messages remain the path for judgment, generation, and every side effect.
