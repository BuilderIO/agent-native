import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

function normalizePrincipalId(
  principalType: "user" | "org",
  principalId: string,
): string {
  return principalType === "user"
    ? principalId.trim().toLowerCase()
    : principalId;
}

function principalIdMatches(
  sharesTable: any,
  principalType: "user" | "org",
  principalId: string,
): SQL {
  return principalType === "user"
    ? sql`lower(${sharesTable.principalId}) = ${principalId}`
    : eq(sharesTable.principalId, principalId);
}

export default defineAction({
  description:
    "Revoke a previously granted share. Owner or admin role required.",
  // (audit H5) Mirror share-resource: refuse from the tools iframe bridge.
  toolCallable: false,
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    principalType: z.enum(["user", "org"]),
    principalId: z.string(),
  }),
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    await assertAccess(args.resourceType, args.resourceId, "admin");
    const beforeExtensionTargets = await getExtensionShareChangeTargets(
      args.resourceType,
      args.resourceId,
    );
    const db = reg.getDb() as any;
    const principalId = normalizePrincipalId(
      args.principalType,
      args.principalId,
    );
    await db
      .delete(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, args.resourceId),
          eq(reg.sharesTable.principalType, args.principalType),
          principalIdMatches(reg.sharesTable, args.principalType, principalId),
        ),
      );
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );
    return { ok: true };
  },
});
