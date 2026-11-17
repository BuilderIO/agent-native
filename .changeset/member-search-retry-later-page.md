---
"@agent-native/core": patch
---

Two fixes for loading more people in `useShareOrgMemberSearch`. When a later page fails to load, the hook keeps the people already found and its place in the list, so `loadMore` tries that page again; before, the failure dropped the place, and the people after it couldn't be reached without changing the search. And when the search changes while a later page is still loading, the new search can load more; before, the old page's loading flag stayed on and blocked it.
