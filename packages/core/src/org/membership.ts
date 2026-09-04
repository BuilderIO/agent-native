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
    sql: `SELECT m.role, m.federation_removal_pending_at,
                 o.identity_authority, o.identity_id
          FROM org_members m
          INNER JOIN organizations o ON o.id = m.org_id
          WHERE m.org_id = ? AND LOWER(m.email) = ?
            AND m.federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, normalized],
  });
  const row = rows[0] as any;
  if (!row) return false;

  // Local organizations have no authority to consult. Keep this path
  // independent of rollout storage so an unrelated org remains available
  // during a federation rollout-store outage.
  const linked =
    String(row.identity_authority ?? "").trim() ||
    String(row.identity_id ?? "").trim();
  if (!linked) return true;

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
