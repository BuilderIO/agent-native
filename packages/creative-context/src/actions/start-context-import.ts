import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dispatchCreativeContextImportJob } from "../jobs/index.js";
import { getCreativeContext } from "../server/context.js";
import { createJob } from "../store/index.js";
import { getContextSource } from "../store/index.js";

export default defineAction({
  description:
    "Queue a durable creative-context import for a source. The background runner inventories, fetches, checkpoints, and ingests immutable versions.",
  schema: z.object({
    sourceId: z.string().min(1),
    mode: z.enum(["incremental", "full"]).default("incremental"),
    itemExternalIds: z.array(z.string().min(1)).max(10_000).optional(),
  }),
  needsApproval: true,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    const source = await getContextSource(args.sourceId);
    if (!source) throw new Error("Context source not found or not accessible");
    const job = await createJob({
      sourceId: args.sourceId,
      kind: "import",
      mode: args.mode,
      request: { itemExternalIds: args.itemExternalIds },
      progressTotal: args.itemExternalIds?.length,
    });
    await dispatchCreativeContextImportJob({
      jobId: job.id,
      ownerEmail: source.ownerEmail,
      orgId: job.orgId,
      appId: getCreativeContext().connectorContext.appId,
    });
    return { job };
  },
});
