---
"@agent-native/core": patch
---

The `resources` list action and `resource-list` now page their results, so the agent can reach every entry in large directories such as `skills/`. Text lists show 50 entries per page sorted by path, put the next offset in the header, and end with the exact call for the next page. `limit` (1-100) and `offset` pick the page, and out-of-range values return an error instead of being ignored. The agent tool also pages JSON, as `{ total, offset, limit, hasMore, nextOffset, resources }`. CLI JSON stays one array unless `limit` or `offset` is set.
