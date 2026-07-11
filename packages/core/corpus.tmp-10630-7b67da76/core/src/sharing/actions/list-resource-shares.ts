import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { organizations } from "../../org/schema.js";
import { resolveAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";

async function loadOrgDisplayNames(
  db: any,
  shares: Array<{ principalType: string; principalId: string }>,
): Promise<Map<string, string>> {
  const orgIds = Array.from(
    new Set(
      shares
        .filter((s) => s.principalType === "org" && s.principalId)
        .map((s) => s.principalId),
    ),
  );
  if (!orgIds.length) return new Map();

  try {
    const rows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    return new Map(
      rows.flatMap(
        (row: {
          id?: string | null;
          name?: string | null;
        }): Array<[string, string]> => {
          if (typeof row.id !== "string" || typeof row.name !== "string") {
            return [];
          }
          const name = row.name.trim();
          return name ? [[row.id, name]] : [];
        },
      ),
    );
  } catch {
    // Some templates or older local databases may not have org tables yet.
    return new Map();
  }
}

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
    const policy = {
      // Defaults match registration defaults so the UI behaves the same for
      // resources that haven't opted into restrictions.
      allowPublic: reg.allowPublic !== false,
      requireOrgMemberForUserShares: reg.requireOrgMemberForUserShares === true,
    };
    const access = await resolveAccess(args.resourceType, args.resourceId);
    if (!access)
      return { ownerEmail: null, visibility: null, shares: [], policy };

    const db = reg.getDb() as any;
    const shares = await db
      .select()
      .from(reg.sharesTable)
      .where(eq(reg.sharesTable.resourceId, args.resourceId));
    const orgDisplayNames = await loadOrgDisplayNames(db, shares);

    return {
      ownerEmail: access.resource.ownerEmail ?? null,
      orgId: access.resource.orgId ?? null,
      visibility: access.resource.visibility ?? "private",
      role: access.role,
      shares: shares.map((s: any) => ({
        id: s.id,
        principalType: s.principalType,
        principalId: s.principalId,
        displayName:
          s.principalType === "org"
            ? orgDisplayNames.get(s.principalId)
            : undefined,
        role: s.role,
        createdAt: s.createdAt,
      })),
      policy,
    };
  },
});
