import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import { assertAccess, ForbiddenError } from "../access.js";
import { requireShareableResource } from "../registry.js";

export default defineAction({
  description:
    "Change the coarse visibility of a shareable resource: 'private' | 'org' | 'public'. Owner or admin role required.",
  // (audit H5) Visibility changes are admin-tier and can flip a private
  // resource org-wide or public. Refuse from the tools iframe bridge.
  toolCallable: false,
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    visibility: z.enum(["private", "org", "public"]),
  }),
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    if (args.visibility === "public" && reg.allowPublic === false) {
      throw new ForbiddenError(
        `${reg.displayName} cannot be made public — share with specific people or your organization instead.`,
      );
    }
    await assertAccess(args.resourceType, args.resourceId, "admin");
    const db = reg.getDb() as any;
    await db
      .update(reg.resourceTable)
      .set({ visibility: args.visibility })
      .where(eq(reg.resourceTable.id, args.resourceId));
    return { ok: true, visibility: args.visibility };
  },
});
