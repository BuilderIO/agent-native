import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { collectionSchema } from "../app/lib/model/contracts.js";
import { resourcePath } from "../app/lib/navigation-contract.js";
import {
  agentNavigationSchema,
  agentOpenIntentSchema,
  showAgentResource,
} from "../server/agent-navigation.js";
import {
  requireCurrentWorkspace,
  workspaceAccess,
} from "../server/lib/workspace-access.js";
import {
  COLLECTION_ROLES,
  MAX_COLLECTION_USER_GRANTS,
  createCollection,
  readCollectionSharing,
} from "../server/model/collections-store.js";

const collectionRole = z.enum(COLLECTION_ROLES);
const storedRole = z.enum([...COLLECTION_ROLES, "viewer", "commenter"]);

export default defineAction({
  mcpTool: true,
  description: "Create a collection in the current workspace.",
  schema: z
    .object({
      name: z.string().trim().min(1).max(200),
      description: z.string().max(2000).optional(),
      emoji: z.string().trim().max(16).nullable().optional(),
      parentId: z.string().min(1).nullable().optional(),
      sharing: z
        .object({
          workspaceRole: collectionRole
            .optional()
            .describe("Share with the whole workspace at this role."),
          users: z
            .array(
              z
                .object({
                  email: z.string().trim().email(),
                  role: collectionRole,
                })
                .strict(),
            )
            .max(MAX_COLLECTION_USER_GRANTS)
            .optional()
            .describe(
              "Workspace members to share with; non-members are rejected.",
            ),
        })
        .strict()
        .optional()
        .describe("Omit to create a private collection."),
      intent: agentOpenIntentSchema,
    })
    .strict(),
  outputSchema: z.object({
    id: z.string().min(1),
    href: z.string().min(1),
    collection: collectionSchema,
    sharing: z.object({
      workspaceRole: storedRole.nullable(),
      users: z.array(z.object({ email: z.string(), role: storedRole })),
    }),
    navigation: agentNavigationSchema.optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (
    { name, description, emoji, parentId, sharing, intent },
    context,
  ) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    await workspaceAccess.assertPermission(["create-project"], scope);
    const collection = await createCollection({
      ...scope,
      name,
      ...(description === undefined ? {} : { description }),
      ...(emoji === undefined ? {} : { emoji }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(sharing === undefined ? {} : { sharing }),
    });
    return {
      id: collection.id,
      href: resourcePath("collection", collection.id),
      collection,
      sharing: await readCollectionSharing(scope, collection.id),
      ...(await showAgentResource(
        context,
        "collection",
        collection.id,
        intent,
      )),
    };
  },
});
