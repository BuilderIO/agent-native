import { getDbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "./feature-flags.js";

export function isMissingOrganizationTableError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (
    current &&
    (typeof current === "object" || typeof current === "function") &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const message = String(candidate.message ?? "");
    if (
      /no such table:\s*["'`]?(?:organizations|org_members)["'`]?|relation\s+["'`]?(?:organizations|org_members)["'`]?\s+does not exist/i.test(
        message,
      )
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

async function isOrgMemberWithPolicy(
  orgId: string,
  email: string,
  options: {
    allowMissingOrganizationTable: boolean;
    requireOrganizationRecord: boolean;
  },
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
    if (options.allowMissingOrganizationTable) return true;
    throw error;
  }

  const organization = organizationRows[0] as any;
  if (!organization && options.requireOrganizationRecord) return false;
  const linked =
    String(organization?.identity_authority ?? "").trim() ||
    String(organization?.identity_id ?? "").trim();
  if (!linked) return true;

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

export function isOrgMember(
  orgId: string,
  email: string,
  options: { requireOrganizationMetadata?: boolean } = {},
): Promise<boolean> {
  return isOrgMemberWithPolicy(orgId, email, {
    allowMissingOrganizationTable: !options.requireOrganizationMetadata,
    requireOrganizationRecord: !!options.requireOrganizationMetadata,
  });
}

/**
 * Checks membership for an A2A identity authenticated by an organization
 * secret. Unlike legacy callers, this requires readable organization metadata
 * as well as the membership row before the token subject can become an owner.
 */
export function isOrgMemberForA2A(
  orgId: string,
  email: string,
): Promise<boolean> {
  return isOrgMemberWithPolicy(orgId, email, {
    allowMissingOrganizationTable: false,
    requireOrganizationRecord: true,
  });
}
