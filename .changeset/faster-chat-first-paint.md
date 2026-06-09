---
"@agent-native/core": patch
---

Make the agent sidebar paint faster, especially for a new chat.

- **New chat no longer shows a loading skeleton.** The empty state previously
  rendered a suggestion skeleton that was gated on `suggestionsLoading` — which
  waits on four `application-state` reads (and re-runs every 2s). Suggestions are
  non-essential garnish, so the empty state (icon + composer) now renders
  immediately and suggestion chips appear when ready, instead of holding a
  skeleton on a brand-new chat that has nothing to load.

- **Opening an existing thread clears its skeleton sooner.** Thread restore no
  longer gates first paint on the `reconnectActiveRunForThread()` probe: the
  skeleton clears as soon as the persisted messages are imported, and the
  active-run reconnect (only relevant mid-run, e.g. after a hot reload) runs
  afterward and streams on top of the already-rendered conversation.
