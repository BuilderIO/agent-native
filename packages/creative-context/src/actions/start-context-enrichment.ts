import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createJob } from "../store/index.js";

const schema = z.object({
  sourceId: z.string().min(1).optional(),
  operation: z.enum([
    "rebuild-fts",
    "rebuild-embeddings",
    "enrich-media",
    "infer-brand-dna",
    "rank-canonical-logo",
    "find-layout-suggestions",
    "metadata-refresh",
  ]),
  itemIds: z.array(z.string().min(1)).max(10_000).optional(),
  eagerLimit: z.coerce.number().int().min(1).max(500).default(25),
});

export default defineAction({
  description:
    "Queue a durable, budgeted creative-context rebuild or enrichment job; top brand inputs run eagerly and the remainder stays pending/on-demand.",
  schema,
  needsApproval: true,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => ({
    job: await createJob({
      sourceId: args.sourceId,
      kind:
        args.operation === "enrich-media"
          ? "enrich-media"
          : args.operation === "infer-brand-dna"
            ? "brand-dna"
            : args.operation === "rank-canonical-logo"
              ? "canonical-logo"
              : args.operation === "find-layout-suggestions"
                ? "layout-suggestion"
                : args.operation === "metadata-refresh"
                  ? "metadata-refresh"
                  : "embed",
      request: args,
      progressTotal: args.itemIds?.length,
      budget: {
        eagerLimit: args.eagerLimit,
        remainingMode: "pending-on-demand",
      },
    }),
  }),
});
