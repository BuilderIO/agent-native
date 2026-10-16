---
"@agent-native/core": patch
---

Let agents list organization members and invite people. `list-organization-members` returns members and, for owners and admins, pending invitations. `invite-organization-member` sends one member invitation through the same path as Settings > Members, asks the user to approve every call in chat and over MCP, and cannot grant admin. Invitations sent from settings or by an agent are now recorded in the organization audit log for owners and admins.
