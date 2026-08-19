import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  archiveCreativeContext,
  createCreativeContext,
  setCreativeContextAppDefault,
  updateCreativeContext,
} from "../store/index.js";

const policy = z.enum(["open", "review", "admins-only"]);
const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    kind: z.enum(["default", "specialty"]),
    brandProfileId: z.string().min(1).nullable().optional(),
    approvalPolicy: policy.optional(),
  }),
  z.object({
    operation: z.literal("update"),
    contextId: z.string().min(1),
    patch: z.object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      brandProfileId: z.string().min(1).nullable().optional(),
      approvalPolicy: policy.optional(),
    }),
  }),
  z.object({ operation: z.literal("archive"), contextId: z.string().min(1) }),
  z.object({
    operation: z.literal("set-app-default"),
    contextId: z.string().min(1),
    appId: z.string().trim().min(1).max(200),
  }),
]);

export default defineAction({
  description:
    "Create, govern, archive, or bind a governed Creative Context. Context sharing is managed by the shared resource actions.",
  schema,
  agentInputSchema: z.object({
    operation: z.enum(["create", "update", "archive", "set-app-default"]),
    contextId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    kind: z.enum(["default", "specialty"]).optional(),
    brandProfileId: z.string().nullable().optional(),
    approvalPolicy: policy.optional(),
    appId: z.string().optional(),
    patch: z.record(z.string(), z.unknown()).optional(),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: async (args) => {
    if (args.operation === "create")
      return { context: await createCreativeContext(args) };
    if (args.operation === "update")
      return {
        context: await updateCreativeContext(args.contextId, args.patch),
      };
    if (args.operation === "archive")
      return { context: await archiveCreativeContext(args.contextId) };
    return {
      context: await setCreativeContextAppDefault(args.contextId, args.appId),
    };
  },
});
