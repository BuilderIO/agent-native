---
"@agent-native/core": patch
---

Only the organization owner can invite admins: `POST /_agent-native/org/invitations` now refuses an admin's `role: "admin"` invite with a 403, and in the bulk shape lists each such entry under `failed`. A signed-in user with no organization reads `get-infrastructure-status` and sees Organization › Authentication, Apps, Infrastructure, and Audit log only on a single-tenant self-hosted deployment; `/_agent-native/org/me` reports this as `soloDeploymentAdmin`. `fetchProviderModels` now calls the `check-provider-key` action. The Invite members dialog, Email domain auto-join, Shared secret, and Workspace URL rows are localized, and the default scaffold's home page shows the account menu, which holds Log out.
