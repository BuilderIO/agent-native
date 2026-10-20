import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  authorizedTrashDocumentIds,
  hashTrashScopeToken,
} from "../server/lib/content-trash-purge.js";
import {
  deleteTrashedDocumentSubtree,
  PermanentDeleteScopeChangedError,
} from "./delete-document.js";

export default defineAction({
  description:
    "Permanently delete one exact, already reviewed Trash plan. This cannot be undone.",
  schema: z.object({
    id: z.string().describe("Trashed root document ID"),
    planId: z.string().uuid().describe("Reviewed exact purge plan ID"),
    scopeToken: z
      .string()
      .min(20)
      .describe("Opaque token returned by that plan"),
  }),
  needsApproval: true,
  run: async ({ id, planId, scopeToken }) => {
    const actorEmail = getRequestUserEmail();
    if (!actorEmail)
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    const access = await assertAccess("document", id, "admin");
    const db = getDb();
    const [plan] = await db
      .select()
      .from(schema.contentTrashPurgePlans)
      .where(
        and(
          eq(schema.contentTrashPurgePlans.id, planId),
          eq(
            schema.contentTrashPurgePlans.scopeTokenHash,
            hashTrashScopeToken(scopeToken),
          ),
          eq(schema.contentTrashPurgePlans.state, "ready"),
          eq(schema.contentTrashPurgePlans.actorEmail, actorEmail),
        ),
      )
      .limit(1);
    const items = plan
      ? await db
          .select()
          .from(schema.contentTrashPurgePlanItems)
          .where(eq(schema.contentTrashPurgePlanItems.planId, planId))
      : [];
    if (
      !plan ||
      Date.parse(plan.expiresAt) <= Date.now() ||
      items.length === 0 ||
      items.some(
        (item) =>
          item.rootDocumentId !== id ||
          item.eligibility !== "eligible" ||
          item.expectedScopeFingerprint !== items[0]!.expectedScopeFingerprint,
      )
    )
      fail(
        "Permanent deletion requires a current reviewed exact plan for this Trash item",
        { errorCode: "stale_scope", statusCode: 409 },
      );
    let deleted: string[];
    try {
      deleted = await db.transaction(async (tx) => {
        const transactionDb = tx as unknown as ReturnType<typeof getDb>;
        const authorizedIds = await authorizedTrashDocumentIds(
          transactionDb,
          items.map((item) => item.documentId),
        );
        if (authorizedIds.size !== items.length)
          throw new PermanentDeleteScopeChangedError();
        const result = await deleteTrashedDocumentSubtree(
          transactionDb,
          id,
          access.resource.ownerEmail as string,
          items.map((item) => ({
            documentId: item.documentId,
            expectedTrashedAt: item.expectedTrashedAt,
            expectedParentId: item.expectedParentId,
          })),
          items[0]!.expectedScopeFingerprint,
        );
        const [receipt] = await transactionDb
          .update(schema.contentTrashPurgePlans)
          .set({ state: "consumed", updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(schema.contentTrashPurgePlans.id, planId),
              eq(schema.contentTrashPurgePlans.state, "ready"),
            ),
          )
          .returning({ id: schema.contentTrashPurgePlans.id });
        if (!receipt) throw new PermanentDeleteScopeChangedError();
        return result;
      });
    } catch (error) {
      if (error instanceof PermanentDeleteScopeChangedError)
        fail("Trash changed after review; create and inspect a new plan", {
          errorCode: "scope_changed",
          statusCode: 409,
        });
      throw error;
    }
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      success: true,
      deleted: deleted.length,
      planId,
      disclosedAffectedCount: items.length,
    };
  },
});
