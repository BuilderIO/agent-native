import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryComments } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List comments attached to the selected Factory canvas, node, or edge.",
  schema: z.object({
    factoryId: z.string().trim().min(1).max(120).default(DEFAULT_FACTORY_ID),
    graphVersion: z.coerce.number().int().positive().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId, graphVersion }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    return getDb()
      .select()
      .from(factoryComments)
      .where(
        and(
          eq(factoryComments.factoryId, factoryId),
          eq(factoryComments.orgId, orgId),
          ...(graphVersion
            ? [eq(factoryComments.graphVersion, graphVersion)]
            : []),
        ),
      )
      .orderBy(desc(factoryComments.createdAt));
  },
});
