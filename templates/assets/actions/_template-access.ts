import {
  accessFilter,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";
import { eq, inArray, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { assertCanApprove } from "../server/lib/library-access.js";

const roleRank: Record<ShareRole | "owner", number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  admin: 4,
  owner: 5,
};

export async function resolveTemplateAccess(
  id: string,
  minRole: ShareRole | "owner" = "viewer",
) {
  // guard:allow-unscoped — this helper combines the template ACL with the
  // inherited Brand Kit ACL before exposing the row to its callers.
  const [template] = await getDb()
    .select()
    .from(schema.assetTemplates)
    .where(eq(schema.assetTemplates.id, id))
    .limit(1);
  if (!template) throw new Error("Template not found or not accessible.");
  const ownAccess = await resolveAccess("asset-template", id);
  const libraryAccess = template.libraryId
    ? await resolveAccess("asset-library", template.libraryId)
    : null;
  const access =
    libraryAccess &&
    (!ownAccess || roleRank[libraryAccess.role] > roleRank[ownAccess.role])
      ? libraryAccess
      : ownAccess;
  if (!access) throw new Error("Template not found or not accessible.");
  if (roleRank[access.role] < roleRank[minRole]) {
    throw new Error(`Template requires ${minRole} access.`);
  }
  return { ...access, resource: template };
}

export async function assertTemplateTargetLibraryAccess(
  libraryId: string | null | undefined,
) {
  if (libraryId)
    await assertCanApprove(libraryId, "Changing brand kit templates");
}

export async function accessibleTemplateFilter() {
  const libraries = await getDb()
    .select({ id: schema.assetLibraries.id })
    .from(schema.assetLibraries)
    .where(accessFilter(schema.assetLibraries, schema.assetLibraryShares));
  const templateAccess = accessFilter(
    schema.assetTemplates,
    schema.assetTemplateShares,
  );
  return libraries.length
    ? or(
        templateAccess,
        inArray(
          schema.assetTemplates.libraryId,
          libraries.map((library) => library.id),
        ),
      )
    : templateAccess;
}
