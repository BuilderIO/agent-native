import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";

export default defineAction({
  description:
    "Create a bounded keyword or delegated-agent CRM signal detector. Smart detectors define criteria only; this action never calls a model.",
  schema: z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500).default(""),
      kind: z.enum(["keyword", "smart"]),
      keywords: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
      classifierPrompt: z.string().trim().max(1_000).default(""),
      enabled: z.boolean().default(true),
    })
    .superRefine((value, ctx) => {
      if (value.kind === "keyword" && value.keywords.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["keywords"],
          message: "Keyword detectors require at least one keyword.",
        });
      }
      if (value.kind === "smart" && !value.classifierPrompt) {
        ctx.addIssue({
          code: "custom",
          path: ["classifierPrompt"],
          message: "Smart detectors require a classification criterion.",
        });
      }
    }),
  run: async (args, ctx) => {
    const scope = requireCrmScope(ctx);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await getDb()
      .insert(schema.crmSignalTrackers)
      .values({
        id,
        name: args.name,
        description: args.description,
        kind: args.kind,
        keywordsJson: JSON.stringify(
          args.kind === "keyword" ? args.keywords : [],
        ),
        classifierPrompt: args.kind === "smart" ? args.classifierPrompt : "",
        enabled: args.enabled,
        isDefault: false,
        ...scope,
        createdAt: now,
        updatedAt: now,
      });
    return { id, ...args };
  },
});
