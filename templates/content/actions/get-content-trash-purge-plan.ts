import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import { assertContentTrashPurgeReadAccess } from "./_content-trash-purge-read-access.js";

export default defineAction({
  description:
    "Read every affected item, blocker, and survivor effect in an exact Trash purge plan with cursor pagination.",
  schema: z.object({
    planId: z.string().uuid(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ planId, cursor, limit }) => {
    const email = getRequestUserEmail();
    if (!email)
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    const [plan] = await getDb()
      .select()
      .from(schema.contentTrashPurgePlans)
      .where(
        and(
          eq(schema.contentTrashPurgePlans.id, planId),
          eq(schema.contentTrashPurgePlans.actorEmail, email),
        ),
      )
      .limit(1);
    if (!plan)
      fail("Trash purge plan not found", {
        errorCode: "not_found",
        statusCode: 404,
      });
    if (plan.orgId) {
      const memberships = await listContentOrganizationMemberships(email);
      if (!memberships.some((membership) => membership.orgId === plan.orgId))
        fail("Trash purge plan not found", {
          errorCode: "not_found",
          statusCode: 404,
        });
    }
    await assertContentTrashPurgeReadAccess(planId);
    const rows = await getDb()
      .select({
        id: schema.contentTrashPurgePlanItems.id,
        unitId: schema.contentTrashPurgePlanItems.unitId,
        documentId: schema.contentTrashPurgePlanItems.documentId,
        title: schema.contentTrashPurgePlanItems.title,
        eligibility: schema.contentTrashPurgePlanItems.eligibility,
        blocker: schema.contentTrashPurgePlanItems.blocker,
        survivorEffect: schema.contentTrashPurgePlanItems.survivorEffect,
        outcome: schema.contentTrashPurgePlanItems.outcome,
        outcomeDetail: schema.contentTrashPurgePlanItems.outcomeDetail,
      })
      .from(schema.contentTrashPurgePlanItems)
      .where(
        and(
          eq(schema.contentTrashPurgePlanItems.planId, planId),
          cursor ? gt(schema.contentTrashPurgePlanItems.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(schema.contentTrashPurgePlanItems.id))
      .limit(limit + 1);
    return {
      planId,
      state: plan.state,
      eligibleCount: plan.eligibleCount,
      blockedCount: plan.blockedCount,
      items: rows.slice(0, limit).map(({ eligibility, ...item }) => ({
        ...item,
        eligible: eligibility === "eligible",
      })),
      nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
    };
  },
});
