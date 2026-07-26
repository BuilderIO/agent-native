---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Write NUL group-key delimiters as `\u0000` escapes instead of raw NUL bytes so
these files stay searchable. Ripgrep's binary-content heuristic treats any file
containing a `\0` byte as binary and prints only a `binary file matches` notice
with no lines, so `poll.ts`, `app-skill.ts`, `session-replay.ts`, and
`app-creation-store.ts` were invisible to every ripgrep-backed search — agents
and humans grepping them for a symbol got zero results and concluded it did not
exist. The escape sequence is the same character at runtime; only the on-disk
byte the heuristic keys on changes, so there is no behavior change.
