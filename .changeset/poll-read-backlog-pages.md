---
"@agent-native/core": patch
---

An open tab no longer falls behind when the change feed fills with other accounts' events. When a poll comes back at its 1,000-row limit with more changes waiting, the tab reads the next page at once instead of waiting its usual interval, for up to 20 pages in a row while it's visible, and those pages no longer count as idle ones that slow its polling down. A collaborative document's own poll reads a backlog the same way.
