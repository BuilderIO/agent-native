---
"@agent-native/core": patch
---

Count a Builder.io sign-in as connected in the agent's `connect-builder` and `activate-browser` tools. Both tools used to look only for a legacy `bpk-` private key, so a connection made through Builder sign-in (which stores only an OAuth grant) showed a "Connect Builder" card even though Settings showed Builder as connected. An expired sign-in still counts as disconnected and never falls back to a deploy-level key.
