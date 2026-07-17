import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  archiveContextSource,
  createContextSource,
  deleteContextSource,
  previewContextSourcePromotion,
  promoteContextSource,
  restoreContextSource,
  toSourceSummary,
  updateContextSource,
} from "../store/index.js";

const upstreamAccess = z.enum(["available", "restricted", "unknown"]);
const sourceStatus = z.enum(["active", "paused", "archived", "error"]);
const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    name: z.string().trim().min(1).max(200),
    kind: z.enum([
      "manual",
      "upload",
      "google-slides",
      "figma",
      "notion",
      "website",
    ]),
    externalRef: z.string().max(2000).optional(),
    connectionId: z.string().max(500).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    upstreamAccess: upstreamAccess.optional(),
  }),
  z.object({
    operation: z.literal("update"),
    sourceId: z.string().min(1),
    patch: z.object({
      name: z.string().trim().min(1).max(200).optional(),
      externalRef: z.string().max(2000).nullable().optional(),
      connectionId: z.string().max(500).nullable().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      status: sourceStatus.optional(),
      upstreamAccess: upstreamAccess.optional(),
    }),
  }),
  z.object({
    operation: z.enum(["archive", "restore", "delete"]),
    sourceId: z.string().min(1),
  }),
  z.object({
    operation: z.literal("preview-promotion"),
    sourceId: z.string().min(1),
  }),
  z.object({
    operation: z.literal("promote"),
    sourceId: z.string().min(1),
    confirmation: z.object({
      containerRef: z.string().min(1),
      boundaryHash: z.string().length(64),
      itemCount: z.number().int().min(0),
    }),
  }),
]);

const agentInputSchema = z.object({
  operation: z.enum([
    "create",
    "update",
    "archive",
    "restore",
    "delete",
    "preview-promotion",
    "promote",
  ]),
  sourceId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: z
    .enum(["manual", "upload", "google-slides", "figma", "notion", "website"])
    .optional(),
  externalRef: z.string().max(2000).optional(),
  connectionId: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  upstreamAccess: upstreamAccess.optional(),
  patch: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      externalRef: z.string().max(2000).nullable().optional(),
      connectionId: z.string().max(500).nullable().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      status: sourceStatus.optional(),
      upstreamAccess: upstreamAccess.optional(),
    })
    .optional(),
  confirmation: z
    .object({
      containerRef: z.string().min(1),
      boundaryHash: z.string().length(64),
      itemCount: z.number().int().min(0),
    })
    .optional(),
});

export default defineAction({
  description:
    "Create or update a private source, archive/restore it, preview a deliberate org promotion, promote after confirming container and count, or tombstone it and enqueue purge.",
  schema,
  agentInputSchema,
  needsApproval: (args) =>
    args.operation === "delete" || args.operation === "promote",
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: async (args) => {
    if (args.operation === "create") {
      const source = await createContextSource(args);
      return { source: toSourceSummary(source), deleted: false };
    }
    if (args.operation === "update") {
      const source = await updateContextSource(args.sourceId, args.patch);
      return { source: toSourceSummary(source), deleted: false };
    }
    if (args.operation === "archive") {
      const source = await archiveContextSource(args.sourceId);
      return { source: toSourceSummary(source), deleted: false };
    }
    if (args.operation === "restore") {
      const source = await restoreContextSource(args.sourceId);
      return { source: toSourceSummary(source), deleted: false };
    }
    if (args.operation === "preview-promotion") {
      return {
        source: null,
        deleted: false,
        promotionPreview: await previewContextSourcePromotion(args.sourceId),
      };
    }
    if (args.operation === "promote") {
      const source = await promoteContextSource(
        args.sourceId,
        args.confirmation,
      );
      return { source: toSourceSummary(source), deleted: false };
    }
    const deleted = await deleteContextSource(args.sourceId);
    return {
      source: toSourceSummary(deleted.source),
      deleted: true,
      purgeJobId: deleted.purgeJobId,
    };
  },
});
