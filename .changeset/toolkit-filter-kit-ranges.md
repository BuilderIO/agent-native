---
"@agent-native/toolkit": minor
---

The shared filter kit's date fields get "is between" (a start and an end date, either way round) and read a saved "is not on" rule, which the menu leaves out. A date field with `times: true` also takes values with a time, such as "2026-10-22T09:00": a time without an offset is read in the caller's zone, and a row with only a day is compared by the day the time falls on. An app can pass `nestedGroups` to `FilterBar`, `FilterButton` or `FilterPanel` to let a group hold groups of its own, one level down; links write such a group as `g=1.1:any` and its rules as `r=1.1/…`, so older links still read. New helpers: `filterOperatorsAcceptedFor`, `filterOperatorValueCount`, `filterItemRules`, `findFilterGroup`, `resolveFilterDateBound`, `filterDateInstant` and `filterDateValueHasTime`.
