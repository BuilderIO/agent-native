import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { notifyActionChange } from "../../server/action-change.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import { assertAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

export interface UnshareResourceResult {
  ok: true;
  /** Marker persistence is acknowledged separately from the committed revoke. */
  recipientInvalidation: {
    status: "recorded" | "unconfirmed" | "not_applicable";
  };
}

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
  // (audit H5) Mirror share-resource: refuse from the tools iframe bridge.
  toolCallable: false,
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    principalType: z.enum(["user", "group", "org"]),
    principalId: z.string(),
  }),
  run: async (args): Promise<UnshareResourceResult> => {
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
    const removed = await db
      .delete(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, args.resourceId),
          eq(reg.sharesTable.principalType, args.principalType),
          principalIdMatches(reg.sharesTable, args.principalType, principalId),
        ),
      )
      .returning({ principalId: reg.sharesTable.principalId });
    invalidateCollabAccessCache(args.resourceType, args.resourceId);
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );
    let status: UnshareResourceResult["recipientInvalidation"]["status"] =
      "not_applicable";
    if (args.principalType === "user" && removed.length > 0) {
      try {
        await notifyActionChange({
          actionName: "unshare-resource",
          owner: principalId,
        });
        status = "recorded";
      } catch (error) {
        // The grant is already deleted; a marker failure must not roll back
        // the caller's revoked-share UI or imply the grant still exists.
        status = "unconfirmed";
        console.error("[unshare-resource] recipient invalidation", {
          event: "recipient_invalidation_unconfirmed",
          status,
          error,
        });
      }
    }
    return { ok: true, recipientInvalidation: { status } };
  },
});
