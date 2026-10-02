---
"@agent-native/core": patch
---

Fail an automatic chat continuation with a retryable error when the server cannot read the stopped turn's history or run journal, or finds the thread missing, empty, or without the stopped turn's prompt, instead of continuing from the browser's copy, which lacks finished tool results and could repeat them. Resumed continuations now send a bounded window of earlier turns while keeping the stopped turn's tool calls and results whole.
