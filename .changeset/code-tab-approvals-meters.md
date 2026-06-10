---
"@agent-native/core": minor
---

Code tab improvements: always-allow and deny buttons in the approval callout (model auto-resumes after both); persist command allowlist per-machine so approved commands skip future approvals; emit thinking-delta events from the agent loop as collapsible transcript cells; surface cumulative input/output token counts and approximate context-window usage per run; Electron notifications for run-completed, run-failed, and approval-needed when the window is unfocused (with dock badge on macOS); byte-offset transcript tailing in the main process so only appended JSONL bytes are read on each file-watch event instead of re-reading the whole file.
