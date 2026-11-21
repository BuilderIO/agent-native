---
"@agent-native/toolkit": minor
---

Add a shared filter kit at `@agent-native/toolkit/app/filters`. Apps describe their fields once and get a chip bar (`FilterBar`), a rule panel with all/any matching and groups (`FilterButton`, which opens as a bottom sheet on phones), saved views (`FilterViewsControl`), and URL state with history (`useFilterUrlState`). Value pickers only offer values that exist, person fields offer "Nobody", dates offer relative presets plus an exact date, and pinned fields (such as where an item came from) can hide some rows by default, with `countFilter` reporting how many they hide so the app can say so. The pure model in `@agent-native/toolkit/app/filters/model` matches and counts rows on the server too. Copy is translated into all 11 toolkit languages.
