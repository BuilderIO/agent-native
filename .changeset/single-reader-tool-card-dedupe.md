---
"@agent-native/core": patch
---

Fix duplicate tool-call cards and parallel duplicate text streaming in agent chat: the reconnect reader and the adapter's own stream can no longer attach to the same run concurrently (single-reader ownership — reconnect probes skip while the adapter runtime is live, and an adapter takeover aborts any active reconnect reader and discards its accumulator), journal/ledger-replayed tool results now merge into the original card instead of rendering a second stuck-spinner copy, and reconnect content drops pending tool cards whose call already completed in the rendered messages.
