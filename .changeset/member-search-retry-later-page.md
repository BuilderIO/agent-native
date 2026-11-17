---
"@agent-native/core": patch
---

When a later page of `useShareOrgMemberSearch` results fails to load, the hook keeps the people already found and its place in the list, so `loadMore` tries that page again. Before, the failure dropped the place, and the people after it couldn't be reached without changing the search.
