---
"@agent-native/core": patch
---

Stop treating an unreadable code-agent schedules file as an empty schedule list. A transient read error, a corrupt file, or a partially-written `schedules.json` collapsed to `[]`, and because every create/update/delete rewrites the whole file, the next mutation silently deleted every stored schedule. Only a genuinely absent file initializes as empty now; anything unreadable raises `CodeAgentSchedulesUnreadableError` and mutations refuse to run.
