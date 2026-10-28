---
"@agent-native/core": patch
---

The Factory feedback sweep now treats issues from its error sources (such as Sentry and Analytics) like Slack reports, needs a real reproduction attempt before marking a report as needing a person, opens its PR only after every claimed report has been tried, and re-reads every thread it owns so a newer reply after its 🎫 isn't missed.
