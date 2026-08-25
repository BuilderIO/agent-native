---
"@agent-native/core": patch
---

Let deployment-provided `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` back signed-in requests on hosted deploys, so Notion OAuth can be started from a hosted app instead of reporting the client as unconfigured.
