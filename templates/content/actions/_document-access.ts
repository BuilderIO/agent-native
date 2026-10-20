import type { DbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  currentAccess,
  getShareableResource,
  resolveAccess,
  type AccessContext,
  type ResolvedAccess,
} from "@agent-native/core/sharing";
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  listContentOrganizationMemberships,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";

export async function accessibleDocumentIds(
  ids: string[],
  authorizedOrgIds?: string[],
  db: ReturnType<typeof getDb> = getDb(),
  transaction?: DbExec,
) {
  if (ids.length === 0) return new Set<string>();
  const userEmail = getRequestUserEmail();
  const accessible = new Set<string>();
  const queryAccessible = async (
    remaining: string[],
    contexts: Array<{ userEmail?: string; orgId?: string }>,
  ) => {
    if (!remaining.length || !contexts.length) return;
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, remaining),
          isNull(schema.documents.trashedAt),
          or(
            ...contexts.map((context) =>
              accessFilter(
                schema.documents,
                schema.documentShares,
                context,
                "viewer",
                { includePublic: true },
              ),
            ),
          ),
        ),
      );
    for (const row of rows) accessible.add(row.id);
  };
  const remaining = () => [...new Set(ids)].filter((id) => !accessible.has(id));
  await queryAccessible(remaining(), [{ userEmail: userEmail ?? undefined }]);
  if (!remaining().length) return accessible;

  const orgIds = authorizedOrgIds ?? [
    ...new Set([
      ...(userEmail
        ? (
            await listContentOrganizationMemberships(userEmail, transaction)
          ).map((membership) => membership.orgId)
        : []),
      ...(!userEmail && getRequestOrgId() ? [getRequestOrgId()!] : []),
    ]),
  ];
  await queryAccessible(
    remaining(),
    orgIds.map((orgId) => ({ userEmail: userEmail ?? undefined, orgId })),
  );
  if (!remaining().length || !userEmail) return accessible;

  const references = await db
    .select({ spaceId: schema.documents.spaceId })
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, remaining()),
        isNull(schema.documents.trashedAt),
      ),
    );
  const spaceIds = [
    ...new Set(
      references
        .map((row) => row.spaceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const spaces = await Promise.all(
    spaceIds.map(async (spaceId) => {
      try {
        return {
          id: spaceId,
          access: await resolveContentSpaceAccess(spaceId, "viewer", { db }),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("Not authorized"))
        ) {
          return null;
        }
        throw error;
      }
    }),
  );
  const grantedSpaces = spaces.filter((space) => space !== null);
  if (grantedSpaces.length) {
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, remaining()),
          isNull(schema.documents.trashedAt),
          or(
            ...grantedSpaces.map(({ id, access }) =>
              and(
                eq(schema.documents.spaceId, id),
                accessFilter(
                  schema.documents,
                  schema.documentShares,
                  {
                    userEmail: access.authority.userEmail,
                    orgId: access.authority.orgId ?? undefined,
                  },
                  "viewer",
                  { includePublic: true },
                ),
              ),
            ),
          ),
        ),
      );
    for (const row of rows) accessible.add(row.id);
  }
  return accessible;
}

/**
 * The grants resolveAccess gives a document unconditionally (ownership,
 * public visibility, or a direct user or active-organization share), as a
 * SQL predicate over already-selected document columns. It only admits: a
 * document it rejects may still be reachable (organization visibility,
 * registration hooks), so the caller must fall back to resolveAccess.
 */
export function directDocumentAccessSql(
  document: { id: SQLWrapper; ownerEmail: SQLWrapper; visibility: SQLWrapper },
  ctx: AccessContext = currentAccess(),
): SQL<boolean> {
  const registration = getShareableResource("document");
  if (!registration || registration.resolveAccessContext) return sql`false`;
  const email = ctx.userEmail?.trim().toLowerCase();
  const grants: SQL[] = [];
  if (email && registration.ownerAccessIgnoresOrg === true) {
    grants.push(sql`lower(${document.ownerEmail}) = ${email}`);
  }
  if (registration.allowPublic !== false) {
    grants.push(sql`${document.visibility} = 'public'`);
  }
  const principals: SQL[] = [];
  if (email) {
    principals.push(
      sql`(${schema.documentShares.principalType} = 'user' and lower(${schema.documentShares.principalId}) = ${email})`,
    );
  }
  if (ctx.orgId) {
    principals.push(
      sql`(${schema.documentShares.principalType} = 'org' and ${schema.documentShares.principalId} = ${ctx.orgId})`,
    );
  }
  if (
    principals.length &&
    registration.requireOrgMemberForUserShares !== true
  ) {
    grants.push(
      sql`exists (select 1 from ${schema.documentShares} where ${schema.documentShares.resourceId} = ${document.id} and (${sql.join(principals, sql` or `)}))`,
    );
  }
  return grants.length
    ? sql<boolean>`(${sql.join(grants, sql` or `)})`
    : sql<boolean>`false`;
}

type DocumentAccessAuthority = {
  authority: {
    userEmail: ReturnType<typeof getRequestUserEmail>;
    orgId: string | null;
  };
};

export async function resolveDocumentAccess(
  id: string,
): Promise<(ResolvedAccess & DocumentAccessAuthority) | null>;
export async function resolveDocumentAccess(
  id: string,
  options: { skipResourceBody: true },
): Promise<({ role: ResolvedAccess["role"] } & DocumentAccessAuthority) | null>;
export async function resolveDocumentAccess(
  id: string,
  options: { skipResourceBody?: boolean } = {},
) {
  const resolve = (ctx?: AccessContext) =>
    options.skipResourceBody
      ? resolveAccess("document", id, ctx, { skipResourceBody: true })
      : resolveAccess("document", id, ctx);
  const current = await resolve();
  if (current) {
    return {
      ...current,
      authority: {
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId() ?? null,
      },
    };
  }
  const [reference] = await getDb()
    .select({ spaceId: schema.documents.spaceId })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  const authority = await contentSpaceAuthority(reference?.spaceId);
  if (!authority) return null;
  const granted = await resolve({
    userEmail: authority.userEmail,
    orgId: authority.orgId ?? undefined,
  });
  if (!granted) return null;
  return { ...granted, authority };
}

/**
 * The authority a space lends its members, or null when there's no space or
 * the caller isn't a member of it.
 */
export async function contentSpaceAuthority(
  spaceId: string | null | undefined,
): Promise<{ userEmail: string; orgId: string | null } | null> {
  if (!spaceId) return null;
  try {
    const { authority } = await resolveContentSpaceAccess(spaceId);
    return { userEmail: authority.userEmail, orgId: authority.orgId ?? null };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("not found") ||
        error.message.includes("Not authorized"))
    ) {
      return null;
    }
    throw error;
  }
}
