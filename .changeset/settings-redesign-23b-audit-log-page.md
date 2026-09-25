---
"@agent-native/core": minor
---

Settings gets an Audit log page for organization owners and admins, behind the `settings-redesign` flag. It lists the organization's settings and admin changes newest first, filters by time range and app, shows the Agent as the actor when the agent made the change, marks refused attempts, pages with "Show N more", and opens each event's details. `list-audit-events` accepts `includeApps: true` to also return the app ids with events in the scope.
