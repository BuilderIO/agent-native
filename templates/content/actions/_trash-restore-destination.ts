import { fail } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { collectTrashRecoveryScope } from "./_trash-recovery-scope.js";

export async function collectTrashDestinationAncestors(
  db: ReturnType<typeof getDb>,
  parentId: string | null,
  selectedIds: string[],
  ownership: Pick<
    typeof schema.documents.$inferSelect,
    "ownerEmail" | "orgId" | "spaceId"
  >,
) {
  const visited = new Set<string>();
  let current = parentId;
  while (current !== null) {
    if (
      visited.has(current) ||
      selectedIds.includes(current) ||
      visited.size >= 1000
    ) {
      fail("The destination would create an invalid page hierarchy.", {
        errorCode: "TRASH_DESTINATION_CONFLICT",
        statusCode: 409,
      });
    }
    const [parent] = await db
      .select({ parentId: schema.documents.parentId })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, current),
          eq(schema.documents.ownerEmail, ownership.ownerEmail),
          ownership.orgId === null
            ? isNull(schema.documents.orgId)
            : eq(schema.documents.orgId, ownership.orgId),
          ownership.spaceId === null
            ? isNull(schema.documents.spaceId)
            : eq(schema.documents.spaceId, ownership.spaceId),
        ),
      )
      .limit(1);
    if (!parent) {
      fail(
        "The destination hierarchy is unavailable. Choose another location.",
        {
          errorCode: "TRASH_DESTINATION_CONFLICT",
          statusCode: 409,
        },
      );
    }
    visited.add(current);
    current = parent.parentId;
  }
  return [...visited].sort();
}

export async function resolveTrashRestoreDestination(
  db: ReturnType<typeof getDb>,
  scope: Awaited<ReturnType<typeof collectTrashRecoveryScope>>,
  destinationParentId: string | null | undefined,
) {
  const parentId =
    destinationParentId === undefined
      ? scope.root.parentId
      : destinationParentId;
  if (
    scope.root.sourceMode === "local-files" &&
    parentId !== scope.root.parentId
  ) {
    fail("Restore this source-backed page at its original location.", {
      errorCode: "TRASH_SOURCE_DESTINATION_CONFLICT",
      statusCode: 409,
    });
  }
  if (parentId === null) return null;
  if (scope.documentIds.includes(parentId)) {
    fail("A page cannot be restored inside its own subtree.", {
      errorCode: "TRASH_DESTINATION_CONFLICT",
      statusCode: 409,
    });
  }
  const [parent] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, parentId),
        isNull(schema.documents.trashedAt),
        accessFilter(
          schema.documents,
          schema.documentShares,
          undefined,
          destinationParentId === undefined ? "viewer" : "editor",
        ),
      ),
    )
    .limit(1);
  if (!parent) {
    fail(
      "Choose a live destination in the same space before restoring this page.",
      { errorCode: "TRASH_DESTINATION_REQUIRED", statusCode: 409 },
    );
  }
  if (
    parent.spaceId !== scope.root.spaceId ||
    parent.orgId !== scope.root.orgId ||
    parent.ownerEmail !== scope.root.ownerEmail
  ) {
    fail("The destination must preserve the page's space and ownership.", {
      errorCode: "TRASH_DESTINATION_CONFLICT",
      statusCode: 409,
    });
  }
  return parentId;
}
