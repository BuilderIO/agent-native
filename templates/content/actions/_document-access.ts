import type { DbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
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
) {
  if (ids.length === 0) return new Set<string>();
  const userEmail = getRequestUserEmail();
  const orgIds = authorizedOrgIds ?? [
    ...new Set([
      ...(userEmail
        ? (await listContentOrganizationMemberships(userEmail)).map(
            (membership) => membership.orgId,
          )
        : []),
      ...(!userEmail && getRequestOrgId() ? [getRequestOrgId()!] : []),
    ]),
  ];
  const contexts = [
    { userEmail: userEmail ?? undefined },
    ...orgIds.map((orgId) => ({ userEmail: userEmail ?? undefined, orgId })),
  ];
  const rows = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, [...new Set(ids)]),
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
  return new Set(rows.map((row) => row.id));
}

export async function resolveDocumentAccess(
  id: string,
  transaction?: DbExec,
  db: ReturnType<typeof getDb> = getDb(),
) {
  const context = transaction ? { ...currentAccess(), transaction } : undefined;
  const current = await resolveAccess("document", id, context);
  if (current) {
    return {
      ...current,
      authority: {
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId() ?? null,
      },
    };
  }
  const [reference] = await db
    .select({ spaceId: schema.documents.spaceId })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!reference?.spaceId) return null;
  let spaceAccess;
  try {
    spaceAccess = await resolveContentSpaceAccess(reference.spaceId, "viewer", {
      db,
    });
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
    ...currentAccess(),
    userEmail: spaceAccess.authority.userEmail,
    orgId: spaceAccess.authority.orgId ?? undefined,
    transaction,
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
