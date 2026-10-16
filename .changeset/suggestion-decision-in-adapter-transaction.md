---
"@agent-native/core": patch
---

A suggestion adapter's `coordinateDecision` can now run the decision inside its own transaction by passing `{ transaction }` as the second argument to `run`, so the decision commits or rolls back with the adapter's write. A decision that replays an earlier one returns without calling `apply`. An accepted decision now always returns the decided suggestion; it fails loudly if the suggestion disappears.
