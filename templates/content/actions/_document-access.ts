import type { DbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

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

export async function resolveDocumentAccess(id: string) {
  const current = await resolveAccess("document", id);
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
  if (!reference?.spaceId) return null;
  let spaceAccess;
  try {
    spaceAccess = await resolveContentSpaceAccess(reference.spaceId);
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
  const granted = await resolveAccess("document", id, {
    userEmail: spaceAccess.authority.userEmail,
    orgId: spaceAccess.authority.orgId ?? undefined,
  });
  if (!granted) return null;
  return {
    ...granted,
    authority: {
      userEmail: spaceAccess.authority.userEmail,
      orgId: spaceAccess.authority.orgId ?? null,
    },
  };
}
