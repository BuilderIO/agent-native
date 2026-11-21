---
"@agent-native/toolkit": minor
---

The shared filter kit's date editor builds a relative range, such as "past 14 weeks" or "next 3 months", in the directions the field's `dates` allows. `FilterButton` takes a child button to open the panel with, in place of its own, and an `align` for the panel. `FilterBar` and `FilterButton` take `clearable={false}` to leave out Clear when the app has its own. `FilterNouns.matchCount` and `showCount` are now optional, for apps that pass no counts. The filter bar's chips, its add menu and the filter panel now open as modal popovers: while one is open the rest of the page takes no clicks, so the click that closes it no longer also lands on whatever is underneath.
