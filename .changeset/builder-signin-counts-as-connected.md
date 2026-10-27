---
"@agent-native/core": patch
---

Count a Builder.io sign-in as connected in the agent's `connect-builder` and `activate-browser` tools. Both tools used to look only for a legacy `bpk-` private key, so a connection made through Builder sign-in (which stores only an OAuth grant) showed a "Connect Builder" card even though Settings showed Builder as connected. An expired sign-in never falls back to a deploy-level key: `connect-builder` shows it as disconnected, and `activate-browser` asks the user to re-authorize Builder.io in Settings, as it does for a sign-in that lacks the browser scope.
