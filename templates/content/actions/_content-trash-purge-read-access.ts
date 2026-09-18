import { fail } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export async function assertContentTrashPurgeReadAccess(planId: string) {
  const units = await getDb()
    .selectDistinct({
      rootDocumentId: schema.contentTrashPurgePlanItems.rootDocumentId,
    })
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, planId));
  const unitIds = units.map(({ rootDocumentId }) => rootDocumentId);
  const authorized = unitIds.length
    ? await getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, unitIds),
            accessFilter(
              schema.documents,
              schema.documentShares,
              undefined,
              "admin",
            ),
          ),
        )
    : [];
  if (authorized.length !== unitIds.length) {
    fail("Trash purge record not found", {
      errorCode: "not_found",
      statusCode: 404,
    });
  }
}
