---
"@agent-native/core": minor
---

Add structured tool cells for the Code tab: bash terminal view with exit code / duration badges, edit diff viewer (computed client-side from old/new text), write cell with new-file styling, and an end-of-turn files-changed summary. Raise the bash output retention window to first 4 KB + last 16 KB. Emit structured metadata (command, cwd, exitCode, durationMs, oldText/newText, lineCount) from the coding-tools executor as a side-channel so the UI can render bespoke cells without breaking the string-result contract the agent sees.
