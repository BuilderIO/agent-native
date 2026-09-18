import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertVersionedResourceAccess } from "../registry.js";
import { queryResourceVersions } from "../store.js";
import type { VersionedResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export default defineAction({
  description: "List version-history snapshots for a reusable resource.",
  schema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const actionCtx = ctx as VersionedResourceContext | undefined;
    await assertVersionedResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "viewer",
    );
    return {
      versions: await queryResourceVersions({
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        scope: {
          userEmail: actionCtx?.userEmail ?? null,
          orgId: actionCtx?.orgId ?? null,
        },
        bypassScope: true,
        limit: args.limit,
        offset: args.offset,
      }),
    };
  },
});
