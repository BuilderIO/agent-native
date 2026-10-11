---
"@agent-native/core": patch
---

Reuse workspace app access reads (app row, org member row, org domain, and the dispatch registry answer) for the membership cache TTL on each instance, so a warm guarded request no longer re-reads them. Membership and workspace app changes made on the same instance take effect immediately; changes from other instances or the dispatch service take effect within 15 seconds.
