import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { manageContextMembership } from "../store/index.js";

const nativeResource = z.object({
  appId: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  expectedUpdatedAt: z.string().min(1).optional(),
});
const schema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("submit"),
      contextId: z.string().min(1),
      itemId: z.string().min(1).optional(),
      itemVersionId: z.string().min(1).optional(),
      nativeResource: nativeResource.optional(),
      note: z.string().max(5000).optional(),
      rank: z.enum(["canonical", "exemplar", "normal"]).optional(),
      purpose: z.string().max(1000).optional(),
      confirmBroaderPublication: z.boolean().optional(),
    })
    .refine(
      (value) => Boolean(value.itemId || value.nativeResource),
      "Provide itemId or nativeResource",
    ),
  z.object({
    operation: z.enum(["approve", "request-changes", "withdraw", "remove"]),
    contextId: z.string().min(1),
    membershipId: z.string().min(1),
    note: z.string().max(5000).optional(),
  }),
]);

export default defineAction({
  description:
    "Submit an artifact to a governed Creative Context, approve or request changes on a pending submission, withdraw it, or remove a published membership.",
  schema,
  agentInputSchema: z.object({
    operation: z.enum([
      "submit",
      "approve",
      "request-changes",
      "withdraw",
      "remove",
    ]),
    contextId: z.string().min(1),
    membershipId: z.string().optional(),
    itemId: z.string().optional(),
    itemVersionId: z.string().optional(),
    nativeResource: nativeResource.optional(),
    note: z.string().optional(),
    rank: z.enum(["canonical", "exemplar", "normal"]).optional(),
    purpose: z.string().optional(),
    confirmBroaderPublication: z.boolean().optional(),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: manageContextMembership,
});
