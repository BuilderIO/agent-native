import { defineAction } from "@agent-native/core";
import {
  ForbiddenError,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { summarizePlanVersion } from "../server/lib/plan-versions.js";

export default defineAction({
  description:
    "List saved history snapshots for an Agent-Native Plan. Use this before inspecting or restoring a plan to an earlier version.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "List Plan Versions",
    description: "List saved version history for a visual plan.",
  },
  run: async ({ planId, limit }) => {
    const access = await resolveAccess(
      "plan",
      planId,
      resolvePlanAccessContext(currentAccess()),
    );
    if (!access) throw new ForbiddenError(`Plan ${planId} not found`);
    if ((access.resource as typeof schema.plans.$inferSelect).deletedAt) {
      throw new ForbiddenError(`Plan ${planId} not found`);
    }

    const ownerEmail = access.resource.ownerEmail as string;
    const versions = await getDb()
      .select()
      .from(schema.planVersions)
      .where(
        and(
          eq(schema.planVersions.planId, planId),
          eq(schema.planVersions.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(desc(schema.planVersions.createdAt))
      .limit(limit);

    return {
      planId,
      count: versions.length,
      versions: versions.map(summarizePlanVersion),
    };
  },
});
