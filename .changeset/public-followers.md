---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A shareable resource type can name resources that go public with it and leave public with it, such as a page's sub-pages (`publicFollowers`). `set-resource-visibility` changes them in the same all-or-nothing call and reports `followersChanged`; `list-resource-shares` returns `publicFollowers` to managers, and `ShareButton` shows it through `publicFollowersLabel`.
