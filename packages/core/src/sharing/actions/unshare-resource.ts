import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import { assertAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";

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
    const db = reg.getDb() as any;
    await db
      .delete(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, args.resourceId),
          eq(reg.sharesTable.principalType, args.principalType),
          eq(reg.sharesTable.principalId, args.principalId),
        ),
      );
    return { ok: true };
  },
});
