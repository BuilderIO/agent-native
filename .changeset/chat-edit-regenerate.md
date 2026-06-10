---
"@agent-native/core": minor
---

Add edit, regenerate, and branch picker affordances to the chat UI.

- **Edit user messages**: hover the pencil icon on any user message (when not running) to enter inline edit mode; the bubble swaps to a textarea composer with Cancel/Save buttons. Sending an edited message creates a new branch via assistant-ui's edit composer semantics. Edit is disabled while a run is active to avoid race conditions with the abort+wait path.
- **Regenerate last assistant message**: a refresh icon appears on the last assistant message's action bar on hover, using `ActionBarPrimitive.Reload`. Disabled automatically while the thread is running. Regenerate creates a client-side branch from the parent user message and sends the prior history to the server as a fresh run; the server appends the new response as a new `thread_data` entry (consistent with the append-only fold — no duplicate or conflict).
- **Branch picker**: when a message has multiple branches (after edits or regenerations), `BranchPickerPrimitive` shows ‹ 1/2 › navigation on that message, styled to match the existing ghost action-bar buttons. Shown on both user and assistant messages.
