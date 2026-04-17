import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import { assertAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";

export default defineAction({
  description:
    "Change the coarse visibility of a shareable resource: 'private' | 'org' | 'public'. Owner or admin role required.",
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    visibility: z.enum(["private", "org", "public"]),
  }),
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    await assertAccess(args.resourceType, args.resourceId, "admin");
    const db = reg.getDb() as any;
    await db
      .update(reg.resourceTable)
      .set({ visibility: args.visibility })
      .where(eq(reg.resourceTable.id, args.resourceId));
    return { ok: true, visibility: args.visibility };
  },
});
