---
"@agent-native/core": patch
---

Fix four chat streaming UX issues: (1) P0 race where plain Enter while a run was active caused the new message to never be sent (appended to assistant-ui while the server run was still alive, resulting in a 409 → reconnect to old run under the new prompt); now aborts the active run first and waits for it to clear before appending. (2) P2 tool results for parallel same-name tool calls could get swapped; now matches by server-assigned id when present, with name-matching fallback. (3) P2 resuming affordance: show "Resuming…" in the thinking indicator during the 250 ms continuation window between serverless chunks, and show the last live activity label instead of bare "Thinking". (4) P1 backgrounded-tab catch-up lag: when the tab returns from background with a large streaming backlog (> 2000 graphemes), jump the reveal cursor to near the tail so only the last ~200 graphemes animate in rather than replaying minutes of content.
