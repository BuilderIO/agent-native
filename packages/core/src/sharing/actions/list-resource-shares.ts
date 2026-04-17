import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import { resolveAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";

export default defineAction({
  description:
    "List the current visibility and share grants on a shareable resource. Any read access is sufficient.",
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    const access = await resolveAccess(args.resourceType, args.resourceId);
    if (!access) return { ownerEmail: null, visibility: null, shares: [] };

    const db = reg.getDb() as any;
    const shares = await db
      .select()
      .from(reg.sharesTable)
      .where(eq(reg.sharesTable.resourceId, args.resourceId));

    return {
      ownerEmail: access.resource.ownerEmail ?? null,
      orgId: access.resource.orgId ?? null,
      visibility: access.resource.visibility ?? "private",
      role: access.role,
      shares: shares.map((s: any) => ({
        id: s.id,
        principalType: s.principalType,
        principalId: s.principalId,
        role: s.role,
        createdAt: s.createdAt,
      })),
    };
  },
});
