import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { collectionSchema } from "../app/lib/model/contracts.js";
import {
  requireCurrentWorkspace,
  workspaceAccess,
} from "../server/lib/workspace-access.js";
import { updateCollection } from "../server/model/collections-store.js";

export default defineAction({
  description: "Rename a collection or change its description.",
  schema: z
    .object({
      collectionId: z.string().min(1),
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      emoji: z.string().trim().max(16).nullable().optional(),
    })
    .strict(),
  outputSchema: z.object({ collection: collectionSchema }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ collectionId, name, description, emoji }) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    await workspaceAccess.assertPermission(["create-project"], scope);
    const collection = await updateCollection({
      ...scope,
      collectionId,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(emoji === undefined ? {} : { emoji }),
    });
    return { collection };
  },
});
