---
"@agent-native/core": patch
---

Fix extension/slide content patches ending the agent's turn on the first text
mismatch instead of letting the model retarget. Extension and slide literal
find/replace edits now fall back to whitespace-flexible matching (tolerating
re-indentation and CRLF/LF differences), report the closest-matching lines
when nothing is found, and flag more than one match as ambiguous instead of
silently patching the first one.
