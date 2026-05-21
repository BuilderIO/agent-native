---
"@agent-native/core": patch
---

Default Agent-Native SSR page responses to public cache headers with short max-age, week-long stale-while-revalidate, and hour-long stale-if-error, without creating sessions for anonymous page hits.
