---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Route cross-app reads tool-first: when a known peer publishes a read-only action that fits a bounded read and `describe-workspace-apps` shows its full input, agents call it with `call-agent` action + input instead of starting a full delegated agent run. Natural-language messages remain the path for judgment, generation, every side effect, and any failed or underspecified direct call. `describe-workspace-apps` now shows nested input schemas in full (or says to use a message when they are too large) and marks actions whose schema is not published.
