---
"@agent-native/core": patch
---

Every `active-org-id` write now goes through `setActiveOrgId(email, orgId, reason)`,
which logs a loud warning when it moves an account from one organization to
another.

Vault credentials are scoped per organization, so repointing an account orphans
every key synced under the previous org — and the only symptom is a
missing-credential error naming the key, which sends everyone looking for a
deployment or env-var problem. The existing notices
(`org.createOrgVaultNotice`, `org.acceptInvitationOrgSwitchNotice`) only reach a
human looking at the screen, and `createOrganization()` only warned about the
account that created the org. A roster or identity migration run by an agent
repointed members through `putUserSetting` directly, with nothing anywhere in
its path saying an org boundary had moved.

The warning names both organizations, the reason for the write, and the
orphaned-credential consequence. An unreadable previous org is reported
distinctly from an absent one, so a silent repoint cannot look like a
first-time assignment in the log.
