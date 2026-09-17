import { z } from "zod";

import { defineAction } from "../../action.js";
import { queryAuditEvents } from "../../audit/store.js";
import { assertVersionedResourceAccess } from "../registry.js";
import { queryResourceVersions } from "../store.js";
import type { VersionedResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
});

export default defineAction({
  description: "List versions and audit events for a reusable resource.",
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
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const auditScope = {
      userEmail: actionCtx?.userEmail ?? undefined,
      orgId: actionCtx?.orgId ?? undefined,
    };
    const [versions, auditEvents] = await Promise.all([
      queryResourceVersions({
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        scope,
        bypassScope: true,
        limit: args.limit,
      }),
      queryAuditEvents(auditScope, {
        targetType: args.resourceType,
        targetId: args.resourceId,
        limit: args.limit ?? 50,
      }),
    ]);
    return { versions, auditEvents };
  },
});
