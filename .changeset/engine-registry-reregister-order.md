---
"@agent-native/core": patch
---

Re-registering an agent engine no longer keeps its previous priority slot.
`Map.set` on an existing key preserves the original insertion position, so an
engine re-registered over an earlier one silently stayed wherever it first
landed. Engine detection walks that map in order, which left a stale entry
ahead of Builder and read a provider key on the path that is supposed to
resolve without touching one.
