import { ActionContractError } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { chunks } from "./_batch-utils.js";
import { getContentOrganizationMembership } from "./_content-space-access.js";

// Call after locking documents. Holding existing grants prevents a concurrent
// revoke from racing the authorization check and the subsequent mutation.
export async function assertDocumentMutationAccess(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
  role: "viewer" | "editor" | "admin",
) {
  const ids = [...new Set(documentIds)].sort();
  for (const batch of chunks(ids, 90)) {
    await db
      .select({ id: schema.documentShares.id })
      .from(schema.documentShares)
      .where(inArray(schema.documentShares.resourceId, batch))
      .orderBy(asc(schema.documentShares.id))
      .for("share");
    let authorized = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, batch),
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            role,
            { includePublic: role === "viewer" },
          ),
        ),
      );
    const userEmail = getRequestUserEmail();
    if (authorized.length !== batch.length && role === "viewer" && userEmail) {
      const { orgMembers } = await import("@agent-native/core/org");
      const memberships = await db
        .select({ orgId: orgMembers.orgId })
        .from(orgMembers)
        .where(
          and(
            sql`LOWER(${orgMembers.email}) = ${userEmail.trim().toLowerCase()}`,
            isNull(orgMembers.federationRemovalPendingAt),
          ),
        )
        .orderBy(asc(orgMembers.orgId))
        .for("share");
      const contexts = [];
      for (const membership of memberships) {
        if (
          await getContentOrganizationMembership(membership.orgId, userEmail, {
            db,
          })
        ) {
          contexts.push({ userEmail, orgId: membership.orgId });
        }
      }
      if (contexts.length > 0) {
        authorized = await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(
              inArray(schema.documents.id, batch),
              or(
                accessFilter(
                  schema.documents,
                  schema.documentShares,
                  undefined,
                  role,
                  { includePublic: true },
                ),
                ...contexts.map((context) =>
                  accessFilter(
                    schema.documents,
                    schema.documentShares,
                    context,
                    role,
                    { includePublic: true },
                  ),
                ),
              ),
            ),
          );
      }
    }
    if (authorized.length !== batch.length) {
      throw new ActionContractError(
        "You no longer have permission to change every page in this operation.",
        {
          errorCode: "DOCUMENT_MUTATION_ACCESS_CHANGED",
          statusCode: 403,
        },
      );
    }
  }
}
