---
"@agent-native/toolkit": minor
---

`@agent-native/toolkit/app/filters` exports `FilterMenu`, the Filter menu apps should use: a list of filter lines joined by "and" or "or", with groups two deep, drag to reorder, a bottom sheet on phones and a field's pinned options above the lines. `FilterMenuWords` lists the filters in words for the button's hover. `FilterButton`, `FilterPanel` and `FilterBar` keep working. The toolkit now depends on `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities`.

`FilterField` takes `manyPerRow` for a choice field whose rows can hold several of its options, such as a sharing field, so a second pick from the menu adds its own line instead of widening the first.

A filter with no finished rules is the default whatever its match mode: `isDefaultFilterState` ignores the mode then, and the URL leaves out `match=any` until a rule is finished.
