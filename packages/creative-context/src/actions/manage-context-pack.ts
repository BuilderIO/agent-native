import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  archiveContextPack,
  createContextPack,
  deriveContextPack,
  setContextPackPinned,
} from "../store/index.js";

const member = z.object({
  itemId: z.string().min(1),
  itemVersionId: z.string().min(1).optional(),
  reason: z.string().max(2000).optional(),
});

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    brandDnaVersionId: z.string().min(1).nullable().optional(),
    members: z.array(member).max(1000),
    pinned: z.boolean().optional(),
  }),
  z.object({
    operation: z.literal("derive"),
    packId: z.string().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    addMembers: z.array(member).max(1000).optional(),
    removeItemIds: z.array(z.string().min(1)).max(1000).optional(),
    brandDnaVersionId: z.string().min(1).nullable().optional(),
    pinned: z.boolean().optional(),
  }),
  z.object({
    operation: z.enum(["pin", "unpin", "archive"]),
    packId: z.string().min(1),
  }),
]);

const agentInputSchema = z.object({
  operation: z.enum(["create", "derive", "pin", "unpin", "archive"]),
  packId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  brandDnaVersionId: z.string().min(1).nullable().optional(),
  members: z.array(member).max(1000).optional(),
  addMembers: z.array(member).max(1000).optional(),
  removeItemIds: z.array(z.string().min(1)).max(1000).optional(),
  pinned: z.boolean().optional(),
});

export default defineAction({
  description:
    "Create an immutable context pack, derive a new membership snapshot, change a separate user pin pointer, or archive a pack. Existing member rows are never mutated.",
  schema,
  agentInputSchema,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    if (args.operation === "create") {
      return { pack: await createContextPack(args), deleted: false };
    }
    if (args.operation === "derive") {
      return { pack: await deriveContextPack(args), deleted: false };
    }
    if (args.operation === "archive") {
      return { pack: await archiveContextPack(args.packId), deleted: false };
    }
    return {
      pack: await setContextPackPinned(args.packId, args.operation === "pin"),
      deleted: false,
    };
  },
});
