---
"@agent-native/toolkit": patch
---

Add independent sections to `ChatHistoryRail` (per-section preview, Show all, paged load-more, loading skeleton, error and empty states), owner and access-basis row details, a per-row `hideActions` flag, and a pure `OwnershipFilter` with `filterByOwnership`. `VisibilityBadge` now takes translated `labels` instead of hardcoded English (omitted labels keep the legacy English text); use the localized `VisibilityBadge` and `OwnershipFilter` from `@agent-native/toolkit/app/sharing`.
