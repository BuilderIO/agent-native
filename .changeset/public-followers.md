---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A shareable resource type can name resources that go public with it and leave public with it, such as a page's sub-pages (`publicFollowers`, which returns the ones that are public or the ones that aren't, as asked). `set-resource-visibility` changes them in the same all-or-nothing call, up to 500 in one call, checks again after its writes for one created meanwhile, and reports `followersChanged`; `list-resource-shares` returns `publicFollowers` to managers, with `publicFollowersMore` past 500, and `ShareButton` shows it through `publicFollowersLabel`.
