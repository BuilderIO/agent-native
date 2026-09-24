import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryComments } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Add a review comment to a Factory canvas, node, or edge. Comments are durable collaboration context and do not change or execute the Factory.",
  schema: z.object({
    factoryId: z.string().trim().min(1).max(120).default(DEFAULT_FACTORY_ID),
    graphVersion: z.coerce.number().int().positive(),
    targetType: z.enum(["canvas", "node", "edge"]).default("canvas"),
    targetId: z.string().trim().max(120).optional(),
    body: z.string().trim().min(1).max(4_000),
  }),
  run: async (
    { factoryId, graphVersion, targetType, targetId, body },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const id = stableId(
      "factory-comment",
      orgId,
      factoryId,
      String(graphVersion),
      targetType,
      targetId ?? "canvas",
      body,
      new Date().toISOString(),
    );
    await getDb()
      .insert(factoryComments)
      .values({
        id,
        factoryId,
        graphVersion,
        targetType,
        targetId: targetId ?? null,
        body,
        createdAt: new Date().toISOString(),
        ownerEmail: userEmail,
        orgId,
      });
    return { ok: true, id, factoryId, graphVersion, targetType, targetId };
  },
});
