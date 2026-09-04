import { getDbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "./feature-flags.js";

export function isMissingOrganizationTableError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const message = String(candidate?.message ?? error);
  if (candidate?.code === "42P01") {
    return /(?:relation\s+)?["'`]?organizations["'`]?(?:\s+does not exist)?/i.test(
      message,
    );
  }
  return /no such table:\s*["'`]?organizations["'`]?|relation\s+["'`]?organizations["'`]?\s+does not exist/i.test(
    message,
  );
}

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
    sql: `SELECT role, federation_removal_pending_at
          FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, normalized],
  });
  const row = rows[0] as any;
  if (!row) return false;

  let organizationRows: any[];
  try {
    organizationRows = (
      await getDbExec().execute({
        sql: `SELECT identity_authority, identity_id
              FROM organizations WHERE id = ? LIMIT 1`,
        args: [orgId],
      })
    ).rows;
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) throw error;
    // Some embedded hosts create org_members for a fixture without enabling
    // the full org module. Preserve the pre-federation local membership path.
    return true;
  }

  // Local organizations have no authority to consult. Keep this path
  // independent of rollout storage so an unrelated org remains available
  // during a federation rollout-store outage.
  const organization = organizationRows[0] as any;
  const linked =
    String(organization?.identity_authority ?? "").trim() ||
    String(organization?.identity_id ?? "").trim();
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
