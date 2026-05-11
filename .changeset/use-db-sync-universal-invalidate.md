---
"@agent-native/core": patch
---

`useDbSync`: invalidate every active React Query on any non-own change event, instead of only the queryKey prefixes a template enumerated plus a hard-coded framework-key list. The agent-native real-time-sync promise is that agent and server mutations show up in the UI without a manual refresh; routing that through per-template `queryKeys` made every new query key a chance to silently miss an update (analytics dashboards were the latest example). React Query only refetches active observers by default, dedupes concurrent invalidations, and respects each query's `staleTime`, so the cost is bounded. The `queryKeys` option is kept in the type signature for backward compatibility but is now ignored — templates can drop their per-key enumeration. `onEvent` and `ignoreSource` keep working unchanged for surgical control.
