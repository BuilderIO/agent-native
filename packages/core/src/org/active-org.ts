import { warnAgent } from "../agent/action-warnings.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";

type ActiveOrgSetting = { orgId: string | null } | null;

/**
 * Every write to `active-org-id` goes through here, so no call site can move an
 * account between organizations silently. Vault credentials are scoped per
 * organization, so a repoint makes every key synced under the previous org
 * unreadable for that account, and the only symptom is a missing-credential
 * error naming the key. The UI notices (`org.createOrgVaultNotice`,
 * `org.acceptInvitationOrgSwitchNotice`) only reach a human looking at the
 * screen; roster and identity migrations run by an agent reach this setting with
 * no notice anywhere in their path, so the warnings below go to `warnAgent` and
 * surface in the conversation that ordered the repoint.
 *
 * Lives in its own module because `auto-join-domain` and `accept-pending` are
 * imported by `context`, so hosting this in `context` would make the cycle.
 */
export async function setActiveOrgId(
  email: string,
  orgId: string | null,
  reason: string,
): Promise<void> {
  await warnOnCrossOrgRepoint(email, orgId, reason);
  await putUserSetting(email, "active-org-id", { orgId });
}

async function warnOnCrossOrgRepoint(
  email: string,
  nextOrgId: string | null,
  reason: string,
): Promise<void> {
  if (!nextOrgId) return;

  let previousOrgId: string | null;
  try {
    const setting = (await getUserSetting(
      email,
      "active-org-id",
    )) as ActiveOrgSetting;
    previousOrgId = typeof setting?.orgId === "string" ? setting.orgId : null;
  } catch {
    // "Unreadable" is not "had no previous org" — report which one happened, so
    // a silent repoint can never read as a first-time assignment in the log.
    warnAgent({
      severity: "critical",
      code: "org-active-org-previous-unreadable",
      message:
        `Could not read the previous active organization before ` +
        `repointing an account to ${nextOrgId} (${reason}). If that account already ` +
        `belonged to a different organization, every vault credential synced under ` +
        `the old organization is now unreadable for it.`,
    });
    return;
  }

  if (!previousOrgId || previousOrgId === nextOrgId) return;

  warnAgent({
    severity: "critical",
    code: "org-cross-org-repoint",
    message:
      `Repointed an account's active organization from ` +
      `${previousOrgId} to ${nextOrgId} (${reason}). Vault credentials are scoped per ` +
      `organization and are NOT shared between them: every API key synced under ` +
      `${previousOrgId} is now unreadable for this account until it is re-saved in ` +
      `${nextOrgId}. Requests will fail with missing-credential errors that name the ` +
      `key rather than this organization change. If this came from a roster, identity, ` +
      `or user-list migration, put the account back and add its members to the ` +
      `EXISTING organization instead of a new one.`,
  });
}
