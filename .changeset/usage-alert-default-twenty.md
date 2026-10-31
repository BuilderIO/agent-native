---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Lower the default usage alert from $100 a day to $20 a month, and move defaults still at $100 a day to the new limit. `USAGE_ALERT_DEFAULT_MONTHLY_USD` replaces `USAGE_ALERT_DEFAULT_DAILY_USD`, which stays as a deprecated alias.
