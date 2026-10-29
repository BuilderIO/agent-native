---
"@agent-native/core": patch
---

Fix local databases created by an older core missing store schema after upgrading: the agent_runs runtime migration now creates the thread projection columns it indexes, and chat_threads gains a runtime migration that creates the submission inbox columns and index the skipped legacy entries added.
