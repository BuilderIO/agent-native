---
"@agent-native/core": minor
---

Support administered workspaces with invite-only signup, bootstrap administrators,
organization-scoped provider keys, optional SSO and SCIM provisioning, and
admin-managed access policy configuration.

The access policy is configured through `AUTH_SIGNUP`, `ORG_CREATION`,
`AUTO_CREATE_DEFAULT_ORG`, and the comma-separated `AUTH_BOOTSTRAP_ADMINS`
environment variables. These values are now schema-validated at startup;
unrecognized boolean values fail fast instead of being treated as `true`.
`AUTH_SSO` and `AUTH_SCIM` opt into the Better Auth 1.7.4 SSO/SCIM adapters.
The per-app `agent-native identity rekey --from --to` command provides the
supported email migration path and revokes active sessions after a successful
transaction.
