---
"@agent-native/core": patch
---

Fix a chat crash where the agent transcript could fail to render with
"MessageRepository(performOp/link): A message with the same id already exists in
the parent tree". Thread repositories whose message list contained a repeated id
(from optimistic+echo races, streaming reconnect replays, or multi-tab merges)
were imported into assistant-ui verbatim, and its `MessageRepository` throws on a
duplicate id. The import path now collapses duplicate ids to their most recent
copy before handing the repository to assistant-ui, so the throw can't occur. The
no-duplicate case is an exact no-op, leaving normal threads unchanged.
