---
"@agent-native/toolkit": patch
---

`@agent-native/toolkit/app/filters` exports line edits for a filter list where "and" binds before "or", such as `joinFilterLine`, `moveFilterLine`, `groupFilterLineWith` and `takeFilterLineOut`, and its `FilterFieldPicker`, `FilterOperatorSelect` and `FilterRuleEditor`, so an app can build its own filter menu.
