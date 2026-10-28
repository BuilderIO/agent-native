import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import { assertContentTrashPurgeReadAccess } from "./_content-trash-purge-read-access.js";

export default defineAction({
  description:
    "Get durable progress and cursor-paginated outcomes for one authorized Trash purge operation.",
  schema: z.object({
    operationId: z.string().uuid(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ operationId, cursor, limit }) => {
    const actorEmail = getRequestUserEmail();
    if (!actorEmail)
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    const db = getDb();
    const [operation] = await db
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.id, operationId),
          eq(schema.contentTrashPurgeOperations.actorEmail, actorEmail),
        ),
      )
      .limit(1);
    if (!operation)
      fail("Trash purge operation not found", {
        errorCode: "not_found",
        statusCode: 404,
      });
    const [plan] = await db
      .select({
        orgId: schema.contentTrashPurgePlans.orgId,
        spaceId: schema.contentTrashPurgePlans.spaceId,
      })
      .from(schema.contentTrashPurgePlans)
      .where(eq(schema.contentTrashPurgePlans.id, operation.planId))
      .limit(1);
    if (!plan)
      fail("Trash purge operation not found", {
        errorCode: "not_found",
        statusCode: 404,
      });
    if (plan.orgId) {
      const memberships = await listContentOrganizationMemberships(actorEmail);
      if (!memberships.some((membership) => membership.orgId === plan.orgId))
        fail("Trash purge operation not found", {
          errorCode: "not_found",
          statusCode: 404,
        });
    } else if (plan.spaceId) {
      const [space] = await db
        .select({ id: schema.contentSpaces.id })
        .from(schema.contentSpaces)
        .where(
          and(
            eq(schema.contentSpaces.id, plan.spaceId),
            sql`lower(${schema.contentSpaces.ownerEmail}) = ${actorEmail.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (!space)
        fail("Trash purge operation not found", {
          errorCode: "not_found",
          statusCode: 404,
        });
    } else {
      const spaces = await db
        .selectDistinct({
          spaceId: schema.contentTrashPurgePlanItems.spaceId,
        })
        .from(schema.contentTrashPurgePlanItems)
        .where(eq(schema.contentTrashPurgePlanItems.planId, operation.planId));
      for (const { spaceId } of spaces) {
        if (!spaceId) continue;
        const [space] = await db
          .select({ id: schema.contentSpaces.id })
          .from(schema.contentSpaces)
          .where(
            and(
              eq(schema.contentSpaces.id, spaceId),
              sql`lower(${schema.contentSpaces.ownerEmail}) = ${actorEmail.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (!space)
          fail("Trash purge operation not found", {
            errorCode: "not_found",
            statusCode: 404,
          });
      }
    }
    const terminal = [
      "succeeded",
      "partially_completed",
      "conflicted",
      "failed",
    ].includes(operation.status);
    if (!terminal) await assertContentTrashPurgeReadAccess(operation.planId);
    const rows = await db
      .select({
        id: schema.contentTrashPurgePlanItems.id,
        documentId: schema.contentTrashPurgePlanItems.documentId,
        title: schema.contentTrashPurgePlanItems.title,
        outcome: schema.contentTrashPurgePlanItems.outcome,
        detail: schema.contentTrashPurgePlanItems.outcomeDetail,
      })
      .from(schema.contentTrashPurgePlanItems)
      .where(
        and(
          eq(schema.contentTrashPurgePlanItems.planId, operation.planId),
          cursor ? gt(schema.contentTrashPurgePlanItems.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(schema.contentTrashPurgePlanItems.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      operationId: operation.id,
      planId: operation.planId,
      idempotencyKey: operation.idempotencyKey,
      status: operation.status,
      eligibleCount: operation.eligibleCount,
      deletedCount: operation.deletedCount,
      blockedCount: operation.blockedCount,
      conflictedCount: operation.conflictedCount,
      remains: operation.blockedCount + operation.conflictedCount,
      outcomes: page.map(({ id: _id, ...item }) => item),
      nextCursor:
        rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      lastError: operation.lastError,
      completedAt: operation.completedAt,
    };
  },
});
