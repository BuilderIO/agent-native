import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import { assertAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";
import { resourceSharingChange } from "./change-result.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

function normalizePrincipalId(
  principalType: "user" | "group" | "org",
  principalId: string,
): string {
  return principalType === "user"
    ? principalId.trim().toLowerCase()
    : principalId;
}

function principalIdMatches(
  sharesTable: any,
  principalType: "user" | "group" | "org",
  principalId: string,
): SQL {
  return principalType === "user"
    ? sql`lower(${sharesTable.principalId}) = ${principalId}`
    : eq(sharesTable.principalId, principalId);
}

export default defineAction({
  description:
    "Revoke a previously granted share. Owner or admin role required.",
  toolCallable: false,
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    principalType: z.enum(["user", "group", "org"]),
    principalId: z.string(),
  }),
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    const access = await assertAccess(
      args.resourceType,
      args.resourceId,
      "admin",
    );
    const beforeExtensionTargets = await getExtensionShareChangeTargets(
      args.resourceType,
      args.resourceId,
    );
    const db = reg.getDb() as any;
    const principalId = normalizePrincipalId(
      args.principalType,
      args.principalId,
    );
    const [deleted] = await db
      .delete(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, args.resourceId),
          eq(reg.sharesTable.principalType, args.principalType),
          principalIdMatches(reg.sharesTable, args.principalType, principalId),
        ),
      )
      .returning({ id: reg.sharesTable.id });
    invalidateCollabAccessCache(args.resourceType, args.resourceId);
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );
    return {
      ok: true,
      ...(deleted
        ? {
            change: resourceSharingChange(
              reg,
              access.resource,
              "deleted",
              `${args.principalType}:${principalId}`,
            ).change,
          }
        : {}),
    };
  },
});
