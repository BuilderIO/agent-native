---
"@agent-native/core": patch
---

Add a shared, presentational `ChatHistoryList` component (`@agent-native/core/client`) for rendering chat/run history lists with optional grouped sections, active-item highlight, search box, loading/empty/error states, and optional pin/rename/delete row actions. Core's `HistoryPopover` now renders through it instead of bespoke row markup, with no behavior change.
