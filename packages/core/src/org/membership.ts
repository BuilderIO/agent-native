import { getDbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "./feature-flags.js";

/**
 * One resolver for "is this email in this org". Two private copies of this
 * query already existed; a third would be the one that drifts.
 */
export async function isOrgMember(
  orgId: string,
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!orgId || !normalized) return false;
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, normalized],
  });
  if (rows.length === 0) return false;

  // A linked org's local row is a cache of the authority roster. Keep the
  // legacy local-only path unchanged while the federation rollout is off.
  if (
    !(await evaluateFeatureFlagStrict(CROSS_APP_ORG_FEDERATION_FLAG.key, {
      userEmail: normalized,
      userKey: normalized,
      orgId,
    }))
  ) {
    return true;
  }

  const { validateFederatedOrganizationMembershipForCurrentRequest } =
    await import("./federation.js");
  const validation =
    await validateFederatedOrganizationMembershipForCurrentRequest({
      orgId,
      email: normalized,
    });
  return validation.active;
}
