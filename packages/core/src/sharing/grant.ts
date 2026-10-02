import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";

import { fail } from "../action.js";
import { getDbExec, getScopedDbExec } from "../db/client.js";
import type { ExtensionChangeTarget } from "../extensions/change-marker.js";
import { isOrgMember } from "../org/membership.js";
import { invalidateCollabAccessCache } from "../server/poll.js";
import { getRequestUserEmail } from "../server/request-context.js";
import { assertWorkspaceUserGroupIds } from "../workspace-connections/groups.js";
import { assertAccess, ForbiddenError } from "./access.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./actions/extension-change.js";
import {
  requireShareableResource,
  type ShareableResourceRegistration,
} from "./registry.js";
import { ROLE_RANK, type PrincipalType, type ShareRole } from "./schema.js";

export function normalizePrincipalId(
  principalType: PrincipalType,
  principalId: string,
): string {
  return principalType === "user"
    ? principalId.trim().toLowerCase()
    : principalId;
}

export function isEmailPrincipalId(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

export function principalIdMatches(
  sharesTable: any,
  principalType: PrincipalType,
  principalId: string,
): SQL {
  return principalType === "user"
    ? sql`lower(${sharesTable.principalId}) = ${principalId}`
    : eq(sharesTable.principalId, principalId);
}

export async function isOrgMemberOrInvited(
  orgId: string,
  email: string,
): Promise<boolean> {
  const lower = email.trim().toLowerCase();
  if (!lower || !orgId) return false;
  const client = getDbExec();
  if (await isOrgMember(orgId, lower)) return true;
  const invited = await client.execute({
    sql: `SELECT 1 FROM org_invitations WHERE org_id = ? AND LOWER(email) = ? AND status = 'pending' LIMIT 1`,
    args: [orgId, lower],
  });
  return invited.rows.length > 0;
}

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

// Inside a transaction (see `withDbExec`), share rows are written through the
// transaction's handle so they commit or roll back with everything else.
function sharesDb(reg: ShareableResourceRegistration): any {
  const transaction = getScopedDbExec();
  if (!transaction) return reg.getDb();
  return drizzleProxy(async (query, params) => {
    const result = await transaction.execute({ sql: query, args: params });
    return { rows: result.rows.map((row) => Object.values(row)) };
  });
}

export interface GrantResourceAccessInput {
  resourceType: string;
  resourceId: string;
  principalType: PrincipalType;
  principalId: string;
  role: ShareRole;
  /**
   * Keep a stronger role the principal already holds instead of replacing it.
   * Share replaces roles in both directions; approving a request only raises.
   */
  keepStrongerRole?: boolean;
}

export interface GrantResourceAccessResult {
  /** The principal's share row. */
  id: string;
  /** A new share row was inserted. */
  created: boolean;
  /** An existing share row's role changed. */
  updated: boolean;
  /** The role the share row holds now. */
  role: ShareRole;
  principalId: string;
  /** The resource as the actor's admin access check loaded it. */
  resource: any;
  /** Pass to {@link announceResourceAccessChange} once the grant commits. */
  extensionTargetsBefore: ExtensionChangeTarget[];
}

/**
 * Gives a principal a role on a resource, as the signed-in actor. The actor
 * needs admin on the resource, and every sharing rule applies: group support,
 * organization-only sharing, and the principal's form. Share and approving an
 * access request both grant through here, so neither can skip a rule.
 *
 * It only writes the share row. Call {@link announceResourceAccessChange}
 * afterwards, outside any transaction, so open sessions see the change.
 */
export async function grantResourceAccess(
  input: GrantResourceAccessInput,
): Promise<GrantResourceAccessResult> {
  const reg = requireShareableResource(input.resourceType);
  const access = await assertAccess(
    input.resourceType,
    input.resourceId,
    "admin",
  );
  const actor = getRequestUserEmail();
  if (!actor) throw new ForbiddenError("Not signed in");
  const principalId = normalizePrincipalId(
    input.principalType,
    input.principalId,
  );
  if (input.principalType === "group" && reg.supportsGroupShares !== true) {
    throw new ForbiddenError(
      `${reg.displayName} does not support organization groups yet.`,
    );
  }
  if (input.principalType === "user" && !isEmailPrincipalId(principalId)) {
    fail("User shares must use an email address, not an internal user id.", {
      errorCode: "invalid_user_share_principal",
    });
  }
  if (input.principalType === "group") {
    const resourceOrgId = access.resource?.orgId as string | undefined | null;
    if (!resourceOrgId) {
      throw new ForbiddenError(
        `${reg.displayName} can only be shared with a group from within an organization.`,
      );
    }
    try {
      await assertWorkspaceUserGroupIds([principalId], resourceOrgId);
    } catch {
      throw new ForbiddenError(
        `${reg.displayName} can only be shared with a group from its own organization.`,
      );
    }
  }
  const extensionTargetsBefore = await getExtensionShareChangeTargets(
    input.resourceType,
    input.resourceId,
  );

  if (reg.requireOrgMemberForUserShares) {
    const resourceOrgId = access.resource?.orgId as string | undefined | null;
    if (!resourceOrgId) {
      throw new ForbiddenError(
        `${reg.displayName} can only be shared from within an organization. Create or join an organization first.`,
      );
    }
    if (input.principalType === "user") {
      const ok = await isOrgMemberOrInvited(resourceOrgId, principalId);
      if (!ok) {
        throw new ForbiddenError(
          `${principalId} is not in your organization. Invite them to the organization first, then share.`,
        );
      }
    } else if (input.principalType === "org") {
      if (principalId !== resourceOrgId) {
        throw new ForbiddenError(
          `${reg.displayName} can only be shared with its own organization, not a different one.`,
        );
      }
    }
  }

  const db = sharesDb(reg);
  const findExisting = async () => {
    const [row] = await db
      .select({ id: reg.sharesTable.id, role: reg.sharesTable.role })
      .from(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, input.resourceId),
          eq(reg.sharesTable.principalType, input.principalType),
          principalIdMatches(reg.sharesTable, input.principalType, principalId),
        ),
      );
    return row as { id: string; role: ShareRole } | undefined;
  };
  const setRole = async (existing: { id: string; role: ShareRole }) => {
    const keep =
      input.keepStrongerRole === true &&
      ROLE_RANK[existing.role] >= ROLE_RANK[input.role];
    if (keep) {
      return { id: existing.id, updated: false, role: existing.role };
    }
    const [updated] = await db
      .update(reg.sharesTable)
      .set({ role: input.role })
      .where(
        and(
          eq(reg.sharesTable.id, existing.id),
          ne(reg.sharesTable.role, input.role),
        ),
      )
      .returning({ id: reg.sharesTable.id });
    return { id: existing.id, updated: Boolean(updated), role: input.role };
  };
  const result = {
    principalId,
    resource: access.resource,
    extensionTargetsBefore,
  };

  const existing = await findExisting();
  if (existing) {
    return { ...result, ...(await setRole(existing)), created: false };
  }

  const id = nanoid();
  const [inserted] = await db
    .insert(reg.sharesTable)
    .values({
      id,
      resourceId: input.resourceId,
      principalType: input.principalType,
      principalId,
      role: input.role,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: reg.sharesTable.id });
  if (inserted) {
    return { ...result, id, created: true, updated: false, role: input.role };
  }
  const existingAfterConflict = await findExisting();
  if (!existingAfterConflict) {
    throw new Error("Share conflict could not be resolved.");
  }
  return {
    ...result,
    ...(await setRole(existingAfterConflict)),
    created: false,
  };
}

/**
 * Tells open sessions that a resource's sharing changed, after the grant that
 * changed it has committed.
 */
export async function announceResourceAccessChange(
  resourceType: string,
  resourceId: string,
  extensionTargetsBefore: ExtensionChangeTarget[],
): Promise<void> {
  invalidateCollabAccessCache(resourceType, resourceId);
  await notifyExtensionShareChanged(
    resourceType,
    resourceId,
    extensionTargetsBefore,
  );
}
